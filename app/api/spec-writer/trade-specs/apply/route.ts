import { NextRequest, NextResponse } from 'next/server';
import {
  getCostItemForTradeSpec,
  JT_COST_ITEM_FIELD_IDS,
  setCustomFieldValue,
  updateCostItemFields,
} from '../../../../lib/jobtread';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ApplyItem {
  costItemId: string;
  newDescription: string;
}

interface RequestBody {
  items: ApplyItem[];
  markAsSpecification?: boolean;
}

/**
 * Trade Specs — apply step.
 *
 * For each item, with server-side guards re-checked against live JobTread data:
 *  1. Verify the item has an approved price (> 0 on approved customerOrder docs).
 *     No approved price = not approved by the client = do not touch.
 *  2. Verify Document Verbiage is still empty (item not already processed).
 *  3. Copy the current description into the Document Verbiage custom field.
 *  4. Overwrite the description with the new trade-focused text.
 *  5. Optionally flag the item as a Specification.
 */
export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { items, markAsSpecification = false } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 });
    }
    if (items.length > 150) {
      return NextResponse.json({ error: 'Too many items (max 150 per request)' }, { status: 400 });
    }

    const results: Array<{
      costItemId: string;
      status: 'applied' | 'skipped' | 'error';
      reason?: string;
    }> = [];

    for (const item of items) {
      const { costItemId, newDescription } = item;
      try {
        if (!costItemId || !newDescription || !newDescription.trim()) {
          results.push({ costItemId, status: 'skipped', reason: 'Missing id or empty new description' });
          continue;
        }

        // Re-fetch live state — guards must hold at write time, not just preview time
        const live = await getCostItemForTradeSpec(costItemId);
        if (!live) {
          results.push({ costItemId, status: 'error', reason: 'Cost item not found in JobTread' });
          continue;
        }
        if (live.approvedPrice <= 0) {
          results.push({ costItemId, status: 'skipped', reason: 'No approved price — item not approved by client' });
          continue;
        }
        if (live.documentVerbiage.trim()) {
          results.push({ costItemId, status: 'skipped', reason: 'Document Verbiage already populated — already processed' });
          continue;
        }

        // 1. Preserve original client-facing description in Document Verbiage
        if (live.description.trim()) {
          await setCustomFieldValue({
            targetId: costItemId,
            targetType: 'costItem',
            customFieldId: JT_COST_ITEM_FIELD_IDS.DOCUMENT_VERBIAGE,
            value: live.description,
          });
        }

        // 2. Write the trade-focused description (and optionally flag as spec)
        await updateCostItemFields(costItemId, {
          description: newDescription.trim().slice(0, 4096),
          ...(markAsSpecification ? { isSpecification: true } : {}),
        });

        results.push({ costItemId, status: 'applied' });
      } catch (itemErr: any) {
        results.push({ costItemId, status: 'error', reason: itemErr.message || 'Update failed' });
      }
    }

    const applied = results.filter((r) => r.status === 'applied').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const errored = results.filter((r) => r.status === 'error').length;

    return NextResponse.json({ results, summary: { applied, skipped, errored } });
  } catch (err: any) {
    console.error('Trade specs apply API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

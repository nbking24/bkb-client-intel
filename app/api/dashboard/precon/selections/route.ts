// @ts-nocheck
/**
 * GET /api/dashboard/precon/selections
 *
 * Returns every active job (In Design + Ready + In Production — skips
 * Final Billing and Leads) along with each job's budget line items that
 * have the cost-item "Status" custom field set. Used by the Pre-Con
 * dashboard's Selections Tracker.
 *
 * The Status field is a JT cost-item option custom field. Its four
 * options (exact strings as authored in JT):
 *   1. "1. Client Selection Needed"
 *   2. "2. Internal Selection Needed"
 *   3. "3. Selected/Needs Order"
 *   4. "4. Ordered/Finalized"
 *
 * Items in any of those statuses are returned. Items where Status is
 * blank are excluded — the report is meant to surface only the
 * selections Nathan / Allison are actively shepherding.
 */
import { NextResponse } from 'next/server';
import { getActiveJobs, pave } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Status custom field ID + canonical option strings. The IDs come from
// the JT org schema (confirmed via the customFields query — field is
// targeted at costItem). Keep these in sync with JT if Nathan ever
// edits the field's options in JT settings.
const STATUS_CF_ID = '22P5WiHgkzx9';

// Not `export`-ed: Next.js route files only allow specific export
// names (GET, POST, dynamic, runtime, etc.). Surfaced via the API
// response instead so the dashboard can read the canonical list.
const SELECTION_STATUSES = [
  '1. Client Selection Needed',
  '2. Internal Selection Needed',
  '3. Selected/Needs Order',
  '4. Ordered/Finalized',
] as const;

type SelectionStatus = (typeof SELECTION_STATUSES)[number];

const STATUS_KEY: Record<SelectionStatus, string> = {
  '1. Client Selection Needed': 'clientSelectionNeeded',
  '2. Internal Selection Needed': 'internalSelectionNeeded',
  '3. Selected/Needs Order': 'selectedNeedsOrder',
  '4. Ordered/Finalized': 'orderedFinalized',
};

// Pull cost items for a single job, including each item's group + the
// Status custom field value. Small page size because each node carries a
// nested customFieldValues collection which gets expensive — JT will
// 413 if we push it too hard.
async function fetchCostItemsWithStatus(jobId: string): Promise<any[]> {
  const PAGE_SIZE = 25;
  const MAX_PAGES = 100;
  const out: any[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            cost: {},
            unitPrice: {},
            quantity: {},
            unit: { name: {} },
            costCode: { id: {}, number: {}, name: {} },
            costType: { id: {}, name: {} },
            costGroup: { id: {}, name: {}, parentCostGroup: { id: {}, name: {} } },
            document: { id: {} },
            customFieldValues: {
              $: { size: 10 },
              nodes: { value: {}, customField: { id: {} } },
            },
          },
        },
      },
    });

    const ciPage = (data as any)?.job?.costItems;
    const nodes = ciPage?.nodes || [];
    out.push(...nodes);
    nextPage = ciPage?.nextPage || null;
    if (!nextPage || nodes.length < PAGE_SIZE) break;
  }

  return out;
}

export async function GET() {
  try {
    // Active job set: pull everything, then filter by status category to
    // keep only In Design + Ready + In Production. Final Billing and
    // Leads are intentionally excluded per the precon report spec.
    const jobs = await getActiveJobs(500);
    const targetJobs = jobs.filter((j: any) => {
      const cat = j.statusCategory;
      return cat === 'IN_DESIGN' || cat === 'READY' || cat === 'IN_PRODUCTION';
    });

    // Concurrency limit so we don't slam JT — small batches.
    const BATCH = 4;
    const jobResults: any[] = [];
    for (let i = 0; i < targetJobs.length; i += BATCH) {
      const slice = targetJobs.slice(i, i + BATCH);
      const batch = await Promise.all(
        slice.map(async (job: any) => {
          try {
            const items = await fetchCostItemsWithStatus(job.id);

            // Filter to job-level budget items (document == null) and pull
            // the Status custom field value off each. Drop items that
            // don't have any status value set.
            const statusedItems: any[] = [];
            for (const it of items) {
              if (it.document && it.document.id) continue;
              const cfvs = it.customFieldValues?.nodes || [];
              const statusCfv = cfvs.find(
                (n: any) => n.customField?.id === STATUS_CF_ID,
              );
              const statusValue = statusCfv?.value;
              if (!statusValue || !String(statusValue).trim()) continue;
              statusedItems.push({
                id: it.id,
                name: it.name || '',
                description: it.description || '',
                quantity: it.quantity ?? null,
                unitName: it.unit?.name || '',
                unitPrice: it.unitPrice ?? null,
                cost: Number(it.cost) || 0,
                costCodeNumber: it.costCode?.number || '',
                costCodeName: it.costCode?.name || '',
                costGroupId: it.costGroup?.id || null,
                costGroupName: it.costGroup?.name || '',
                parentGroupName: it.costGroup?.parentCostGroup?.name || '',
                status: statusValue,
              });
            }

            // Per-job counts by status bucket so the UI can render
            // collapsed cards with a status-by-status summary.
            const counts: Record<string, number> = {
              clientSelectionNeeded: 0,
              internalSelectionNeeded: 0,
              selectedNeedsOrder: 0,
              orderedFinalized: 0,
            };
            for (const it of statusedItems) {
              const k = STATUS_KEY[it.status as SelectionStatus];
              if (k) counts[k] += 1;
            }

            return {
              jobId: job.id,
              jobName: job.name,
              jobNumber: job.number || '',
              clientName: job.clientName || '',
              customStatus: job.customStatus || null,
              statusCategory: job.statusCategory || null,
              counts,
              actionableCount:
                counts.clientSelectionNeeded +
                counts.internalSelectionNeeded +
                counts.selectedNeedsOrder,
              items: statusedItems,
            };
          } catch (err: any) {
            console.error(`[precon/selections] job ${job.id} failed:`, err?.message || err);
            return null;
          }
        }),
      );
      jobResults.push(...batch.filter(Boolean));
    }

    // Drop jobs with zero statused items - they have nothing for the
    // pre-con coordinator to review. Cleaner than rendering empty rows.
    const visible = jobResults.filter((j) => j.items.length > 0);

    // Sort: jobs with the most actionable (non-finalized) selections first,
    // then by client name for stable ordering.
    visible.sort((a, b) => {
      if (a.actionableCount !== b.actionableCount) return b.actionableCount - a.actionableCount;
      return (a.clientName || a.jobName).localeCompare(b.clientName || b.jobName);
    });

    // Portfolio totals across every visible job.
    const totals = visible.reduce(
      (acc, j) => {
        acc.clientSelectionNeeded += j.counts.clientSelectionNeeded;
        acc.internalSelectionNeeded += j.counts.internalSelectionNeeded;
        acc.selectedNeedsOrder += j.counts.selectedNeedsOrder;
        acc.orderedFinalized += j.counts.orderedFinalized;
        acc.actionable += j.actionableCount;
        return acc;
      },
      {
        jobCount: visible.length,
        actionable: 0,
        clientSelectionNeeded: 0,
        internalSelectionNeeded: 0,
        selectedNeedsOrder: 0,
        orderedFinalized: 0,
      },
    );

    return NextResponse.json({
      computedAt: new Date().toISOString(),
      totals,
      jobs: visible,
      statusOptions: SELECTION_STATUSES,
    });
  } catch (err: any) {
    console.error('[precon/selections] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to load selections' }, { status: 500 });
  }
}

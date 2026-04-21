// @ts-nocheck
/**
 * POST /api/dashboard/bill-review/[id]/approve
 *
 * Body: { jobCostItemId: string, approvedBy?: string }
 *
 * Approve a suggestion (or a Nathan-picked alternative) from the review
 * card. Flow:
 *   1. Load the queue row by id
 *   2. Resolve the budget item (for cost code info + name hint)
 *   3. Call JT updateCostItem to relink the bill line
 *   4. Record the pattern so future bills from this vendor + cost code
 *      auto-match
 *   5. Mark the queue row as 'applied'
 *
 * If step 3 fails, the row is marked 'failed' with the error message
 * preserved so Nathan can retry from the UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../lib/supabase';
import { updateDocumentCostItem, getJobBudgetItems } from '@/app/lib/jobtread';
import { recordApproval } from '@/app/lib/bill-categorization';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabase();
  const id = params.id;

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const jobCostItemId: string | undefined = body.jobCostItemId;
  const approvedBy: string = body.approvedBy || 'nathan';

  if (!jobCostItemId) {
    return NextResponse.json({ error: 'jobCostItemId is required' }, { status: 400 });
  }

  // Load queue row
  const { data: row, error: loadErr } = await supabase
    .from('bill_review_queue')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (loadErr || !row) {
    return NextResponse.json({ error: 'Queue row not found' }, { status: 404 });
  }
  if (row.status !== 'pending' && row.status !== 'failed') {
    return NextResponse.json({ error: `Row is ${row.status}, not pending` }, { status: 409 });
  }

  // Find the target budget item. We prefer the candidate list stored on
  // the row (fast, no JT round-trip), but fall back to re-fetching the
  // job's budget items so Nathan can pick anything.
  let target: any | null = null;
  const candidates = (row.candidate_budget_items as any[]) || [];
  target = candidates.find(c => c.jobCostItemId === jobCostItemId) || null;
  if (!target) {
    try {
      const budget = await getJobBudgetItems(row.job_id);
      const b = budget.find((x: any) => x.id === jobCostItemId);
      if (b) {
        target = {
          jobCostItemId: b.id,
          name: b.name,
          costCodeId: b.costCodeId,
          costCodeNumber: b.costCodeNumber,
          costCodeName: b.costCodeName,
        };
      }
    } catch (err: any) {
      return NextResponse.json(
        { error: 'Could not load budget items from JT: ' + err.message },
        { status: 502 }
      );
    }
  }
  if (!target) {
    return NextResponse.json(
      { error: `Budget item ${jobCostItemId} not found on job ${row.job_id}` },
      { status: 404 }
    );
  }

  // Mark row as approved first (audit trail even if JT fails)
  await supabase
    .from('bill_review_queue')
    .update({
      status: 'approved',
      approved_job_cost_item_id: jobCostItemId,
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq('id', id);

  // Apply to JT. Update the bill line's jobCostItemId + costCodeId so
  // the budget rollup and the line-level cost code are in agreement.
  try {
    await updateDocumentCostItem(row.cost_item_id, {
      jobCostItemId,
      costCodeId: target.costCodeId || undefined,
    });
  } catch (err: any) {
    await supabase
      .from('bill_review_queue')
      .update({
        status: 'failed',
        last_error: err.message || String(err),
      })
      .eq('id', id);
    return NextResponse.json(
      { error: 'JT update failed: ' + (err.message || String(err)) },
      { status: 502 }
    );
  }

  // Record the pattern for learning
  if (row.vendor_account_id && target.costCodeNumber) {
    try {
      await recordApproval(supabase, {
        vendorAccountId: row.vendor_account_id,
        vendorName: row.vendor_name,
        lineCostCodeNumber: row.line_cost_code_number,
        targetCostCodeNumber: target.costCodeNumber,
        targetCostCodeName: target.costCodeName,
        targetBudgetItemName: target.name,
        jobId: row.job_id,
      });
    } catch (err: any) {
      // Don't fail the whole request — pattern learning is best-effort.
      console.error('[bill-review/approve] recordApproval failed:', err.message);
    }
  }

  // Mark applied
  await supabase
    .from('bill_review_queue')
    .update({
      status: 'applied',
      applied_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', id);

  return NextResponse.json({
    ok: true,
    appliedTo: {
      jobCostItemId,
      name: target.name,
      costCodeNumber: target.costCodeNumber,
    },
  });
}

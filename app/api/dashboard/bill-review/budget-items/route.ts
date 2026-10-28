// @ts-nocheck
/**
 * GET /api/dashboard/bill-review/budget-items?jobId=XXX
 *
 * Returns every job-level budget item on the job that's a valid target for
 * re-linking a bill line — i.e. excludes JT's auto "Uncategorized XX ..."
 * placeholder buckets (we never want to route a bill from one placeholder
 * onto another).
 *
 * Each item is tagged with `isApproved`: true when the item sits on at
 * least one approved customer order. The picker on the Bill Review uses
 * this together with the top-level `isCostPlus` flag to enforce BKB's
 * matching rule:
 *
 *   - Fixed-price jobs: a bill can only be re-linked to an APPROVED
 *     budget item — except cost code 23 items (the "billable" labor /
 *     sub / materials buckets), which are always allowed regardless
 *     of approval state.
 *   - Cost-plus jobs: any budget item is a valid target. Cost-plus
 *     contracts don't carry a pre-approved budget so the approval
 *     gate doesn't apply.
 *
 * A fixed-price job with NOTHING approved yields an empty list. That is
 * deliberate (changed 2026-10-28): there used to be a "no approved customer
 * orders means treat it as cost-plus" fallback, which quietly opened the
 * whole budget on any job that was mid-approval. Now the picker comes back
 * empty and the operator flags the bill for Nathan instead of guessing.
 *
 * `costTypeName` is returned per item so the picker can resolve a 4-digit
 * code (e.g. 1602) into cost code 16 + Subcontractor.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getJob,
  getJobBudgetItems,
  getApprovedOrderCostItemsForJob,
} from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  try {
    // Only the approved, in-budget customer orders are fetched — not every
    // document on the job. See getApprovedOrderCostItemsForJob().
    const [job, items, approvedOrderItems] = await Promise.all([
      getJob(jobId),
      getJobBudgetItems(jobId),
      getApprovedOrderCostItemsForJob(jobId).catch(() => []),
    ]);

    const approvedOrderIds = new Set<string>();
    const approvedJobCostItemIds = new Set<string>();
    for (const dci of (approvedOrderItems || []) as any[]) {
      if (dci.document?.id) approvedOrderIds.add(dci.document.id);
      // Both the doc-level cost item id AND its linked job-level item
      // count — the user-visible budget item on the job is the
      // jobCostItem, but in some flows the doc-level id is what gets
      // referenced. Tracking both keeps us safe.
      if (dci.id) approvedJobCostItemIds.add(dci.id);
      const jcid = (dci as any).jobCostItem?.id;
      if (jcid) approvedJobCostItemIds.add(jcid);
    }

    // Cost-plus detection. Two signals, both about the CONTRACT, not about
    // whether approval has happened yet:
    //   1. JT priceType is "costPlus" (case-insensitive — JT writes it
    //      camelCase; we lowercase for resilience).
    //   2. Legacy heuristic: the approved orders carry cost but no price,
    //      which is how some older cost-plus jobs were written up.
    // The old third signal — "no approved customer orders" — is gone. It
    // conflated "this contract has no fixed budget" with "this job hasn't
    // been approved yet," and the second case should produce an empty
    // picker and a flag, not the run of the whole budget.
    const priceTypeRaw = String(job?.priceType || '').toLowerCase();
    const totalApprovedPrice = (approvedOrderItems || [])
      .reduce((s: number, i: any) => s + (Number(i.price) || 0), 0);
    const totalApprovedCost = (approvedOrderItems || [])
      .reduce((s: number, i: any) => s + (Number(i.cost) || 0), 0);
    const priceTypeMatch =
      priceTypeRaw === 'costplus' ||
      priceTypeRaw === 'cost_plus' ||
      priceTypeRaw === 'cost plus';
    const legacyHeuristic =
      approvedOrderIds.size > 0 && totalApprovedPrice === 0 && totalApprovedCost > 0;
    const isCostPlus = priceTypeMatch || legacyHeuristic;
    const costPlusReason = priceTypeMatch
      ? 'priceType=' + (job?.priceType || '')
      : legacyHeuristic
        ? 'approved CO has cost but no price'
        : 'fixed-price';

    const filtered = (items || [])
      .filter((b: any) => !/^uncategorized\b/i.test((b.name || '').trim()))
      .map((b: any) => ({
        id: b.id,
        name: b.name || null,
        costCodeId: b.costCodeId || null,
        costCodeNumber: b.costCodeNumber || null,
        costCodeName: b.costCodeName || null,
        // Cost type ("Labor" | "Materials" | "Subcontractor" | ...). The
        // picker maps the last two digits of a 4-digit code onto this:
        // 01 Labor, 02 Subcontractor, 03 Materials.
        costTypeName: b.costTypeName || null,
        cost: Number(b.cost) || 0,
        // True when this budget item rolled up from an approved CO. Picker
        // uses this to enforce the fixed-price rule. Cost-plus jobs ignore
        // the flag (picker doesn't filter).
        isApproved: approvedJobCostItemIds.has(b.id),
      }))
      // Sort by cost code number then by name for predictable scanning
      .sort((a, b) => {
        const aCc = a.costCodeNumber || 'zz';
        const bCc = b.costCodeNumber || 'zz';
        if (aCc !== bCc) return aCc.localeCompare(bCc);
        return (a.name || '').localeCompare(b.name || '');
      });

    return NextResponse.json({
      items: filtered,
      isCostPlus,
      costPlusReason,
      priceType: job?.priceType || null,
      approvedOrderCount: approvedOrderIds.size,
      approvedItemCount: approvedJobCostItemIds.size,
    });
  } catch (err: any) {
    console.error('[bill-review/budget-items] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to load budget items' }, { status: 500 });
  }
}

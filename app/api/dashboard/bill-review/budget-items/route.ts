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
 * Doing the approved-set lookup here (vs. on the client) keeps the
 * picker fast and the rule centralized.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getJob,
  getJobBudgetItems,
  getDocumentsForJob,
  getDocumentCostItemsForJob,
} from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  try {
    // Pull job + budget items + docs + doc-level cost items in parallel.
    // Doc-level cost items are needed so we can mark which job-level
    // budget items appear on approved customer orders.
    const [job, items, documents, docCostItems] = await Promise.all([
      getJob(jobId),
      getJobBudgetItems(jobId),
      getDocumentsForJob(jobId).catch(() => []),
      getDocumentCostItemsForJob(jobId).catch(() => []),
    ]);

    // Detect cost-plus. Mirrors the job-costing detail route's logic so
    // both dashboards agree on what counts as a cost-plus job. Falls back
    // to a "no contract price but real cost budget" heuristic when the
    // priceType field isn't set explicitly.
    const priceTypeRaw = String(job?.priceType || '').toLowerCase();
    const totalEstimatedPrice = (documents || [])
      .filter((d: any) => d.type === 'customerOrder' && d.status === 'approved' && d.includeInBudget !== false)
      .reduce((s: number, d: any) => s + (Number(d.price) || 0), 0);
    const totalEstimatedCost = (documents || [])
      .filter((d: any) => d.type === 'customerOrder' && d.status === 'approved' && d.includeInBudget !== false)
      .reduce((s: number, d: any) => s + (Number(d.cost) || 0), 0);
    const isCostPlus =
      priceTypeRaw === 'costplus' ||
      priceTypeRaw === 'cost_plus' ||
      priceTypeRaw === 'cost plus' ||
      (totalEstimatedPrice === 0 && totalEstimatedCost > 0);

    // Build the set of jobCostItem IDs that appear on any APPROVED customer
    // order (skipping docs with "Exclude from Budget" toggled on). A
    // job-level budget item is considered approved iff its id is in this
    // set OR the budget item itself was the target of an approved CO line.
    const approvedOrderIds = new Set<string>();
    for (const doc of (documents || []) as any[]) {
      if (doc.type === 'customerOrder' && doc.status === 'approved' && doc.includeInBudget !== false) {
        if (doc.id) approvedOrderIds.add(doc.id);
      }
    }
    const approvedJobCostItemIds = new Set<string>();
    for (const dci of (docCostItems || []) as any[]) {
      const docType = dci.document?.type || '';
      const docId = dci.document?.id || '';
      if (docType !== 'customerOrder') continue;
      if (!approvedOrderIds.has(docId)) continue;
      // Both the doc-level cost item id AND its linked job-level item
      // count — the user-visible budget item on the job is the
      // jobCostItem, but in some flows the doc-level id is what gets
      // referenced. Tracking both keeps us safe.
      if (dci.id) approvedJobCostItemIds.add(dci.id);
      const jcid = (dci as any).jobCostItem?.id;
      if (jcid) approvedJobCostItemIds.add(jcid);
    }

    const filtered = (items || [])
      .filter((b: any) => !/^uncategorized\b/i.test((b.name || '').trim()))
      .map((b: any) => ({
        id: b.id,
        name: b.name || null,
        costCodeId: b.costCodeId || null,
        costCodeNumber: b.costCodeNumber || null,
        costCodeName: b.costCodeName || null,
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
      priceType: job?.priceType || null,
    });
  } catch (err: any) {
    console.error('[bill-review/budget-items] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to load budget items' }, { status: 500 });
  }
}

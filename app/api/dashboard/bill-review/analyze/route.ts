/**
 * Bill Analysis (read-only) — produces a per-job dump of every vendor
 * bill line with enough context to eyeball miscategorizations that the
 * classifier currently misses (same cost code, wrong budget item).
 *
 * GET /api/dashboard/bill-review/analyze?jobId=XXX
 * Auth: CRON_SECRET via Bearer
 *
 * Response shape:
 *   {
 *     jobId, jobName,
 *     budgetItemCount,
 *     lines: [ {
 *       documentNumber, documentName, documentIssueDate,
 *       vendorName,
 *       lineName, lineDescription, cost, quantity,
 *       lineCostCodeNumber, lineCostCodeName,
 *       currentBudgetItemName, currentBudgetCostCodeNumber, currentBudgetCostCodeName,
 *       siblingBudgetItems: [{ name, costCodeNumber, cost }]
 *           // other budget items on this job that share the same cost code
 *           // as the line — the likely pool where the "correct" one lives
 *     } ]
 *   }
 *
 * No writes. Safe to call at any time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJobBillLines, getJobBudgetItems, getActiveJobs } from '../../../../lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId query param required' }, { status: 400 });
  }

  // Look up the job name for nicer output.
  let jobName: string | null = null;
  try {
    const jobs = await getActiveJobs(200);
    const j = jobs.find((x: any) => x.id === jobId);
    jobName = j?.name || null;
  } catch { /* non-fatal */ }

  const [lines, budgetItems] = await Promise.all([
    getJobBillLines(jobId),
    getJobBudgetItems(jobId),
  ]);

  // Pre-index budget items by cost code for fast sibling lookup.
  const budgetByCc = new Map<string, Array<{ id: string; name: string | null; costCodeNumber: string | null; cost: number }>>();
  for (const b of budgetItems) {
    const key = b.costCodeNumber || '__none__';
    if (!budgetByCc.has(key)) budgetByCc.set(key, []);
    budgetByCc.get(key)!.push({ id: b.id, name: b.name, costCodeNumber: b.costCodeNumber, cost: b.cost });
  }

  const rows = lines.map((l) => {
    // "Siblings" = other budget items on the job with the SAME cost code
    // as the line. These are the pool of candidate correct-buckets.
    const cc = l.lineCostCodeNumber || l.budgetCostCodeNumber || null;
    const siblings = cc ? (budgetByCc.get(cc) || []) : [];
    const filteredSiblings = siblings
      .filter((s) => s.id !== l.jobCostItemId)
      .map((s) => ({ name: s.name, costCodeNumber: s.costCodeNumber, cost: s.cost }));

    return {
      documentNumber: l.documentNumber,
      documentName: l.documentName,
      documentIssueDate: l.documentIssueDate,
      vendorName: l.vendorName,
      vendorAccountId: l.vendorAccountId,
      lineName: l.lineName,
      lineDescription: l.lineDescription,
      cost: l.cost,
      quantity: l.quantity,
      lineCostCodeNumber: l.lineCostCodeNumber,
      lineCostCodeName: l.lineCostCodeName,
      currentBudgetItemName: l.budgetItemName,
      currentBudgetCostCodeNumber: l.budgetCostCodeNumber,
      currentBudgetCostCodeName: l.budgetCostCodeName,
      siblingBudgetItems: filteredSiblings,
      siblingCount: filteredSiblings.length,
      // IDs we'll need to seed learned patterns back later
      costItemId: l.costItemId,
      documentId: l.documentId,
      currentJobCostItemId: l.jobCostItemId,
    };
  });

  return NextResponse.json({
    jobId,
    jobName,
    budgetItemCount: budgetItems.length,
    lineCount: rows.length,
    lines: rows,
  });
}

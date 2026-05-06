// @ts-nocheck
/**
 * GET /api/dashboard/job-costing/diag?jobId=XXX
 *
 * Read-only diagnostic that compares the data feeding the job-costing
 * cost-code rollup against the data feeding the bill-review/analyze
 * endpoint. Used to figure out why cost-code 15 (and other divisions)
 * are missing from the Job Costing dashboard rollup on Edwards.
 *
 * Auth: CRON_SECRET via Bearer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDocumentCostItemsForJob, getDocumentsForJob, getJobBillLines } from '../../../../lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  // Fetch all three data sources in parallel.
  const [docs, dciItems, billLines] = await Promise.all([
    getDocumentsForJob(jobId),
    getDocumentCostItemsForJob(jobId).catch((e) => ({ __error: e.message })),
    getJobBillLines(jobId).catch((e) => ({ __error: e.message })),
  ]);

  if ((dciItems as any).__error || (billLines as any).__error) {
    return NextResponse.json({ docCount: docs.length, dciError: (dciItems as any).__error, billError: (billLines as any).__error });
  }

  const docList = docs as any[];
  const dciList = dciItems as any[];
  const billList = billLines as any[];

  // Bucket vendor bill docs by status.
  const docsByStatus: Record<string, number> = {};
  const docIdToStatus: Record<string, string> = {};
  for (const d of docList) {
    if (d.type !== 'vendorBill' && d.type !== 'vendorOrder') continue;
    const s = d.status || '(none)';
    docsByStatus[s] = (docsByStatus[s] || 0) + 1;
    docIdToStatus[d.id] = s;
  }

  // dci items: bucket by document status × cost code division.
  const dciByStatus: Record<string, number> = {};
  const dciByCC: Record<string, { count: number; total: number }> = {};
  let dciVendorBillCount = 0;
  let dciVendorBillTotal = 0;
  for (const it of dciList) {
    const docType = it.document?.type || '';
    if (docType !== 'vendorBill' && docType !== 'vendorOrder') continue;
    const s = it.document?.status || '(none)';
    dciByStatus[s] = (dciByStatus[s] || 0) + 1;
    const ccNum = it.costCode?.number || it.jobCostItem?.costCode?.number || '00';
    if (!dciByCC[ccNum]) dciByCC[ccNum] = { count: 0, total: 0 };
    dciByCC[ccNum].count++;
    dciByCC[ccNum].total += Number(it.cost) || 0;
    dciVendorBillCount++;
    dciVendorBillTotal += Number(it.cost) || 0;
  }

  // bill-analyze items: bucket by cost code division.
  const billByCC: Record<string, { count: number; total: number }> = {};
  for (const l of billList) {
    const cc = l.lineCostCodeNumber || l.budgetCostCodeNumber || '00';
    if (!billByCC[cc]) billByCC[cc] = { count: 0, total: 0 };
    billByCC[cc].count++;
    billByCC[cc].total += Number(l.cost) || 0;
  }

  // Diff: what's in bill-analyze but missing from job-costing?
  const missingFromCosting: Array<{ cc: string; billCount: number; billTotal: number; dciCount: number; dciTotal: number }> = [];
  for (const cc of Object.keys(billByCC)) {
    const bill = billByCC[cc];
    const dci = dciByCC[cc] || { count: 0, total: 0 };
    if (Math.abs(bill.total - dci.total) > 1) {
      missingFromCosting.push({ cc, billCount: bill.count, billTotal: bill.total, dciCount: dci.count, dciTotal: dci.total });
    }
  }

  return NextResponse.json({
    summary: {
      totalDocs: docList.length,
      vendorBillsByStatus: docsByStatus,
      dciVendorBillItemCount: dciVendorBillCount,
      dciVendorBillTotal: dciVendorBillTotal,
      billAnalyzeLineCount: billList.length,
      billAnalyzeTotal: Object.values(billByCC).reduce((s, x) => s + x.total, 0),
    },
    dciItemsByDocStatus: dciByStatus,
    costCodeDistribution: {
      jobCostingDci: dciByCC,
      billAnalyze: billByCC,
      missingOrDifferentInCosting: missingFromCosting,
    },
  });
}

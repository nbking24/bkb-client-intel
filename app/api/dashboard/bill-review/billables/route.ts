// @ts-nocheck
/**
 * GET /api/dashboard/bill-review/billables
 *
 * "Billables to bill" — which jobs are carrying cost code 23 costs that
 * haven't been turned into a change order yet.
 *
 * Cost code 23 is BKB's billable bucket: 2301 Labor, 2302 Subs, 2303
 * Materials. A cost that lands there is work the client owes for but that
 * isn't on the contract, so it has to be written up as a change order and
 * the costs moved onto it. Until that happens the money sits in 23 and
 * nobody is billing it.
 *
 * This endpoint does NO new JobTread work. The numbers already exist — the
 * invoicing-health report computes them for every active job — so this
 * reads that report's Supabase cache and reshapes it into one cross-job
 * list. That keeps the Bill Review page instant; rebuilding the invoicing
 * context takes minutes.
 *
 * Dollars and hours are reported SEPARATELY and never combined. JobTread
 * tracks 23 Labor as time entries, not money, and converting hours to
 * dollars needs a bill rate this route has no business inventing — a job
 * showing "$0 / 17 hrs" has real billable work on it. Heather prices the
 * hours when she writes the change order.
 *
 * Read-only: nothing here creates or modifies a change order.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { createServerClient } from '@/app/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same cache row the Invoicing dashboard writes — see app/api/dashboard/invoicing/route.ts. */
const CACHE_KEY = 'invoicing-health-report';

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const supabase = createServerClient();
    const { data: row } = await supabase
      .from('agent_cache')
      .select('data, updated_at')
      .eq('key', CACHE_KEY)
      .maybeSingle();

    if (!row?.data) {
      // Deliberately does NOT trigger a rebuild: that takes minutes and
      // would hang the Bill Review page. Tell the operator where to go.
      return NextResponse.json({
        jobs: [],
        totals: { amount: 0, hours: 0, jobCount: 0 },
        cachedAt: null,
        notComputed: true,
        message: 'The invoicing report has not run yet. Open the Invoicing page and refresh it, then come back.',
      });
    }

    const ctx = row.data as any;

    // Per-line detail, where the invoicing report captured it. Keyed by job
    // so the UI can expand a row without another round-trip.
    const detailByJob: Record<string, any> = {};
    for (const b of (ctx.billableItems || []) as any[]) {
      if (b?.jobId) detailByJob[b.jobId] = b;
    }

    const rows: any[] = [];
    const seen = new Set<string>();
    for (const j of [...(ctx.contractJobs || []), ...(ctx.costPlusJobs || [])] as any[]) {
      if (!j?.jobId || seen.has(j.jobId)) continue;
      seen.add(j.jobId);

      const detail = detailByJob[j.jobId];
      // Prefer the job-health figure; fall back to the detail roll-up for
      // cost-plus jobs, where the per-line list is the richer source.
      const amount = Math.round(
        ((j.uninvoicedBillableAmount ?? detail?.totalUninvoicedAmount ?? 0) as number) * 100
      ) / 100;
      const hours = Math.round(
        ((j.unbilledLaborHours ?? detail?.totalUninvoicedHours ?? 0) as number) * 10
      ) / 10;

      if (amount <= 0 && hours <= 0) continue;

      rows.push({
        jobId: j.jobId,
        jobName: j.jobName || detail?.jobName || '',
        jobNumber: j.jobNumber || detail?.jobNumber || null,
        clientName: j.clientName || detail?.clientName || '',
        priceType: j.priceType || detail?.priceType || null,
        customStatus: j.customStatus ?? detail?.customStatus ?? null,
        amount,
        hours,
        // The 23 lines behind the number, when the report captured them.
        lines: (detail?.uninvoicedItems || []).map((i: any) => ({
          costItemId: i.costItemId,
          name: i.name,
          total: Number(i.totalPrice) || 0,
          documentName: i.documentName || null,
        })),
        jtBudgetUrl: `https://app.jobtread.com/jobs/${j.jobId}/budget`,
      });
    }

    // Biggest money first; a job that is only hours sorts by hours after
    // the dollar jobs, so nothing with real work on it lands at the bottom
    // just because its labor hasn't been priced.
    rows.sort((a, b) => (b.amount - a.amount) || (b.hours - a.hours));

    return NextResponse.json({
      jobs: rows,
      totals: {
        amount: Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100,
        hours: Math.round(rows.reduce((s, r) => s + r.hours, 0) * 10) / 10,
        jobCount: rows.length,
      },
      cachedAt: row.updated_at || ctx.generatedAt || null,
      notComputed: false,
    });
  } catch (err: any) {
    console.error('[bill-review/billables]', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to load billables' }, { status: 500 });
  }
}

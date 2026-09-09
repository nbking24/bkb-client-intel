// @ts-nocheck
/**
 * GET /api/dashboard/company-financials
 *
 * Owner-only company financials feed. Two sources, joined here:
 *
 *   1. QUICKBOOKS — read from the company_financials_snapshot table
 *      (key 'current'), pushed in by a scheduled Cowork task because the
 *      Hub has no QB OAuth. Carries an `asOf` date the page displays so
 *      nobody mistakes a snapshot for live data.
 *
 *   2. JOBTREAD — read live-ish from job_costing_summary_cache, the same
 *      snapshot the Job Costing dashboard uses. Powers the collapsible
 *      per-job profitability drawer: contract, collected, cost to date,
 *      projected profit at current stage. Reusing that cache keeps the
 *      math identical to Job Costing instead of inventing a second
 *      version of the same numbers.
 *
 * Auth: owner role only (company-wide financials incl. owner draws).
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '@/app/api/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Stage buckets, mirroring the Job Costing kanban vocabulary. */
function stageFor(customStatus: string | null): string {
  const s = (customStatus || '').toLowerCase();
  if (!s) return 'Other';
  if (/final\s*billing|closeout|punch\s*list|warrant/.test(s)) return 'Final Billing';
  if (/in\s*production|production|building|under\s*construction|construction/.test(s)) return 'In Production';
  if (/^\d*\.?\s*ready\b|ready to build|ready to start|approved|signed|contract\s*signed/.test(s)) return 'Ready';
  if (/design|consult|estimate|estimat|proposal|pre[-\s]?con|preconstruction|selection/.test(s)) return 'In Design';
  if (/closed|complete/.test(s)) return 'Closed';
  return 'Other';
}

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.role !== 'owner') {
    return NextResponse.json({ error: 'Company financials are owner-only.' }, { status: 403 });
  }

  const sb = getSupabase();

  // ---- QuickBooks snapshot ----
  let qb: any = null;
  let qbComputedAt: string | null = null;
  try {
    const { data } = await sb
      .from('company_financials_snapshot')
      .select('payload, computed_at, source')
      .eq('key', 'current')
      .maybeSingle();
    if (data?.payload) {
      qb = data.payload;
      qbComputedAt = data.computed_at;
    }
  } catch (err: any) {
    console.warn('[company-financials] snapshot read failed:', err?.message || err);
  }

  // ---- JobTread job profitability (from the Job Costing cache) ----
  let jobs: any[] = [];
  let jtComputedAt: string | null = null;
  try {
    const { data } = await sb
      .from('job_costing_summary_cache')
      .select('payload, computed_at')
      .eq('key', 'summary')
      .maybeSingle();
    const summaries = data?.payload?.summaries;
    jtComputedAt = data?.computed_at || null;
    if (Array.isArray(summaries)) {
      jobs = summaries
        .map((s: any) => {
          const contract = Number(s.contractPrice) || 0;
          const costToDate = Number(s.totalCosts ?? s.actualCost) || 0;
          const collected = Number(s.collectedAmount) || 0;
          const invoiced = Number(s.invoicedAmount) || 0;
          const projectedProfit = Number(s.margin) || 0;
          return {
            jobId: s.jobId,
            jobNumber: String(s.jobNumber || ''),
            jobName: s.jobName || '',
            clientName: s.clientName || '',
            stage: stageFor(s.customStatus),
            customStatus: s.customStatus || null,
            isCostPlus: !!s.isCostPlus,
            contract,
            invoiced,
            collected,
            costToDate,
            // Cash-in minus cost-out on the job so far. Not the same as
            // projected profit — it is the "have we been paid for what we
            // have spent" view.
            cashPosition: collected - costToDate,
            projectedProfit,
            projectedMarginPct: Number(s.marginPct) || 0,
            health: s.health || null,
          };
        })
        // Closed/other jobs with no contract and no cost are noise.
        .filter((j: any) => j.contract > 0 || j.costToDate > 0)
        .sort(
          (a: any, b: any) =>
            (a.clientName || a.jobName).localeCompare(b.clientName || b.jobName),
        );
    }
  } catch (err: any) {
    console.warn('[company-financials] job cache read failed:', err?.message || err);
  }

  const jobTotals = jobs.reduce(
    (acc: any, j: any) => {
      acc.contract += j.contract;
      acc.invoiced += j.invoiced;
      acc.collected += j.collected;
      acc.costToDate += j.costToDate;
      acc.projectedProfit += j.projectedProfit;
      return acc;
    },
    { count: jobs.length, contract: 0, invoiced: 0, collected: 0, costToDate: 0, projectedProfit: 0 },
  );

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    quickbooks: qb,
    quickbooksComputedAt: qbComputedAt,
    // Null snapshot is a real state (nothing pushed yet) — the page shows
    // setup guidance rather than an error.
    hasSnapshot: !!qb,
    jobs,
    jobTotals,
    jobsComputedAt: jtComputedAt,
  });
}

// @ts-nocheck
/**
 * Read-time overlays on the cached job costing summary
 * (job_costing_summary_cache.payload.summaries). Moved out of
 * app/api/dashboard/job-costing/route.ts on 2026-10-12 so the production
 * meeting brief can read the same numbers the Job Costing page shows.
 */
import { getSupabase } from '@/app/api/lib/supabase';
import { computeWip, computeSlippage } from './wip';

/** The cached summary with manual % complete and completed-category savings applied. */
export async function readJobCostingSummary(): Promise<any | null> {
  const sb = getSupabase();
  const { data: cached } = await sb.from('job_costing_summary_cache').select('payload, computed_at').eq('key', 'summary').maybeSingle();
  if (!cached?.payload) return null;
  const merged = await mergeCompletionSavings(await mergeManualProgress(cached.payload));
  return { ...merged, cachedAt: cached.computed_at };
}

/**
 * Overlay per-cost-code completion onto the summary rows so the list cards'
 * projected profit matches the detail view. For each job with categories
 * marked complete (job_cost_code_progress.percent_complete >= 100), compute
 * the released budget (budget - committed on those codes, from the job's
 * detail cache breakdown) and subtract it from the projected cost at
 * completion. Fixed-price, still-running jobs only. Read-time overlay —
 * the cached summary always stores base numbers.
 */
export async function mergeCompletionSavings(payload: any): Promise<any> {
  if (!payload?.summaries || !Array.isArray(payload.summaries)) return payload;
  try {
    const sb = getSupabase();
    const { data: rows, error } = await sb
      .from('job_cost_code_progress')
      .select('job_id, cost_code_number, percent_complete')
      .gte('percent_complete', 100);
    if (error || !rows || rows.length === 0) return payload;

    const jobIds = [...new Set(rows.map((r: any) => r.job_id))];
    const { data: caches } = await sb
      .from('job_costing_cache')
      .select('job_id, payload')
      .in('job_id', jobIds);

    const savingsByJob: Record<string, number> = {};
    for (const c of caches || []) {
      const completed = new Set(
        rows.filter((r: any) => r.job_id === c.job_id).map((r: any) => String(r.cost_code_number)),
      );
      let s = 0;
      for (const row of c.payload?.costCodeBreakdown || []) {
        if (completed.has(String(row.costCodeNumber))) {
          s += Math.max(0, (row.estimatedCost || 0) - (row.committedCost || 0));
        }
      }
      if (s > 0) savingsByJob[c.job_id] = Math.round(s * 100) / 100;
    }

    const summaries = payload.summaries.map((s0: any) => {
      const savings = savingsByJob[s0.jobId];
      if (!savings || s0.isCostPlus || s0.isComplete) return s0;
      const totalCosts = s0.totalCosts ?? s0.actualCost ?? 0;
      const baseEac = s0.estimatedCostAtCompletion || 0;
      if (baseEac <= 0) return s0;
      const adjEac = Math.max(totalCosts, Math.round((baseEac - savings) * 100) / 100);
      const contract = s0.contractPrice || 0;
      const margin = Math.round((contract - adjEac) * 100) / 100;
      const marginPct = contract > 0 ? Math.round((margin / contract) * 1000) / 10 : 0;
      return {
        ...s0,
        estimatedCostAtCompletion: adjEac,
        costToComplete: Math.round(Math.max(0, adjEac - totalCosts) * 100) / 100,
        margin,
        marginPct,
        completedSavings: savings,
      };
    });
    return { ...payload, summaries };
  } catch (err: any) {
    console.warn('[job-costing summary] mergeCompletionSavings failed:', err?.message || err);
    return payload;
  }
}

/**
 * Hydrate each summary row with its latest job_manual_progress value, so
 * editing % complete on the list updates the row without a full recompute.
 *
 * The original version filtered with .in('job_id', jobIds). That returned
 * an empty result set in production even though the rows exist — most
 * likely a URL encoding quirk in the Supabase JS client when the IN list
 * is built into a long querystring. The table is tiny (a handful of
 * rows), so we just fetch them all and map by id locally. Errors are now
 * logged (not swallowed) so future regressions are visible in Vercel
 * logs.
 */
export async function mergeManualProgress(payload: any): Promise<any> {
  if (!payload?.summaries || !Array.isArray(payload.summaries)) return payload;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('job_manual_progress')
      .select('job_id, percent_complete, set_at');
    if (error) {
      console.error('[job-costing summary] mergeManualProgress query error:', error.message);
      return payload;
    }
    const map = new Map<string, { percentComplete: number; setAt: string }>();
    for (const row of data || []) {
      map.set(row.job_id, { percentComplete: row.percent_complete, setAt: row.set_at });
    }
    const summaries = payload.summaries.map((s: any) => {
      const m = map.get(s.jobId);
      const manualPct = m?.percentComplete ?? null;
      // Recompute WIP + Slippage when a manual % is on the job. Two
      // rules per Nathan (2026-07-06):
      //   - WIP: manual value only overrides cost-based when it is
      //     exactly 100 (job marked fully complete). Mid-project
      //     manual values stay informational only.
      //   - Slippage: uses whatever manual is set at any value >0.
      //     That's the only way the projection has a useful signal;
      //     cost-based % would produce a tautological projection
      //     (projected = budget always).
      let overlays: Record<string, any> = {};
      if (manualPct !== null && manualPct > 0) {
        const isCostPlus = !!s.isCostPlus;
        const contractPrice = Number(s.contractPrice ?? 0);
        const estimatedCost = Number(s.estimatedCost ?? 0);
        const totalCosts = Number(s.totalCosts ?? s.actualCost ?? 0);
        const invoicedAmount = Number(s.invoicedAmount ?? 0);
        const manualFraction = manualPct / 100;

        const wip = computeWip({
          isCostPlus,
          totalCosts,
          estimatedCost,
          contractPrice,
          invoicedAmount,
          // Only pass manual value to WIP when it's 100 - the compute-
          // Wip gate itself also enforces >=1, but be explicit here.
          manualPercentComplete: manualPct >= 100 ? manualFraction : null,
        });
        const slip = computeSlippage({
          isCostPlus,
          contractPrice,
          estimatedCost,
          totalCosts,
          percentComplete: manualFraction,
        });
        // A manual 100% override means the work is done, so no further cost
        // can land: EAC collapses to what's been committed and the unspent
        // budget becomes real margin. Recompute margin to match, otherwise a
        // job Nathan has marked complete would still be projecting cost from
        // a budget that will never be spent. (Cost-plus has no contract to
        // project against, so it's left alone.)
        const marginOverlay: Record<string, any> = {};
        if (!isCostPlus && manualPct >= 100 && contractPrice > 0) {
          const m = contractPrice - totalCosts;
          marginOverlay.isComplete = true;
          marginOverlay.estimatedCostAtCompletion = Math.round(totalCosts * 100) / 100;
          marginOverlay.costToComplete = 0;
          marginOverlay.margin = Math.round(m * 100) / 100;
          marginOverlay.marginPct = Math.round((m / contractPrice) * 1000) / 10;
        }

        overlays = {
          ...marginOverlay,
          wipStatus: wip.status,
          costBasedPercent: wip.costBasedPercent,
          earnedRevenue: wip.earnedRevenue,
          overUnderBilled: wip.overUnderBilled,
          overUnderPercent: wip.overUnderPercent,
          slippageStatus: slip.status,
          slippageDollars: slip.slippageDollars,
          slippagePoints: slip.slippagePoints,
          slippagePctOfContract: slip.slippagePctOfContract,
          projectedFinalCost: slip.projectedFinalCost,
          originalMarginPct: slip.originalMarginPct,
          projectedMarginPct: slip.projectedMarginPct,
        };
      }
      return {
        ...s,
        manualPercentComplete: manualPct,
        manualPercentSetAt: m?.setAt ?? null,
        ...overlays,
      };
    });
    return { ...payload, summaries };
  } catch (err: any) {
    console.error('[job-costing summary] mergeManualProgress threw:', err?.message || err);
    return payload;
  }
}

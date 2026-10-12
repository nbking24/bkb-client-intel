// @ts-nocheck
/**
 * Production Meeting: the money read.
 *
 * Reads the two nightly caches the Hub already keeps, so the meeting shows the
 * same numbers as the Job Costing and Invoicing pages:
 *   job_costing_summary_cache  contract, cost to date, projected margin, WIP, slippage
 *   agent_cache 'invoicing-health-report'  billing health, unbilled change orders
 *
 * Two outputs per job:
 *   money   the dollar detail, sent to owners only (Nathan's panel)
 *   flags   plain-language flags with no dollar amounts, shown to the room
 */
import { getSupabase } from '@/app/api/lib/supabase';
import { readJobCostingSummary } from '@/app/lib/job-costing-overlays';

export async function readMoney() {
  const sb = getSupabase();
  const [costing, inv] = await Promise.all([
    readJobCostingSummary().catch(() => null),
    sb.from('agent_cache').select('data, updated_at').eq('key', 'invoicing-health-report').maybeSingle().then((r) => r.data).catch(() => null),
  ]);
  const byJob: Record<string, any> = {};
  for (const s of costing?.summaries || []) byJob[s.jobId] = { costing: s };
  for (const c of inv?.data?.contractJobs || []) (byJob[c.jobId] = byJob[c.jobId] || {}).contract = c;
  for (const c of inv?.data?.costPlusJobs || []) (byJob[c.jobId] = byJob[c.jobId] || {}).costPlus = c;
  const costingAt = costing?.cachedAt || null;
  const invoicingAt = inv?.updated_at || inv?.data?.generatedAt || null;
  const age = (t) => (t ? (Date.now() - new Date(t).getTime()) / 86400000 : null);
  // Older than this, a cache is shown as stale and its flags are switched off,
  // so the room never acts on old numbers.
  const costingStale = costingAt == null || age(costingAt) > STALE_DAYS;
  const invoicingStale = invoicingAt == null || age(invoicingAt) > STALE_DAYS;
  for (const m of Object.values(byJob)) { m.costingStale = costingStale; m.invoicingStale = invoicingStale; }
  return { byJob, costingAt, invoicingAt, costingStale, invoicingStale };
}

export const STALE_DAYS = 3;

const r0 = (n: any) => (n == null || Number.isNaN(Number(n)) ? null : Math.round(Number(n)));
const r1 = (n: any) => (n == null || Number.isNaN(Number(n)) ? null : Math.round(Number(n) * 10) / 10);

/** Dollar detail for one job (owners only). */
export function moneyFor(m: any) {
  if (!m) return null;
  const s = m.costing || {};
  const c = m.contract || null;
  const p = m.costPlus || null;
  return {
    priceType: s.isCostPlus ? 'Cost plus' : s.priceType === 'fixed' || c ? 'Fixed price' : s.priceType || '',
    contract: r0(c?.totalContractAndCOValue ?? s.contractPrice),
    approvedCOs: r0(c?.approvedCOValue),
    costToDate: r0(s.totalCosts ?? s.actualCost),
    budgetCost: r0(s.estimatedCost),
    invoiced: r0(c?.invoicedToDate ?? p?.totalInvoiced ?? s.invoicedAmount),
    collected: r0(s.collectedAmount),
    invoicedPct: r1(c?.invoicedPercent),
    pctComplete: s.manualPercentComplete ?? (s.costBasedPercent != null ? r1(s.costBasedPercent * 100) : null),
    pctSource: s.manualPercentComplete != null ? 'PM' : s.costBasedPercent != null ? 'cost' : null,
    marginPct: r1(s.marginPct),
    originalMarginPct: s.originalMarginPct != null ? r1(s.originalMarginPct * 100) : null,
    projectedMarginPct: s.projectedMarginPct != null ? r1(s.projectedMarginPct * 100) : null,
    slippagePoints: r1(s.slippagePoints),
    slippageStatus: s.slippageStatus || 'na',
    health: s.health || null,
    wipStatus: s.wipStatus || c?.wipStatus || 'na',
    overUnderBilled: r0(s.overUnderBilled ?? c?.overUnderBilled),
    unbilledCO: r0(c?.unbilledCOAmount),
    unbilledCostPlus: r0(p?.unbilledAmount),
    daysSinceInvoice: p?.daysSinceLastInvoice ?? null,
    billingHealth: c?.health || p?.health || null,
    billingAlerts: [...(c?.alerts || []), ...(p?.alerts || [])],
    costAlerts: s.alerts || [],
  };
}

/**
 * Room-safe flags from the money read. No dollar amounts: the room sees what to
 * act on, Nathan sees the numbers in his panel.
 */
export function moneyFlags(m: any, add: (sev: string, kind: string, key: string, text: string, owner: string) => void, opts: { punch?: boolean } = {}) {
  if (!m) return;
  const s = m.costing || {};
  const c = m.contract || null;
  const p = m.costPlus || null;
  if (m.costingStale) return moneyFlagsBilling(m, add, opts);
  if (!opts.punch && (s.slippageStatus === 'slipping' || s.health === 'over-budget')) {
    add('red', 'Cost running over', 'cost',
      s.slippageStatus === 'slipping'
        ? 'Projected cost is running ahead of the budget, so the margin is slipping. Nathan reviews the numbers; the room looks for the cause (extra labor, missed scope, a change not priced).'
        : 'Cost to date is over the budget on this job. Nathan reviews the numbers; the room looks for the cause (extra labor, missed scope, a change not priced).', 'Nathan');
  }
  moneyFlagsBilling(m, add, opts);
}

function moneyFlagsBilling(m: any, add: any, opts: { punch?: boolean }) {
  if (m.invoicingStale) return;
  const s = m.costing || {};
  const c = m.contract || null;
  const p = m.costPlus || null;
  const billing = c?.health || p?.health;
  if (billing === 'overdue' || billing === 'critical') {
    add('amber', 'Billing behind', 'billing',
      p ? `Cost-plus billing is due${p.daysSinceLastInvoice != null ? `: last invoice ${p.daysSinceLastInvoice} days ago` : ': no invoice yet'}. Bill the costs and hours to date.`
        : 'There is billable work not invoiced yet (extra items or labor hours). Bill it on the next invoice.', 'Terri');
  }
  if ((c?.unbilledCOAmount || 0) > 0) {
    add('amber', 'Change order not invoiced', 'co', 'An approved change order has not been invoiced yet. Add it to the next invoice or schedule its payment.', 'Terri');
  }
  // the invoicing report computes WIP from fresh costs; prefer it over the costing cache
  const wip = c?.wipStatus || (m.costingStale ? null : s.wipStatus);
  if (wip === 'behind' && !opts.punch) {
    add('amber', 'Under-billed', 'wip', 'Invoiced less than the work done so far (more than 5% behind). Check the next payment milestone is due and on the schedule.', 'Terri');
  }
  if (opts.punch && c && (c.invoicedPercent ?? 100) < 99.5) {
    add('amber', 'Final invoice', 'final', 'Not fully invoiced yet. Send the final invoice once the punch list is done.', 'Terri');
  }
}

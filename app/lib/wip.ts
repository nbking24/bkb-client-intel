// ============================================================
// WIP (Work in Progress) reporting math.
//
// Shared by the job costing dashboard (full breakdown) and the
// invoicing dashboard (lightweight icon). Fixed-price only -
// cost-plus jobs bill actual costs and don't have an "earned
// revenue" concept, so we don't compute WIP for them.
//
// The formulas mirror JobTread's standard WIP view:
//
//   Cost-based % complete = (actual + pending costs) / budgeted cost
//   Earned revenue        = % complete  ×  approved contract price
//   Over / under billed   = invoiced to date  -  earned revenue
//
// A positive over/under is "over-billed" (billings ahead of work
// performed) - a liability, the client paid for work BKB hasn't
// done yet. Negative is "under-billed" - work performed that
// hasn't been invoiced.
//
// Threshold: ±5% of contract price is treated as on-track. Outside
// that range, the job is "ahead" (over-billed) or "behind"
// (under-billed). Confirmed with Nathan on 2026-06-29.
// ============================================================

export type WipStatus = 'on_track' | 'ahead' | 'behind' | 'na';

export interface WipInputs {
  isCostPlus: boolean;
  /** Sum of all paid + pending vendor costs to date. */
  totalCosts: number;
  /** Estimated cost at completion (budget side of approved CO docs). */
  estimatedCost: number;
  /** Approved contract value (price side of approved CO docs). */
  contractPrice: number;
  /** Sum of approved + pending customer invoices issued to date. */
  invoicedAmount: number;
}

export interface WipResult {
  status: WipStatus;
  /** 0..1 cost-based completion ratio. null when we can't compute it. */
  costBasedPercent: number | null;
  /** Dollar value of work completed = costBasedPercent × contractPrice. */
  earnedRevenue: number;
  /** invoicedAmount - earnedRevenue. Positive = over-billed (ahead). */
  overUnderBilled: number;
  /** overUnderBilled / contractPrice. Used to compare against the ±5% threshold. */
  overUnderPercent: number;
}

/**
 * The on-track threshold as a fraction of contract value. ±5% per
 * Nathan's spec. Exposed so the UI tooltip can describe it.
 */
export const WIP_TOLERANCE = 0.05;

export function computeWip(input: WipInputs): WipResult {
  // Cost-plus jobs don't have a contract / earned-revenue model. We
  // emit a result-shaped object so consumers can destructure freely,
  // but status='na' signals "do not render".
  if (input.isCostPlus || input.contractPrice <= 0 || input.estimatedCost <= 0) {
    return {
      status: 'na',
      costBasedPercent: null,
      earnedRevenue: 0,
      overUnderBilled: 0,
      overUnderPercent: 0,
    };
  }

  // Clamp to 0..1. Going over 100% complete by cost means the job is
  // over budget, but for the WIP earned-revenue calculation we cap at
  // 100% (you can't earn more than the contract).
  const rawPercent = input.totalCosts / input.estimatedCost;
  const costBasedPercent = Math.min(1, Math.max(0, rawPercent));
  const earnedRevenue = costBasedPercent * input.contractPrice;
  const overUnderBilled = input.invoicedAmount - earnedRevenue;
  const overUnderPercent = overUnderBilled / input.contractPrice;

  let status: WipStatus;
  if (Math.abs(overUnderPercent) <= WIP_TOLERANCE) {
    status = 'on_track';
  } else if (overUnderPercent > 0) {
    status = 'ahead';
  } else {
    status = 'behind';
  }

  return {
    status,
    costBasedPercent,
    earnedRevenue: Math.round(earnedRevenue * 100) / 100,
    overUnderBilled: Math.round(overUnderBilled * 100) / 100,
    overUnderPercent,
  };
}

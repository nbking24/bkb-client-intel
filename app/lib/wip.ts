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

// ============================================================
// SLIPPAGE - margin erosion between bid and projected completion.
//
// Answers: "How much of my original bid margin am I on track to
// lose (or gain) by the time this job wraps?"
//
// Original margin $ = contractPrice - estimatedCost   (at bid time)
// Projected final cost = actualCost ÷ percentComplete (extrapolate today's burn to 100%)
// Projected margin $ = contractPrice - projected final cost
// Slippage $ = original margin - projected margin      (positive = eroding, negative = ahead)
// Slippage points = originalMargin% - projectedMargin% (percentage points of GM lost)
//
// Positive slippage is BAD (margin eroding). Negative is GOOD (job
// running under budget). Tolerance ±2 percentage points is treated
// as on-track.
// ============================================================

export type SlippageStatus = 'gained' | 'on_track' | 'slipping' | 'na';

export interface SlippageInputs {
  isCostPlus: boolean;
  contractPrice: number;
  estimatedCost: number;
  actualCost: number;
  /**
   * 0..1 fraction complete. Prefer Nathan's manual % complete when
   * set (from job_manual_progress); otherwise fall back to cost-based
   * % (actual/budget). If neither is available or valid, slippage is
   * unavailable (status='na').
   */
  percentComplete: number | null;
}

export interface SlippageResult {
  status: SlippageStatus;
  originalMarginDollars: number;      // contractPrice - estimatedCost
  originalMarginPct: number;          // originalMarginDollars / contractPrice
  projectedFinalCost: number | null;  // actualCost / percentComplete (null when N/A)
  projectedMarginDollars: number | null;
  projectedMarginPct: number | null;
  /** Positive = eroding (bad). Rounded to whole dollars. */
  slippageDollars: number | null;
  /** Percentage points of GM lost. Positive = margin points shed. */
  slippagePoints: number | null;
  /** slippageDollars / contractPrice - useful for the same 5% tolerance framing WIP uses. */
  slippagePctOfContract: number | null;
}

/** Points of margin (originalMargin% - projectedMargin%) within this band = on-track. */
export const SLIPPAGE_TOLERANCE_POINTS = 2;

export function computeSlippage(input: SlippageInputs): SlippageResult {
  const contract = input.contractPrice;
  const budget = input.estimatedCost;
  const actual = input.actualCost;

  // Cost-plus and jobs without a contract can't have "margin slippage"
  // in the fixed-price sense - they bill actual costs. We surface na.
  if (input.isCostPlus || contract <= 0 || budget <= 0) {
    return {
      status: 'na',
      originalMarginDollars: 0,
      originalMarginPct: 0,
      projectedFinalCost: null,
      projectedMarginDollars: null,
      projectedMarginPct: null,
      slippageDollars: null,
      slippagePoints: null,
      slippagePctOfContract: null,
    };
  }

  const originalMarginDollars = contract - budget;
  const originalMarginPct = originalMarginDollars / contract;

  // % complete must be > 0 and finite to project. Also cap at 1.
  const pctRaw = input.percentComplete;
  if (pctRaw === null || !Number.isFinite(pctRaw) || pctRaw <= 0) {
    return {
      status: 'na',
      originalMarginDollars: Math.round(originalMarginDollars),
      originalMarginPct,
      projectedFinalCost: null,
      projectedMarginDollars: null,
      projectedMarginPct: null,
      slippageDollars: null,
      slippagePoints: null,
      slippagePctOfContract: null,
    };
  }
  const pct = Math.min(1, pctRaw);

  const projectedFinalCost = actual / pct;
  const projectedMarginDollars = contract - projectedFinalCost;
  const projectedMarginPct = projectedMarginDollars / contract;
  const slippageDollars = originalMarginDollars - projectedMarginDollars;
  const slippagePoints = (originalMarginPct - projectedMarginPct) * 100;
  const slippagePctOfContract = slippageDollars / contract;

  let status: SlippageStatus;
  if (Math.abs(slippagePoints) <= SLIPPAGE_TOLERANCE_POINTS) {
    status = 'on_track';
  } else if (slippagePoints > 0) {
    status = 'slipping';
  } else {
    status = 'gained';
  }

  return {
    status,
    originalMarginDollars: Math.round(originalMarginDollars),
    originalMarginPct,
    projectedFinalCost: Math.round(projectedFinalCost),
    projectedMarginDollars: Math.round(projectedMarginDollars),
    projectedMarginPct,
    slippageDollars: Math.round(slippageDollars),
    slippagePoints: Math.round(slippagePoints * 10) / 10,
    slippagePctOfContract,
  };
}

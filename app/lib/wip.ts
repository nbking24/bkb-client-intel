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
  /**
   * Nathan's manual % complete (0..1) when set. Overrides the cost-
   * based % for the earned-revenue calculation. If null, WIP falls
   * back to cost-based % (totalCosts / estimatedCost) as before.
   * Rationale: on wrap-up jobs the operator has better ground truth
   * ("work is done, only paying pending bills") than the cost ratio
   * can express.
   */
  manualPercentComplete?: number | null;
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

  // Nathan's rule (2026-07-06): WIP uses cost-based % during a project
  // and only respects the manual override when it is set to exactly
  // 100 (job marked fully complete + fully billed). Mid-project
  // manual values are subjective; the objective cost-basis is the
  // right earned-revenue signal until the operator declares closure.
  // Clamp to 0..1. Cost over 100% = over budget, but earned-revenue
  // caps at 100% (can't earn more than the contract).
  const rawCostPercent = input.totalCosts / input.estimatedCost;
  const costBasedPercent = Math.min(1, Math.max(0, rawCostPercent));
  const manualPct = input.manualPercentComplete;
  const manuallyClosed = manualPct != null && manualPct >= 1;
  const percentComplete = manuallyClosed ? 1 : costBasedPercent;
  const earnedRevenue = percentComplete * input.contractPrice;
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
    // Keep this field name for backwards compat but note it now
    // reflects whichever % drove the earned-revenue calc (manual
    // when set, cost-based otherwise). Callers relying on the raw
    // cost ratio can compute totalCosts / estimatedCost themselves.
    costBasedPercent: percentComplete,
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
  /**
   * Paid + committed vendor costs to date. Used as the numerator for
   * projected final cost - INCLUDES pending bills. On a wrap-up job
   * with big pending bills, using paid-only actualCost undershoots
   * the projection dramatically.
   */
  totalCosts: number;
  /**
   * 0..1 fraction complete. Prefer Nathan's manual % complete when
   * set (from job_manual_progress); otherwise fall back to cost-based
   * % (totalCosts / estimatedCost). If neither is available or valid,
   * slippage is unavailable (status='na').
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
  const totalSpent = input.totalCosts;

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

  // Projected final cost = committed cost / fraction complete. We use
  // totalCosts (paid + pending) not just paid actualCost - a wrap-up
  // job with big pending bills would otherwise project a wildly low
  // final cost and show fake "gained margin". At 100% complete this
  // resolves to totalCosts (no extrapolation, no more cost expected).
  const projectedFinalCost = totalSpent / pct;
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


// ============================================================
// COMPLETION — is the work finished?
//
// Matters for margin: on a FINISHED fixed-price job, budget that was
// never spent is real margin. On a RUNNING job, that budget will be
// spent, so it must be subtracted before quoting a final margin.
//
// BKB's JT status ladder (per Nathan, 2026-07-14):
//   1. Lead ... 5. Design Phase ... 6. In Production
//   6.5 Ongoing / Punch List      <- still incurring cost
//   7. Final Billing              <- WORK DONE
//   10. Ready / 11. Closed        <- WORK DONE
//
// "6.5 Ongoing / Punch List" is deliberately NOT complete: punch work
// still burns labor and materials.
// ============================================================
const COMPLETE_STATUSES = ['final billing', 'closed', 'completed'];

export function isJobComplete(
  closedOn: string | null | undefined,
  customStatus: string | null | undefined,
  manualPercentComplete?: number | null,
): boolean {
  if (closedOn) return true;
  if (manualPercentComplete != null && manualPercentComplete >= 100) return true;
  const s = (customStatus || '').toLowerCase();
  if (!s) return false;
  // Guard: never let "6.5 Ongoing / Punch List" match on a substring.
  if (s.includes('punch') || s.includes('ongoing')) return false;
  return COMPLETE_STATUSES.some((c) => s.includes(c));
}

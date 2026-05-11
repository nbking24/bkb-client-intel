/**
 * Bill Categorization — matcher, classifier, and queue upsert.
 *
 * Given a job's vendor-bill lines and its approved budget items, this
 * module:
 *   1) classifies each line (uncategorized / miscategorized / budget_gap / good)
 *   2) produces a ranked list of candidate budget items the line could
 *      link to, using (in order) the learned pattern store, an exact
 *      cost-code match, a cost-code-family match, and vendor history
 *      on the same job
 *   3) writes flagged rows into bill_review_queue so the overview card
 *      can show them, and auto-clears previously flagged rows that are
 *      now categorized correctly
 *
 * Day-1 autonomy: we never mutate JT from here — Nathan approves from
 * the review card, and the approval endpoint (not this module) is what
 * actually calls updateDocumentCostItem. See app/api/dashboard/bill-review/*.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobBillLine, JobBudgetItem } from './jobtread';

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

/** 2-digit cost codes we treat as administrative placeholders. A line
 * using one of these is NOT counted as miscategorized even if its own
 * cost code disagrees with the budget bucket — these codes are the
 * result of users picking "Uncategorized" (07) or "Billable" (23)
 * from a short list instead of the full pricebook. The budget-side
 * cost code is the source of truth in those cases. */
const ADMIN_COST_CODES = new Set(['07', '23']);

/** sub_type_token mapping — see the BKB pricebook: 01=Labor, 02=Sub,
 * 03=Material. This is the trailing 2 digits of a 4-digit code. */
export function extractSubTypeToken(costCodeNumber: string | null): string | null {
  if (!costCodeNumber) return null;
  const trimmed = costCodeNumber.trim();
  if (trimmed.length < 4) return null;
  const suffix = trimmed.slice(-2);
  if (['01', '02', '03'].includes(suffix)) return suffix;
  return null;
}

/** First 2 digits of a pricebook code — the "division". */
export function extractDivision(costCodeNumber: string | null): string | null {
  if (!costCodeNumber) return null;
  const trimmed = costCodeNumber.trim();
  if (trimmed.length < 2) return null;
  return trimmed.slice(0, 2);
}

// ------------------------------------------------------------
// Classification
// ------------------------------------------------------------

export type IssueType = 'uncategorized' | 'miscategorized' | 'budget_gap';

/** The classifier's decision for a single bill line. `null` means the
 * line is fine (good bucket — silent, no queue row needed). */
export interface Classification {
  issueType: IssueType | null;
  reason: string;
}

/** Budget items JT auto-creates when a bill lands in a division without a
 * planned item — e.g. "Uncategorized 01 Planning, Admin Subcontractor",
 * "Uncategorized 15 Painting Materials". Lines linked to these aren't on a
 * real planned bucket; they should fall into the same review queue as lines
 * with no budget link at all. Match is case-insensitive and anchored at the
 * start so we don't accidentally catch user-named items containing the word. */
function isJTPlaceholderBudgetItem(budgetItemName: string | null | undefined): boolean {
  if (!budgetItemName) return false;
  return /^uncategorized\b/i.test(budgetItemName.trim());
}

export function classifyBillLine(
  line: JobBillLine,
  budgetItems: JobBudgetItem[]
): Classification {
  // JT-auto-generated "Uncategorized XX ..." buckets are treated as if the
  // line had no real budget link, so they flow into the review queue with
  // suggestions instead of silently passing as "good".
  const linkedToPlaceholder = !!line.jobCostItemId && isJTPlaceholderBudgetItem(line.budgetItemName);
  const hasRealBudgetLink = !!line.jobCostItemId && !linkedToPlaceholder;

  if (!hasRealBudgetLink) {
    // No link (or only a placeholder link) → uncategorized. If there's a
    // matching budget cc, it's a routine fix; if not, it's a planning gap.
    const lineCc = line.lineCostCodeNumber;
    // Exclude placeholder items when checking for a matching real budget
    // bucket — otherwise the placeholder satisfies "hasMatchingBudget" and
    // we mis-classify lines that have no real plan to anchor to.
    const hasMatchingBudget =
      !!lineCc && budgetItems.some(
        b => b.costCodeNumber === lineCc && !isJTPlaceholderBudgetItem(b.name)
      );
    if (!hasMatchingBudget && lineCc && !ADMIN_COST_CODES.has(lineCc)) {
      return {
        issueType: 'budget_gap',
        reason: linkedToPlaceholder
          ? `Line is on JT's auto "${line.budgetItemName}" bucket and no planned budget item exists for cost code ${lineCc}`
          : `Line is uncategorized and no budget item exists for cost code ${lineCc}`,
      };
    }
    return {
      issueType: 'uncategorized',
      reason: linkedToPlaceholder
        ? `Line is on JT's auto "${line.budgetItemName}" bucket (not a real planned budget item)`
        : (lineCc
            ? `Line uses cost code ${lineCc} but is not linked to a budget item`
            : 'Line has no budget link and no cost code'),
    };
  }

  // Linked — check for line-cc vs budget-cc mismatch.
  const lineCc = line.lineCostCodeNumber;
  const budgetCc = line.budgetCostCodeNumber;

  if (!lineCc || !budgetCc) return { issueType: null, reason: 'linked and no cc conflict' };
  if (lineCc === budgetCc) return { issueType: null, reason: 'linked, cc matches budget' };

  // Administrative codes are expected to disagree with the real
  // budget cost code — not a flag.
  if (ADMIN_COST_CODES.has(lineCc)) {
    return { issueType: null, reason: `line uses admin code ${lineCc}, budget=${budgetCc}` };
  }

  // Line and budget disagree, and line isn't an admin placeholder →
  // this is worth Nathan's eyes.
  return {
    issueType: 'miscategorized',
    reason: `Line cost code ${lineCc} disagrees with budget ${budgetCc}`,
  };
}

// ------------------------------------------------------------
// Matcher — candidate budget items for a line
// ------------------------------------------------------------

export interface CandidateBudgetItem {
  jobCostItemId: string;
  name: string | null;
  costCodeId: string | null;
  costCodeNumber: string | null;
  costCodeName: string | null;
  budgetCost: number;
  reason: string;
  score: number;  // 0 – 1; higher = better
}

export type MatchSource =
  | 'learned_pattern'
  | 'cost_code_exact'
  | 'cost_code_family'
  | 'vendor_history'
  | 'none';

export interface MatchResult {
  candidates: CandidateBudgetItem[];   // top N, ordered by score desc
  top: CandidateBudgetItem | null;
  matchSource: MatchSource;
  confidence: number;                  // 0 – 1 for the top candidate
}

/** Fetched-ahead context for the matcher: learned patterns keyed
 * on (vendor_account_id, cost_code_division, sub_type_token). */
export interface LearnedPatternRow {
  vendor_account_id: string;
  cost_code_number: string;             // division, 2-digit
  sub_type_token: string | null;
  target_cost_code_number: string;      // full 4-digit
  target_cost_code_name: string | null;
  target_budget_item_name_hint: string | null;
  vendor_name: string | null;
  times_confirmed: number;
  times_overridden: number;
}

/** Vendor-history context — budget items each vendor was previously
 * linked to on this same job. Used as a last-ditch suggestion. */
export type VendorHistory = Map<string, Map<string, number>>;
// vendor_account_id -> (jobCostItemId -> times seen)

export function buildVendorHistoryFromLines(lines: JobBillLine[]): VendorHistory {
  const map: VendorHistory = new Map();
  for (const line of lines) {
    if (!line.vendorAccountId || !line.jobCostItemId) continue;
    if (!map.has(line.vendorAccountId)) map.set(line.vendorAccountId, new Map());
    const inner = map.get(line.vendorAccountId)!;
    inner.set(line.jobCostItemId, (inner.get(line.jobCostItemId) || 0) + 1);
  }
  return map;
}

export function matchBudgetItem(
  line: JobBillLine,
  budgetItems: JobBudgetItem[],
  patterns: LearnedPatternRow[],
  vendorHistory: VendorHistory
): MatchResult {
  const candidates: CandidateBudgetItem[] = [];

  // Strip JT-auto placeholder buckets from the suggestion pool. We never want
  // to "suggest" moving a line from one Uncategorized bucket to another — the
  // whole point of flagging is to route it onto a real planned budget item.
  const plannedBudgetItems = budgetItems.filter(b => !/^uncategorized\b/i.test((b.name || '').trim()));

  const lineCc = line.lineCostCodeNumber;
  const lineDiv = extractDivision(lineCc);
  const lineSub = extractSubTypeToken(lineCc);

  // ---- 1) Learned patterns ----------------------------------
  // (vendor_account_id, division, sub_type_token) can now have MULTIPLE
  // stored targets (migration 011). Surface each as its own candidate
  // ranked by share of approvals, so a vendor that legitimately splits
  // between two divisions gets both options offered instead of the
  // matcher flipping the single stored target each time. Resolve each
  // target to an actual budget item on this job.
  if (line.vendorAccountId && lineDiv) {
    const hits = patterns.filter(p =>
      p.vendor_account_id === line.vendorAccountId &&
      p.cost_code_number === lineDiv &&
      (p.sub_type_token ?? null) === lineSub
    );
    const totalConfirms = hits.reduce((s, h) => s + (h.times_confirmed || 0), 0);
    // Sort by confirm count desc so the most-learned target is the top
    // candidate the matcher emits, and downstream consumers preserve the
    // priority when the candidate list gets sorted again by score.
    const ranked = hits.slice().sort((a, b) => (b.times_confirmed || 0) - (a.times_confirmed || 0));
    for (const hit of ranked) {
      const bItem = plannedBudgetItems.find(b => b.costCodeNumber === hit.target_cost_code_number);
      if (!bItem) continue;
      // Score blends (a) absolute confirmation count (rewards well-trained
      // patterns) and (b) share of approvals (down-weights a target that
      // only gets picked occasionally vs the alternatives). Cap at 0.95 so
      // a learned pattern never beats a manually-picked candidate's 1.0.
      const share = totalConfirms > 0 ? (hit.times_confirmed || 0) / totalConfirms : 1;
      const absBoost = Math.min(0.45, 0.05 * (hit.times_confirmed || 1));
      const score = Math.min(0.95, 0.5 + absBoost + 0.4 * share);
      const shareLabel = ranked.length > 1 ? `, ${Math.round(share * 100)}% of approvals` : '';
      candidates.push({
        jobCostItemId: bItem.id,
        name: bItem.name,
        costCodeId: bItem.costCodeId,
        costCodeNumber: bItem.costCodeNumber,
        costCodeName: bItem.costCodeName,
        budgetCost: bItem.cost,
        reason: `Learned: ${hit.vendor_name || 'this vendor'} + cc${lineDiv}${lineSub ? lineSub : ''} → ${bItem.costCodeNumber} (confirmed ${hit.times_confirmed}x${shareLabel})`,
        score,
      });
    }
  }

  // ---- 2) Cost code exact match ------------------------------
  if (lineCc && !ADMIN_COST_CODES.has(lineCc)) {
    const matches = plannedBudgetItems.filter(b => b.costCodeNumber === lineCc);
    for (const b of matches) {
      // If we've already added it from learned pattern, skip dup.
      if (candidates.some(c => c.jobCostItemId === b.id)) continue;
      const score = matches.length === 1 ? 0.85 : 0.7;
      candidates.push({
        jobCostItemId: b.id,
        name: b.name,
        costCodeId: b.costCodeId,
        costCodeNumber: b.costCodeNumber,
        costCodeName: b.costCodeName,
        budgetCost: b.cost,
        reason: matches.length === 1
          ? `Exact cost code match (${lineCc})`
          : `Cost code match (${lineCc}) — ${matches.length} budget items share this code`,
        score,
      });
    }
  }

  // ---- 3) Cost code family (same division + sub_type) --------
  if (lineDiv && lineSub && !ADMIN_COST_CODES.has(lineCc ?? '')) {
    const familyCode = lineDiv + lineSub;
    const matches = plannedBudgetItems.filter(b =>
      b.costCodeNumber === familyCode ||
      (extractDivision(b.costCodeNumber) === lineDiv &&
       extractSubTypeToken(b.costCodeNumber) === lineSub)
    );
    for (const b of matches) {
      if (candidates.some(c => c.jobCostItemId === b.id)) continue;
      candidates.push({
        jobCostItemId: b.id,
        name: b.name,
        costCodeId: b.costCodeId,
        costCodeNumber: b.costCodeNumber,
        costCodeName: b.costCodeName,
        budgetCost: b.cost,
        reason: `Same division + sub-type (${familyCode})`,
        score: 0.6,
      });
    }
  }

  // ---- 3b) Cost code division only --------------------------
  // If line is 2-digit code (e.g. "10"), match any budget item in
  // division "10" — lower confidence than a 4-digit match.
  if (lineCc && lineCc.length === 2 && !ADMIN_COST_CODES.has(lineCc)) {
    const matches = plannedBudgetItems.filter(b => extractDivision(b.costCodeNumber) === lineCc);
    for (const b of matches) {
      if (candidates.some(c => c.jobCostItemId === b.id)) continue;
      candidates.push({
        jobCostItemId: b.id,
        name: b.name,
        costCodeId: b.costCodeId,
        costCodeNumber: b.costCodeNumber,
        costCodeName: b.costCodeName,
        budgetCost: b.cost,
        reason: `Division match (${lineCc})`,
        score: 0.5,
      });
    }
  }

  // ---- 4) Vendor history on this job ------------------------
  if (line.vendorAccountId) {
    const inner = vendorHistory.get(line.vendorAccountId);
    if (inner && inner.size > 0) {
      // Most-used historical bucket
      const sorted = Array.from(inner.entries()).sort((a, b) => b[1] - a[1]);
      for (const [jciId, seen] of sorted) {
        // Skip if this is the SAME jobCostItem the current line already
        // points at — we can't "suggest" what's already linked.
        if (line.jobCostItemId && jciId === line.jobCostItemId) continue;
        const b = plannedBudgetItems.find(b => b.id === jciId);
        if (!b) continue;
        if (candidates.some(c => c.jobCostItemId === b.id)) continue;
        candidates.push({
          jobCostItemId: b.id,
          name: b.name,
          costCodeId: b.costCodeId,
          costCodeNumber: b.costCodeNumber,
          costCodeName: b.costCodeName,
          budgetCost: b.cost,
          reason: `${line.vendorName || 'This vendor'} has ${seen} other line${seen === 1 ? '' : 's'} on this budget item on this job`,
          score: Math.min(0.55, 0.35 + 0.05 * seen),
        });
      }
    }
  }

  // Rank and pick top. If the line is currently linked to one of the
  // candidates, drop that candidate from the list — we don't need to
  // "suggest" the current state.
  const filtered = candidates.filter(c => c.jobCostItemId !== line.jobCostItemId);
  filtered.sort((a, b) => b.score - a.score);

  const top = filtered[0] || null;
  let matchSource: MatchSource = 'none';
  if (top) {
    // Infer source from the reason prefix — cheap but stable.
    if (top.reason.startsWith('Learned:')) matchSource = 'learned_pattern';
    else if (top.reason.startsWith('Exact')) matchSource = 'cost_code_exact';
    else if (top.reason.startsWith('Cost code match')) matchSource = 'cost_code_exact';
    else if (top.reason.startsWith('Same division')) matchSource = 'cost_code_family';
    else if (top.reason.startsWith('Division match')) matchSource = 'cost_code_family';
    else matchSource = 'vendor_history';
  }

  return {
    candidates: filtered.slice(0, 5),
    top,
    matchSource,
    confidence: top?.score || 0,
  };
}

// ------------------------------------------------------------
// Queue upsert / auto-clear
// ------------------------------------------------------------

export interface ScanJobResult {
  jobId: string;
  jobName: string;
  jobNumber: string | null;
  linesScanned: number;
  linesUncategorized: number;
  linesMiscategorized: number;
  linesBudgetGap: number;
  linesGood: number;
  newlyFlagged: number;
  autoCleared: number;
  rowsUpserted: number;
}

/**
 * Classify every line on a job, match, and write pending rows into
 * bill_review_queue. Previously-pending rows that are now "good" are
 * auto-dismissed with a system note.
 */
export async function scanJobBills(
  supabase: SupabaseClient,
  job: { id: string; name: string; number: string | null },
  lines: JobBillLine[],
  budgetItems: JobBudgetItem[],
  patterns: LearnedPatternRow[]
): Promise<ScanJobResult> {
  const vendorHistory = buildVendorHistoryFromLines(lines);

  const result: ScanJobResult = {
    jobId: job.id,
    jobName: job.name,
    jobNumber: job.number,
    linesScanned: lines.length,
    linesUncategorized: 0,
    linesMiscategorized: 0,
    linesBudgetGap: 0,
    linesGood: 0,
    newlyFlagged: 0,
    autoCleared: 0,
    rowsUpserted: 0,
  };

  // Track which (documentId, costItemId) we flagged this run so we can
  // auto-dismiss stale rows below.
  const flaggedKeys = new Set<string>();

  for (const line of lines) {
    const cls = classifyBillLine(line, budgetItems);

    if (!cls.issueType) {
      result.linesGood++;
      continue;
    }

    if (cls.issueType === 'uncategorized') result.linesUncategorized++;
    else if (cls.issueType === 'miscategorized') result.linesMiscategorized++;
    else if (cls.issueType === 'budget_gap') result.linesBudgetGap++;

    const match = matchBudgetItem(line, budgetItems, patterns, vendorHistory);

    const key = `${line.documentId}::${line.costItemId}`;
    flaggedKeys.add(key);

    // Upsert the row. Key = (document_id, cost_item_id).
    const now = new Date().toISOString();
    const { data: existing } = await supabase
      .from('bill_review_queue')
      .select('id, status, first_seen_at')
      .eq('document_id', line.documentId)
      .eq('cost_item_id', line.costItemId)
      .maybeSingle();

    const payload = {
      job_id: job.id,
      job_name: job.name,
      job_number: job.number,
      document_id: line.documentId,
      document_number: line.documentNumber,
      cost_item_id: line.costItemId,
      vendor_account_id: line.vendorAccountId,
      vendor_name: line.vendorName,
      line_name: line.lineName,
      line_description: line.lineDescription,
      line_cost: line.cost,
      line_cost_code_number: line.lineCostCodeNumber,
      line_cost_code_name: line.lineCostCodeName,
      current_job_cost_item_id: line.jobCostItemId,
      current_budget_cost_code_number: line.budgetCostCodeNumber,
      current_budget_cost_code_name: line.budgetCostCodeName,
      issue_type: cls.issueType,
      suggested_job_cost_item_id: match.top?.jobCostItemId || null,
      suggested_budget_item_name: match.top?.name || null,
      suggested_cost_code_number: match.top?.costCodeNumber || null,
      suggested_cost_code_name: match.top?.costCodeName || null,
      match_source: match.matchSource,
      match_confidence: match.confidence,
      candidate_budget_items: match.candidates,
      last_seen_at: now,
      updated_at: now,
    };

    if (existing) {
      // Already-known flag. Refresh it, but don't reset status if
      // Nathan already approved/applied/dismissed.
      if (existing.status === 'pending' || existing.status === 'failed') {
        // For previously-failed rows, also reset status back to 'pending'
        // and clear last_error — the issue is still present, the prior
        // apply attempt should be retried (often the prior error was a
        // transient JT issue or a bug we've since fixed).
        const updatePayload =
          existing.status === 'failed'
            ? { ...payload, status: 'pending', last_error: null }
            : payload;
        await supabase
          .from('bill_review_queue')
          .update(updatePayload)
          .eq('id', existing.id);
        result.rowsUpserted++;
      } else {
        // Already approved / applied / dismissed — leave it alone.
      }
    } else {
      await supabase
        .from('bill_review_queue')
        .insert({ ...payload, status: 'pending', first_seen_at: now });
      result.newlyFlagged++;
      result.rowsUpserted++;
    }
  }

  // Auto-dismiss previously-pending rows on this job that are no
  // longer in the flagged set (line was categorized correctly between
  // runs, either by Nathan in JT or by the approval endpoint).
  const { data: staleRows } = await supabase
    .from('bill_review_queue')
    .select('id, document_id, cost_item_id')
    .eq('job_id', job.id)
    .eq('status', 'pending');

  for (const row of staleRows || []) {
    const key = `${row.document_id}::${row.cost_item_id}`;
    if (flaggedKeys.has(key)) continue;
    await supabase
      .from('bill_review_queue')
      .update({
        status: 'dismissed',
        approved_by: 'system',
        approved_at: new Date().toISOString(),
        last_error: 'Auto-dismissed — line is no longer flagged (categorized correctly)',
      })
      .eq('id', row.id);
    result.autoCleared++;
  }

  return result;
}

// ------------------------------------------------------------
// Pattern store helpers
// ------------------------------------------------------------

export async function loadAllPatterns(
  supabase: SupabaseClient
): Promise<LearnedPatternRow[]> {
  const { data, error } = await supabase
    .from('bill_categorization_patterns')
    .select('vendor_account_id, cost_code_number, sub_type_token, target_cost_code_number, target_cost_code_name, target_budget_item_name_hint, vendor_name, times_confirmed, times_overridden');
  if (error) {
    console.error('[bill-categorization] loadAllPatterns failed:', error.message);
    return [];
  }
  return (data || []) as LearnedPatternRow[];
}

/**
 * Record a Nathan-approved match into the pattern store so future scans
 * can auto-suggest it.
 *
 * Multi-target model (migration 011): the unique key is
 * (vendor, division, sub_type, target_cost_code) — one row per target. So
 * approving the same target again increments that row's confirm count;
 * approving a *different* target for the same (vendor, division, sub) just
 * inserts a new row alongside. The matcher then surfaces all of them as
 * candidates ranked by share of approvals, instead of "latest wins" with
 * an override counter.
 */
export async function recordApproval(
  supabase: SupabaseClient,
  params: {
    vendorAccountId: string;
    vendorName: string | null;
    lineCostCodeNumber: string | null;
    targetCostCodeNumber: string;
    targetCostCodeName: string | null;
    targetBudgetItemName: string | null;
    jobId: string;
  }
) {
  const division = extractDivision(params.lineCostCodeNumber);
  if (!division || !params.vendorAccountId) return;
  const sub = extractSubTypeToken(params.lineCostCodeNumber);

  // Look up the SPECIFIC (vendor, division, sub, target) row. If it exists,
  // we increment its confirm count; otherwise we insert a new row so the
  // alternate target lives alongside any pre-existing ones for this vendor.
  let query = supabase
    .from('bill_categorization_patterns')
    .select('id, times_confirmed')
    .eq('vendor_account_id', params.vendorAccountId)
    .eq('cost_code_number', division)
    .eq('target_cost_code_number', params.targetCostCodeNumber);
  query = sub === null ? query.is('sub_type_token', null) : query.eq('sub_type_token', sub);
  const { data: existing } = await query.maybeSingle();

  if (existing) {
    // Same vendor + cc + sub + target → routine confirmation.
    await supabase
      .from('bill_categorization_patterns')
      .update({
        target_cost_code_name: params.targetCostCodeName,
        target_budget_item_name_hint: params.targetBudgetItemName,
        vendor_name: params.vendorName,
        times_confirmed: existing.times_confirmed + 1,
        last_confirmed_at: new Date().toISOString(),
        last_job_id: params.jobId,
      })
      .eq('id', existing.id);
  } else {
    // New target option for this (vendor, cc, sub) — insert a new row.
    await supabase
      .from('bill_categorization_patterns')
      .insert({
        vendor_account_id: params.vendorAccountId,
        vendor_name: params.vendorName,
        cost_code_number: division,
        sub_type_token: sub,
        target_cost_code_number: params.targetCostCodeNumber,
        target_cost_code_name: params.targetCostCodeName,
        target_budget_item_name_hint: params.targetBudgetItemName,
        times_confirmed: 1,
        times_overridden: 0,
        last_confirmed_at: new Date().toISOString(),
        last_job_id: params.jobId,
      });
  }
}

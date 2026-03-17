// ============================================================
// BKB Estimating Knowledge Base
// Running collection of trade-specific rules, gotchas, and
// estimating intelligence learned from real projects.
//
// HOW TO ADD A NEW RULE:
// 1. Add an entry to the ESTIMATING_RULES array below
// 2. Set "trade" to the relevant trade or category
// 3. Set "trigger" to describe WHEN this rule applies
// 4. Set "rule" to explain what the agent must do
// 5. Push — the estimating agent picks it up automatically
//
// These rules teach the agent HOW to estimate better over time.
// Unlike scope-notes (which add disclaimers to descriptions),
// these rules affect what line items get created and what
// questions get asked.
// ============================================================

export interface EstimatingRule {
  id: string;
  trade: string;          // Trade or category this applies to (e.g., "Flooring", "Plumbing", "General")
  trigger: string;        // Plain-English description of when this rule kicks in
  rule: string;           // What the agent must do — be specific
  costCodes?: string[];   // Optional: relevant cost code numbers
}

export const ESTIMATING_RULES: EstimatingRule[] = [
  // ── Flooring ──────────────────────────────────────────────
  {
    id: 'hardwood-finish-type',
    trade: 'Flooring',
    trigger: 'Hardwood flooring is being installed (new or replacement)',
    rule: 'MANDATORY QUESTION: You MUST ask whether the hardwood is pre-finished or unfinished BEFORE producing a budget. This question is REQUIRED — do not skip it even in Quick Estimate mode. If the user says "unfinished" or doesn\'t specify, you must include sanding and finishing line items. If "pre-finished," no sanding/finishing is needed. This is a thousands-of-dollars difference and must never be assumed.',
    costCodes: ['19'],
  },

  {
    id: 'flooring-line-item-structure',
    trade: 'Flooring',
    trigger: 'ANY flooring is being installed (hardwood, LVP, tile, carpet, etc.)',
    rule: 'Flooring MUST be broken into SEPARATE line items: (1) Material — the flooring product itself (cost type: Materials), (2) Labor/Installation — the labor to install the flooring (cost type: Labor or Subcontractor depending on who installs). If the flooring is UNFINISHED hardwood, also add: (3) Sanding & Finishing — sand, stain, and finish the hardwood floors (cost type: Subcontractor or Labor). Never combine material and labor into a single line item for flooring. Each should be its own line with its own quantity, unit cost, and unit price.',
    costCodes: ['19'],
  },

  // ── Add new rules below this line ─────────────────────────
];

/**
 * Format all estimating rules into a block for the system prompt.
 */
export function formatEstimatingRulesForPrompt(): string {
  if (ESTIMATING_RULES.length === 0) return '';

  // Group rules by trade for readability
  const byTrade: Record<string, EstimatingRule[]> = {};
  for (const rule of ESTIMATING_RULES) {
    if (!byTrade[rule.trade]) byTrade[rule.trade] = [];
    byTrade[rule.trade].push(rule);
  }

  const sections = Object.entries(byTrade).map(([trade, rules]) => {
    const ruleLines = rules.map((r) =>
      `  • WHEN: ${r.trigger}\n    RULE: ${r.rule}`
    ).join('\n\n');
    return `${trade}:\n${ruleLines}`;
  }).join('\n\n');

  return `ESTIMATING KNOWLEDGE BASE — MANDATORY (learned from real BKB projects):
⚠️ CRITICAL: These rules MUST be checked BEFORE producing any budget or questions.
They override general assumptions and reflect hard-won lessons from real estimates.
If a rule says "MANDATORY QUESTION," that question MUST be asked even if you think
you have enough info. If a rule says how to structure line items, follow it exactly.

${sections}

BEFORE outputting any @@BUDGET_PROPOSAL@@ or @@QUESTIONS@@, scan every rule above
against the current scope. Failure to follow these rules produces incorrect estimates.`;
}

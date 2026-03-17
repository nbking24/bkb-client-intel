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
    rule: 'You MUST determine if the hardwood is pre-finished or unfinished. If the user does not specify, ASK — this is a critical pricing question, not optional. If the hardwood is UNFINISHED, you must include additional line items for sanding and finishing/staining the hardwood flooring. Pre-finished hardwood does not need sanding or staining. This difference can be thousands of dollars — never assume one or the other.',
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

  return `ESTIMATING KNOWLEDGE BASE (learned from real BKB projects):
The following rules reflect lessons learned from actual estimates and must be followed.
These rules affect what line items you create and what questions you ask. They take
priority over general assumptions.

${sections}

Always check these rules against the scope before producing a budget. If a rule says to
ask a question, that question is mandatory even if you would otherwise have enough info
to skip questions.`;
}

// ============================================================
// BKB Scope Notes Registry
// Conditional notes appended to group descriptions when certain
// trades or conditions are present in the estimate.
//
// HOW TO ADD A NEW NOTE:
// 1. Add an entry to the SCOPE_NOTES array below
// 2. Set "trigger" to describe WHEN this note applies
// 3. Set "note" to the exact client-facing text to include
// 4. Push — the estimating agent picks it up automatically
// ============================================================

export interface ScopeNote {
  id: string;
  trigger: string;       // Plain-English description of when to include this note
  note: string;          // Exact client-facing text to append to the group description
  costCodes?: string[];  // Optional: relevant cost code numbers for quick reference
}

export const SCOPE_NOTES: ScopeNote[] = [
  // ── Flooring ──────────────────────────────────────────────
  {
    id: 'flooring-subfloor',
    trigger: 'Flooring is being replaced or removed',
    note: 'Subfloor conditions will be assessed once flooring is removed. If subfloor is found to be rotted or is not at least 3/4" thick, it will need to be replaced which is not currently budgeted.',
    costCodes: ['19'],
  },

  // ── Siding / Exterior ────────────────────────────────────
  {
    id: 'siding-sheathing',
    trigger: 'Siding is being replaced',
    note: 'Pricing is based upon the home having sheathing on the outside of the home. If the home is discovered to not have sheathing, we will need to discuss and determine next steps as new sheathing is not currently budgeted.',
    costCodes: ['06'],
  },

  // ── Insulation / Exterior Walls ───────────────────────────
  {
    id: 'exterior-walls-no-insulation',
    trigger: 'Exterior walls are being opened up AND insulation is NOT planned or referenced in the scope',
    note: 'No insulation has been budgeted to be upgraded at this time. If inspections or township enforces upgrading insulation, this will need to be priced separately.',
    costCodes: ['04', '06', '09'],
  },

  // ── Add new notes below this line ─────────────────────────
];

/**
 * Format all scope notes into a block for the system prompt.
 */
export function formatScopeNotesForPrompt(): string {
  if (SCOPE_NOTES.length === 0) return '';

  const lines = SCOPE_NOTES.map((sn) =>
    `• WHEN: ${sn.trigger}\n  NOTE (append to group description): "${sn.note}"`
  ).join('\n\n');

  return `MANDATORY SCOPE NOTES:
The following notes MUST be appended to the relevant group description whenever the trigger
condition is met. These are non-negotiable — always include the exact note text. Append each
applicable note as its own paragraph at the end of the group description.

${lines}

If multiple notes apply to the same group, include all of them. These notes protect BKB and set
proper client expectations about potential change orders.`;
}

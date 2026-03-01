// ============================================================
// BKB Standard Schedule Template
// Single standardized 9-phase template used for ALL projects.
// Default tasks with projected durations (in business days).
// These are starting points — fully editable after creation.
// ============================================================

export interface TaskTemplate {
  name: string;
  defaultDurationDays?: number;
  description?: string;
}

export interface PhaseTemplate {
  phaseNumber: number;       // Matches STANDARD_PHASES[].number from constants.ts
  name: string;
  description: string;
  startsEmpty?: boolean;      // e.g. Punch List — created but no default tasks
  tasks: TaskTemplate[];
}

export const BKB_STANDARD_TEMPLATE: PhaseTemplate[] = [
  {
    phaseNumber: 1,
    name: 'Admin Tasks',
    description: 'Internal project setup, billing, insurance, ongoing admin items',
    tasks: [
      { name: 'Create project folder / file structure', defaultDurationDays: 1 },
      { name: 'Set up billing account', defaultDurationDays: 1 },
      { name: 'Verify insurance / contracts on file', defaultDurationDays: 2 },
      { name: 'Add project contacts & team assignments', defaultDurationDays: 1 },
      { name: 'Internal kickoff notes', defaultDurationDays: 1 },
    ],
  },
  {
    phaseNumber: 2,
    name: 'Conceptual Design',
    description: 'Designer meetings, concept review, budget range estimate, client presentation',
    tasks: [
      { name: 'Initial client consultation & site visit', defaultDurationDays: 2 },
      { name: 'Designer meeting — conceptual layout', defaultDurationDays: 5 },
      { name: 'Create conceptual design package', defaultDurationDays: 10 },
      { name: 'Internal design review', defaultDurationDays: 3 },
      { name: 'Prepare budget range estimate', defaultDurationDays: 5 },
      { name: 'Client design & budget presentation', defaultDurationDays: 2 },
      { name: 'Client conceptual approval', defaultDurationDays: 5 },
    ],
  },
  {
    phaseNumber: 3,
    name: 'Design Development',
    description: 'DD drawings, plan review, revisions, selections process',
    tasks: [
      { name: 'Design development drawings', defaultDurationDays: 15 },
      { name: 'Plan review with client', defaultDurationDays: 5 },
      { name: 'Design revisions', defaultDurationDays: 7 },
      { name: 'Material selections (flooring, tile, counters)', defaultDurationDays: 10 },
      { name: 'Fixture selections (plumbing, lighting)', defaultDurationDays: 7 },
      { name: 'Appliance selections', defaultDurationDays: 7 },
      { name: 'Cabinet selections & layout', defaultDurationDays: 7 },
      { name: 'Hardware & finish selections', defaultDurationDays: 5 },
      { name: 'Client selections sign-off', defaultDurationDays: 3 },
    ],
  },
  {
    phaseNumber: 4,
    name: 'Contract',
    description: 'Final plans, engineering, contract preparation and signing',
    tasks: [
      { name: 'Finalize construction plans', defaultDurationDays: 10 },
      { name: 'Structural engineering', defaultDurationDays: 10 },
      { name: 'MEP coordination', defaultDurationDays: 5 },
      { name: 'Final plan review — internal', defaultDurationDays: 3 },
      { name: 'Prepare detailed estimate / SOW', defaultDurationDays: 5 },
      { name: 'Prepare contract documents', defaultDurationDays: 3 },
      { name: 'Client contract review', defaultDurationDays: 5 },
      { name: 'Contract signed', defaultDurationDays: 2 },
    ],
  },
  {
    phaseNumber: 5,
    name: 'Preconstruction',
    description: 'Permits, material orders, sub scheduling, pre-construction meeting',
    tasks: [
      { name: 'Prepare permit application', defaultDurationDays: 5 },
      { name: 'Submit for permits', defaultDurationDays: 2 },
      { name: 'Address permit comments (if any)', defaultDurationDays: 10 },
      { name: 'Permits approved', defaultDurationDays: 20 },
      { name: 'Order long-lead materials', defaultDurationDays: 5 },
      { name: 'Schedule subcontractors', defaultDurationDays: 5 },
      { name: 'Coordinate temporary facilities', defaultDurationDays: 3 },
      { name: 'Pre-construction meeting', defaultDurationDays: 1 },
      { name: 'Hand off to field team', defaultDurationDays: 1 },
    ],
  },
  {
    phaseNumber: 6,
    name: 'In Production',
    description: 'All build tasks with projected dates — Evan manages and updates as needed',
    tasks: [
      { name: 'Site prep & protection', defaultDurationDays: 2 },
      { name: 'Demo (if applicable)', defaultDurationDays: 5 },
      { name: 'Foundation / structural work', defaultDurationDays: 10 },
      { name: 'Framing', defaultDurationDays: 10 },
      { name: 'Roofing', defaultDurationDays: 5 },
      { name: 'Windows & exterior doors', defaultDurationDays: 3 },
      { name: 'Plumbing rough-in', defaultDurationDays: 5 },
      { name: 'Electrical rough-in', defaultDurationDays: 5 },
      { name: 'HVAC rough-in', defaultDurationDays: 5 },
      { name: 'Insulation', defaultDurationDays: 3 },
      { name: 'Drywall', defaultDurationDays: 7 },
      { name: 'Interior trim & doors', defaultDurationDays: 7 },
      { name: 'Paint — prime & first coat', defaultDurationDays: 5 },
      { name: 'Cabinet installation', defaultDurationDays: 5 },
      { name: 'Countertop installation', defaultDurationDays: 3 },
      { name: 'Tile / backsplash', defaultDurationDays: 5 },
      { name: 'Flooring installation', defaultDurationDays: 5 },
      { name: 'Plumbing trim (fixtures)', defaultDurationDays: 3 },
      { name: 'Electrical trim (fixtures, devices)', defaultDurationDays: 3 },
      { name: 'Appliance installation', defaultDurationDays: 2 },
      { name: 'Paint — final coat & touch-up', defaultDurationDays: 3 },
      { name: 'Hardware installation', defaultDurationDays: 2 },
      { name: 'Final cleaning', defaultDurationDays: 2 },
    ],
  },
  {
    phaseNumber: 7,
    name: 'Inspections',
    description: 'Project inspections — added and customized per project type',
    tasks: [
      { name: 'Foundation inspection', defaultDurationDays: 1 },
      { name: 'Framing inspection', defaultDurationDays: 1 },
      { name: 'Rough-in inspection (plumbing/electrical/HVAC)', defaultDurationDays: 1 },
      { name: 'Insulation inspection', defaultDurationDays: 1 },
      { name: 'Final building inspection', defaultDurationDays: 1 },
    ],
  },
  {
    phaseNumber: 8,
    name: 'Punch List',
    description: 'Starts empty — populated near project completion',
    startsEmpty: true,
    tasks: [],
  },
  {
    phaseNumber: 9,
    name: 'Project Completion',
    description: 'Final walkthrough, final billing, warranties, project closeout',
    tasks: [
      { name: 'Client final walkthrough', defaultDurationDays: 1 },
      { name: 'Generate punch list from walkthrough', defaultDurationDays: 2 },
      { name: 'Complete all punch list items', defaultDurationDays: 10 },
      { name: 'Final billing / invoice', defaultDurationDays: 3 },
      { name: 'Collect final payment', defaultDurationDays: 5 },
      { name: 'Warranty documentation delivered', defaultDurationDays: 3 },
      { name: 'Project closeout — internal', defaultDurationDays: 2 },
    ],
  },
];

// Helper: get a specific phase template by number
export function getPhaseTemplate(phaseNumber: number): PhaseTemplate | undefined {
  return BKB_STANDARD_TEMPLATE.find((p) => p.phaseNumber === phaseNumber);
}

// Helper: calculate total projected days for a phase
export function getPhaseDuration(phaseNumber: number): number {
  const phase = getPhaseTemplate(phaseNumber);
  if (!phase) return 0;
  return phase.tasks.reduce((sum, t) => sum + (t.defaultDurationDays || 0), 0);
}

// Helper: calculate total projected days for entire project
export function getTotalProjectDuration(): number {
  return BKB_STANDARD_TEMPLATE.reduce(
    (sum, phase) => sum + phase.tasks.reduce((s, t) => s + (t.defaultDurationDays || 0), 0),
    0
  );
}

// ============================================================
// Task-to-Phase Matching — Schedule Audit
// Given a task name, determine which standard phase it belongs to.
// Uses keyword matching against the standard template task names
// and common construction terminology.
// ============================================================

// Build a keyword index from the template at module load
const PHASE_KEYWORDS: { phaseNumber: number; phaseName: string; keywords: string[] }[] =
  BKB_STANDARD_TEMPLATE.map((phase) => {
    // Extract keywords from task names in this phase
    const taskWords = phase.tasks.flatMap((t) =>
      t.name.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 3)
    );
    // Add phase-level keywords
    const phaseWords = phase.name.toLowerCase().split(/\s+/);
    const descWords = phase.description.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 3);
    return {
      phaseNumber: phase.phaseNumber,
      phaseName: phase.name,
      keywords: Array.from(new Set([...phaseWords, ...descWords, ...taskWords])),
    };
  });

// Additional hard-coded keyword mappings for common construction terms
const TERM_TO_PHASE: Record<string, number> = {
  // Phase 1 - Admin
  billing: 1, invoice: 1, insurance: 1, kickoff: 1, 'file structure': 1, 'project folder': 1,
  // Phase 2 - Conceptual Design
  conceptual: 2, 'site visit': 2, consultation: 2, 'budget range': 2, 'concept review': 2,
  // Phase 3 - Design Development
  selections: 3, flooring: 3, tile: 3, counters: 3, countertop: 3, fixture: 3, appliance: 3,
  cabinet: 3, hardware: 3, 'design development': 3, 'dd drawings': 3,
  // Phase 4 - Contract
  contract: 4, engineering: 4, 'final plans': 4, estimate: 4, 'scope of work': 4, sow: 4,
  // Phase 5 - Preconstruction
  permit: 5, 'pre-con': 5, precon: 5, preconstruction: 5, 'long-lead': 5, subcontractor: 5,
  // Phase 6 - Production
  demo: 6, demolition: 6, framing: 6, roofing: 6, plumbing: 6, electrical: 6, hvac: 6,
  insulation: 6, drywall: 6, trim: 6, paint: 6, 'rough-in': 6, roughin: 6,
  foundation: 6, siding: 6, stucco: 6, masonry: 6, concrete: 6, grading: 6,
  excavation: 6, waterproofing: 6, sheathing: 6, flashing: 6, gutter: 6,
  // Phase 7 - Inspections
  inspection: 7, 'final inspection': 7, 'building inspection': 7,
  // Phase 8 - Punch List
  punch: 8, 'punch list': 8, punchlist: 8, touchup: 8, 'touch-up': 8,
  // Phase 9 - Project Completion
  walkthrough: 9, 'walk-through': 9, closeout: 9, 'close-out': 9, warranty: 9,
  'final payment': 9, 'final billing': 9,
};

export interface TaskAuditResult {
  taskId: string;
  taskName: string;
  currentPhaseId: string;
  currentPhaseName: string;
  recommendedPhaseNumber: number | null;
  recommendedPhaseName: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Given a task name, recommend which standard phase it should belong to.
 * Returns { phaseNumber, phaseName, confidence } or null if no match.
 */
export function recommendPhaseForTask(taskName: string): {
  phaseNumber: number;
  phaseName: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
} | null {
  const lower = taskName.toLowerCase().trim();

  // 1. Direct term matching (highest confidence)
  for (const [term, phaseNum] of Object.entries(TERM_TO_PHASE)) {
    if (lower.includes(term)) {
      const phase = BKB_STANDARD_TEMPLATE.find((p) => p.phaseNumber === phaseNum);
      if (phase) {
        return {
          phaseNumber: phaseNum,
          phaseName: phase.name,
          confidence: 'high',
          reason: `Matches "${term}" → ${phase.name}`,
        };
      }
    }
  }

  // 2. Exact or close match to a template task name (high confidence)
  for (const phase of BKB_STANDARD_TEMPLATE) {
    for (const task of phase.tasks) {
      const templateLower = task.name.toLowerCase();
      if (lower === templateLower || lower.includes(templateLower) || templateLower.includes(lower)) {
        return {
          phaseNumber: phase.phaseNumber,
          phaseName: phase.name,
          confidence: 'high',
          reason: `Matches template task "${task.name}"`,
        };
      }
    }
  }

  // 3. Keyword overlap scoring (medium confidence)
  let bestScore = 0;
  let bestPhase: typeof PHASE_KEYWORDS[0] | null = null;
  const taskWords = lower.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 3);

  for (const pk of PHASE_KEYWORDS) {
    let score = 0;
    for (const word of taskWords) {
      if (pk.keywords.includes(word)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = pk;
    }
  }

  if (bestPhase && bestScore >= 2) {
    return {
      phaseNumber: bestPhase.phaseNumber,
      phaseName: bestPhase.phaseName,
      confidence: 'medium',
      reason: `Keyword match (${bestScore} words) → ${bestPhase.phaseName}`,
    };
  }

  // No confident match
  return null;
}

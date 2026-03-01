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

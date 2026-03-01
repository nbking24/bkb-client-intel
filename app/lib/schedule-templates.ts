// ============================================================
// Pre-Construction Schedule Templates
// Used by the setup wizard to create default phase groups + tasks
// in JobTread when starting a new project schedule.
// These are starting points — fully editable after creation.
// ============================================================

export interface SchedulePhaseTemplate {
  name: string;
  description?: string;
  tasks: string[];
}

export interface ScheduleTemplate {
  id: string;
  name: string;
  description: string;
  phases: SchedulePhaseTemplate[];
}

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    id: 'renovation',
    name: 'Home Renovation',
    description: 'Full renovation with design, permitting, and construction phases',
    phases: [
      {
        name: 'Design & Planning',
        tasks: [
          'Initial consultation & site visit',
          'Create conceptual design',
          'Client design review & revisions',
          'Finalize design documents',
        ],
      },
      {
        name: 'Budget Approval',
        tasks: [
          'Prepare detailed budget estimate',
          'Get subcontractor pricing',
          'Client budget presentation',
          'Budget sign-off',
        ],
      },
      {
        name: 'Client Selections',
        tasks: [
          'Material selections (flooring, tile, counters)',
          'Fixture selections (plumbing, lighting)',
          'Appliance selections',
          'Client selections sign-off',
        ],
      },
      {
        name: 'Plans & Engineering',
        tasks: [
          'Finalize construction drawings',
          'Structural engineering (if needed)',
          'MEP coordination',
          'Final plan review',
        ],
      },
      {
        name: 'Contract',
        tasks: [
          'Prepare contract documents',
          'Client contract review',
          'Contract signed',
        ],
      },
      {
        name: 'Permitting',
        tasks: [
          'Prepare permit application',
          'Submit for permits',
          'Address permit comments',
          'Permits approved',
        ],
      },
      {
        name: 'Pre-Construction Prep',
        tasks: [
          'Order long-lead materials',
          'Schedule subcontractors',
          'Coordinate temporary facilities',
          'Pre-construction meeting',
        ],
      },
      {
        name: 'Hand Off to Field',
        tasks: [
          'Field team walkthrough',
          'Distribute plans & specs',
          'Confirm schedule with subs',
          'Project kickoff',
        ],
      },
    ],
  },
  {
    id: 'kitchen_remodel',
    name: 'Kitchen Remodel',
    description: 'Kitchen-focused remodel with selections and installation phases',
    phases: [
      {
        name: 'Design & Layout',
        tasks: [
          'Measure existing kitchen',
          'Create kitchen layout options',
          'Client design approval',
          'Finalize kitchen plan',
        ],
      },
      {
        name: 'Budget & Contract',
        tasks: [
          'Prepare kitchen budget',
          'Client budget approval',
          'Contract signed',
        ],
      },
      {
        name: 'Selections',
        tasks: [
          'Cabinet selection & order',
          'Countertop selection & template',
          'Tile / backsplash selection',
          'Appliance selection & order',
          'Plumbing fixture selection',
          'Lighting selection',
        ],
      },
      {
        name: 'Permitting & Prep',
        tasks: [
          'Submit for permits (if needed)',
          'Order long-lead items',
          'Schedule subcontractors',
        ],
      },
      {
        name: 'Demo & Rough-In',
        tasks: [
          'Kitchen demo',
          'Plumbing rough-in',
          'Electrical rough-in',
          'Inspection',
        ],
      },
      {
        name: 'Installation',
        tasks: [
          'Cabinet install',
          'Countertop install',
          'Tile / backsplash install',
          'Plumbing trim',
          'Electrical trim',
          'Appliance install',
        ],
      },
      {
        name: 'Finish & Closeout',
        tasks: [
          'Touch-up & punch list',
          'Final cleaning',
          'Client walkthrough',
          'Project closeout',
        ],
      },
    ],
  },
  {
    id: 'addition',
    name: 'Addition',
    description: 'Room addition with structural, permitting, and full build phases',
    phases: [
      {
        name: 'Design & Architecture',
        tasks: [
          'Site survey & measurements',
          'Conceptual design',
          'Client design review',
          'Architectural drawings',
          'Structural engineering',
        ],
      },
      {
        name: 'Budget Approval',
        tasks: [
          'Detailed cost estimate',
          'Subcontractor bids',
          'Client budget presentation',
          'Budget approved',
        ],
      },
      {
        name: 'Selections',
        tasks: [
          'Exterior material selections',
          'Interior finish selections',
          'Fixture & hardware selections',
          'Selections finalized',
        ],
      },
      {
        name: 'Contract & Permits',
        tasks: [
          'Contract prepared & signed',
          'Permit application submitted',
          'Permit approved',
        ],
      },
      {
        name: 'Site Prep & Foundation',
        tasks: [
          'Order materials',
          'Schedule excavation',
          'Foundation work',
          'Foundation inspection',
        ],
      },
      {
        name: 'Framing & Structural',
        tasks: [
          'Framing',
          'Roof framing & sheathing',
          'Window & door install',
          'Framing inspection',
        ],
      },
      {
        name: 'Rough-Ins & Insulation',
        tasks: [
          'Plumbing rough-in',
          'Electrical rough-in',
          'HVAC rough-in',
          'Insulation',
          'Rough-in inspections',
        ],
      },
      {
        name: 'Finishes & Closeout',
        tasks: [
          'Drywall',
          'Interior trim & paint',
          'Flooring',
          'Final inspections',
          'Punch list',
          'Client walkthrough',
        ],
      },
    ],
  },
  {
    id: 'exterior',
    name: 'Exterior Project',
    description: 'Exterior work (siding, deck, patio, landscaping)',
    phases: [
      {
        name: 'Design & Scope',
        tasks: [
          'Site assessment',
          'Design / scope definition',
          'Client approval',
        ],
      },
      {
        name: 'Budget & Contract',
        tasks: [
          'Cost estimate',
          'Client budget approval',
          'Contract signed',
        ],
      },
      {
        name: 'Permitting & Materials',
        tasks: [
          'Submit for permits (if needed)',
          'Order materials',
          'Schedule subcontractors',
        ],
      },
      {
        name: 'Construction',
        tasks: [
          'Site prep',
          'Main construction work',
          'Inspections',
        ],
      },
      {
        name: 'Closeout',
        tasks: [
          'Final inspection',
          'Client walkthrough',
          'Project closeout',
        ],
      },
    ],
  },
  {
    id: 'custom',
    name: 'Custom / Blank',
    description: 'Start with an empty schedule and add phases manually',
    phases: [],
  },
];

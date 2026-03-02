// ============================================================
// BKB Operations Platform - Constants & Config
// ============================================================

// Brand colors
export const COLORS = {
  navy: '#1B3A5C',
  gold: '#C9A84C',
  dark: '#1a1a1a',
  darkCard: '#242424',
  darkBg: '#141414',
  text: '#e8e0d8',
  textMuted: '#8a8078',
  border: 'rgba(205,162,116,0.12)',
  borderActive: 'rgba(205,162,116,0.25)',
} as const;

// ============================================================
// Standard 9-Phase Schedule Structure
// Every BKB project follows this same phase framework.
// Phases grow with project status — not all phases are active at every stage.
// ============================================================

export const STANDARD_PHASES = [
  { number: 1, name: 'Admin Tasks', short: 'Admin', description: 'Internal project setup, billing, insurance, ongoing admin items' },
  { number: 2, name: 'Conceptual Design', short: 'Concept', description: 'Designer meetings, concept review, budget range estimate' },
  { number: 3, name: 'Design Development', short: 'DD', description: 'DD drawings, plan review, revisions, selections process' },
  { number: 4, name: 'Contract', short: 'Contract', description: 'Final plans, engineering, contract preparation and signing' },
  { number: 5, name: 'Preconstruction', short: 'Precon', description: 'Permits, material orders, sub scheduling, pre-con meeting' },
  { number: 6, name: 'In Production', short: 'Production', description: 'All build tasks with projected dates' },
  { number: 7, name: 'Inspections', short: 'Inspections', description: 'Project inspections — added as needed per project type' },
  { number: 8, name: 'Punch List', short: 'Punch', description: 'Starts empty, populated near project completion' },
  { number: 9, name: 'Project Completion', short: 'Closeout', description: 'Final walkthrough, final billing, warranties, closeout' },
] as const;

// ============================================================
// JobTread Custom "Status" Field — Dashboard Grouping
// Jobs are grouped into these categories on the overview dashboard.
// The status values are the exact strings from the JT custom field.
// ============================================================

export type StatusCategoryKey = 'IN_PRODUCTION' | 'IN_DESIGN' | 'READY' | 'LEADS' | 'FINAL_BILLING';

export const STATUS_VALUES: Record<StatusCategoryKey, string[]> = {
  LEADS: [
    '1. Lead Contacted Us',
    '2. Appointment Scheduled',
    '3. Pricing/Agreement Pending',
    '4. Agreement Sent/Pending',
  ],
  IN_DESIGN: [
    '5. Design Phase',
  ],
  READY: [
    '10. Ready',
  ],
  IN_PRODUCTION: [
    '6. In Production',
  ],
  FINAL_BILLING: [
    '7. Final Billing',
  ],
};

// Display order for dashboard sections (most active first)
export const STATUS_CATEGORY_ORDER: StatusCategoryKey[] = [
  'IN_PRODUCTION',
  'IN_DESIGN',
  'READY',
  'LEADS',
  'FINAL_BILLING',
];

export const STATUS_CATEGORY_LABELS: Record<StatusCategoryKey | 'UNCATEGORIZED', string> = {
  IN_PRODUCTION: 'In Production',
  IN_DESIGN: 'In Design',
  READY: 'Ready to Start',
  LEADS: 'Leads',
  FINAL_BILLING: 'Final Billing',
  UNCATEGORIZED: 'Uncategorized',
};

// Which phases are relevant at each status stage
// (all phases exist on the job, but only these are "active" / shown expanded)
export const STATUS_ACTIVE_PHASES: Record<StatusCategoryKey, number[]> = {
  LEADS: [1, 2],                          // Admin + Conceptual Design
  IN_DESIGN: [1, 2, 3],                   // + Design Development
  READY: [1, 2, 3, 4, 5],                 // + Contract + Preconstruction
  IN_PRODUCTION: [1, 2, 3, 4, 5, 6, 7, 8, 9], // All phases
  FINAL_BILLING: [1, 6, 7, 8, 9],         // Production + Closeout phases
};

// Reverse lookup: given a status string, find its category
export function getStatusCategory(statusValue: string | null | undefined): StatusCategoryKey | null {
  if (!statusValue) return null;
  for (const [category, values] of Object.entries(STATUS_VALUES)) {
    if (values.includes(statusValue)) return category as StatusCategoryKey;
  }
  return null;
}

// ============================================================
// Phase status colors (for progress indicators)
// ============================================================

export const STATUS_COLORS = {
  complete: { bg: '#22c55e', text: '#ffffff', label: 'Complete' },
  in_progress: { bg: '#eab308', text: '#1a1a1a', label: 'In Progress' },
  blocked: { bg: '#ef4444', text: '#ffffff', label: 'Blocked' },
  not_started: { bg: '#3f3f3f', text: '#8a8078', label: 'Not Started' },
} as const;

// Task urgency colors
export const URGENCY_COLORS = {
  urgent: { bg: '#ef4444', text: '#ffffff', dot: '#ef4444' },
  high: { bg: '#f97316', text: '#ffffff', dot: '#f97316' },
  normal: { bg: '#3f3f3f', text: '#e8e0d8', dot: '#8a8078' },
} as const;

// User roles and their dashboard capabilities
export const ROLE_CONFIG = {
  owner: { canEditPhases: true, canViewAllTasks: true, canViewBills: true, canViewGrid: true },
  admin: { canEditPhases: false, canViewAllTasks: false, canViewBills: true, canViewGrid: true },
  field_sup: { canEditPhases: false, canViewAllTasks: false, canViewBills: false, canViewGrid: true },
  field: { canEditPhases: false, canViewAllTasks: false, canViewBills: false, canViewGrid: false },
} as const;

// JT Team membership IDs (verified against live PAVE API 2026-02-28)
export const JT_MEMBERS = {
  nathan: '22P5SRwhLaYf',
  brett: '22P6GTaPEbkh',
  evan: '22P5nJ7ncFj4',
  terri: '22P5SpJkype2',
  josh: '22P6GTEnhCre',
  dave_steich: '22P5icFXKZgA',
  jimmy: '22P5sPMTN8mH',
} as const;

// ============================================================
// Design Manager Agent — Configuration
// ============================================================

// Which JT custom-field Status values the Design Manager Agent monitors
export const DESIGN_AGENT_STATUSES = ['5. Design Phase', '10. Ready'] as const;

// Agent rules / thresholds
export const AGENT_RULES = {
  maxDaysNoContact: 14,         // Alert if no client contact in 14+ days
  urgentDeadlineDays: 3,        // Flag tasks due within 3 days as urgent
  warningDeadlineDays: 7,       // Flag tasks due within 7 days as warning
  stalledDaysThreshold: 10,     // Flag phase as stalled if no progress in 10 days
} as const;

// Agent project health statuses
export type ProjectHealthStatus = 'on_track' | 'at_risk' | 'stalled' | 'blocked' | 'complete';

// GHL config
export const GHL_CONFIG = {
  locationId: 'H3fSXP5K9fMGf0eJIkXk',
  pipelineId: '1iqzDqMkl6sxHr8OCeqi',
} as const;

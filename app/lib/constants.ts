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

// Pre-construction phases
export const PRECON_PHASES = [
  { number: 1, name: 'Finalize Conceptual Design', short: 'Design' },
  { number: 2, name: 'Get Conceptual Design Budget Range Approved', short: 'Budget Approval' },
  { number: 3, name: 'Get Selections from Client', short: 'Selections' },
  { number: 4, name: 'Finalize Plans', short: 'Plans' },
  { number: 5, name: 'Finalize Contract Signed', short: 'Contract' },
  { number: 6, name: 'Submit for Permits', short: 'Permits' },
  { number: 7, name: 'Order Long-Lead Materials', short: 'Materials' },
  { number: 8, name: 'Schedule Subs', short: 'Subs' },
  { number: 9, name: 'Hand Off to Field', short: 'Handoff' },
] as const;

// Phase status colors
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

// JT Team membership IDs
export const JT_MEMBERS = {
  nathan: '22P5SRxZKiP7',
  brett: '22P5SRxcs7r9',
  evan: '22P5SRxfGw9y',
  terri: '22P5fxSXeJXf',
} as const;

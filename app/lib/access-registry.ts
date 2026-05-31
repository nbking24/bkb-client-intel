// ============================================================
// Access Registry
//
// Single source of truth for everything that can be assigned to a user from
// the admin dashboard: the top-level dashboards (nav pages), cross-cutting
// features (capabilities that span pages), and the individual widgets on the
// Overview page. Per-user selections are stored in the `app_users` table as
// arrays of the ids defined here.
//
// This module is intentionally pure (no server/db/React imports) so it can be
// shared by the server access layer, the admin UI, and the dashboard layout.
// ============================================================

export type AccessRole = 'owner' | 'admin' | 'field_sup' | 'field' | 'custom';

export interface DashboardDef {
  id: string;
  label: string;
  href: string;
  icon: string;        // lucide-react icon name, mapped to a component in the layout
  /** Owner-only pages (e.g. the admin console) are never assignable and are
   *  always shown to owners regardless of stored config. */
  ownerOnly?: boolean;
  description?: string;
}

export interface FeatureDef {
  id: string;
  label: string;
  description?: string;
}

export interface WidgetDef {
  id: string;
  label: string;
  description?: string;
}

// ---- Dashboards (top-level nav pages) -------------------------------------

export const DASHBOARDS: DashboardDef[] = [
  { id: 'overview',    label: 'Overview',         href: '/dashboard',             icon: 'LayoutDashboard', description: 'Personalized home: tasks, calendar, KPIs' },
  { id: 'leads',       label: 'Leads',            href: '/dashboard/leads',       icon: 'Users',           description: 'Lead pipeline, briefings, scheduling' },
  { id: 'precon',      label: 'Pre-Construction', href: '/dashboard/precon',      icon: 'FolderKanban',    description: 'Schedule / phase tracker' },
  { id: 'estimate',    label: 'Estimating',       href: '/dashboard/estimate',    icon: 'Calculator',      description: 'Estimate tracker' },
  { id: 'invoicing',   label: 'Invoicing',        href: '/dashboard/invoicing',   icon: 'DollarSign',      description: 'Invoicing health + AR' },
  { id: 'job-costing', label: 'Job Costing',      href: '/dashboard/job-costing', icon: 'BarChart3',       description: 'Per-job cost analysis' },
  { id: 'bill-review', label: 'Bill Review',      href: '/dashboard/bill-review', icon: 'Receipt',         description: 'Bill categorization queue' },
  { id: 'spec-writer', label: 'Spec Writer',      href: '/dashboard/spec-writer', icon: 'FileText',        description: 'Specification writing' },
  { id: 'marketing',   label: 'Marketing',        href: '/dashboard/marketing',   icon: 'Megaphone',       description: 'Marketing tools' },
  { id: 'tickets',     label: 'Tickets',          href: '/dashboard/tickets',     icon: 'Bug',             description: 'Support / bug queue' },
  { id: 'field',       label: 'My Tasks (Field)', href: '/dashboard/field',       icon: 'ClipboardList',   description: 'Simplified field-staff task view' },
  { id: 'admin',       label: 'Admin',            href: '/dashboard/admin',       icon: 'Shield', ownerOnly: true, description: 'User & access management' },
];

// ---- Cross-cutting features ------------------------------------------------

export const FEATURES: FeatureDef[] = [
  { id: 'ask_agent',    label: 'Ask Agent',           description: 'AI assistant panel and inline chat' },
  { id: 'report_issue', label: 'Report an Issue',     description: 'Floating bug/ticket reporter' },
  { id: 'jt_write',     label: 'JobTread write actions', description: 'Allow edits/writes back to JobTread (tasks, phases, comments)' },
];

// ---- Overview-page widgets -------------------------------------------------

export const OVERVIEW_WIDGETS: WidgetDef[] = [
  { id: 'quick_add',          label: 'Quick Add',          description: 'Quick task / Waiting-On / meeting creator' },
  { id: 'bill_review_banner', label: 'Bill Review banner', description: 'Banner flagging bill lines that need review' },
  { id: 'kpis',               label: 'KPI cards',          description: 'Active Jobs, Overdue, Unpaid Invoices, etc.' },
  { id: 'calendar',           label: 'Calendar',           description: 'This week / next week schedule grid' },
  { id: 'todays_focus',       label: "Today's Focus",      description: 'Top action card for the day' },
  { id: 'waiting_on',         label: 'Waiting On',         description: 'Items you are waiting on others for' },
  { id: 'ar_reminders',       label: 'AR Reminders',       description: 'Accounts-receivable reminder activity' },
  { id: 'all_tasks',          label: 'All Tasks',          description: 'Full task list grouped by job' },
  { id: 'precon_kpis',        label: 'Preconstruction KPIs', description: 'Design/precon KPI strip: tasks due/overdue, design meetings, stalled design projects' },
  { id: 'transcripts_confirm', label: 'Transcripts to Confirm', description: 'Meeting transcripts you recorded that need a job/lead assignment' },
  { id: 'transcripts_history', label: 'Past Transcripts', description: 'Searchable archive of your meeting transcripts and the jobs they belong to' },
];

// Convenience id lists
export const ALL_DASHBOARD_IDS = DASHBOARDS.map((d) => d.id);
export const ASSIGNABLE_DASHBOARD_IDS = DASHBOARDS.filter((d) => !d.ownerOnly).map((d) => d.id);
export const ALL_FEATURE_IDS = FEATURES.map((f) => f.id);
export const ALL_WIDGET_IDS = OVERVIEW_WIDGETS.map((w) => w.id);

export interface AccessConfig {
  dashboards: string[];
  features: string[];
  overviewWidgets: string[];
}

// ---- Role presets ----------------------------------------------------------
// Starting templates the admin UI offers. "custom" starts blank so the owner
// builds the access set by hand (used for the new employee).

export const ROLE_PRESETS: Record<AccessRole, AccessConfig> = {
  owner: {
    dashboards: ALL_DASHBOARD_IDS,
    features: ALL_FEATURE_IDS,
    overviewWidgets: ALL_WIDGET_IDS,
  },
  admin: {
    dashboards: ASSIGNABLE_DASHBOARD_IDS.filter((id) => id !== 'field'),
    features: ALL_FEATURE_IDS,
    overviewWidgets: ALL_WIDGET_IDS,
  },
  field_sup: {
    dashboards: ['field'],
    features: ['ask_agent'],
    overviewWidgets: [],
  },
  field: {
    dashboards: ['field'],
    features: [],
    overviewWidgets: [],
  },
  custom: {
    dashboards: [],
    features: [],
    overviewWidgets: [],
  },
};

export function presetFor(role: AccessRole): AccessConfig {
  const p = ROLE_PRESETS[role] || ROLE_PRESETS.custom;
  // Return copies so callers can't mutate the shared preset arrays.
  return {
    dashboards: [...p.dashboards],
    features: [...p.features],
    overviewWidgets: [...p.overviewWidgets],
  };
}

export const ROLE_LABELS: Record<AccessRole, string> = {
  owner: 'Owner',
  admin: 'Admin / Office',
  field_sup: 'Field Supervisor',
  field: 'Field Staff',
  custom: 'Custom',
};

// ============================================================
// Shared Dashboard Types
// Used by both desktop (/dashboard) and mobile (/m/dashboard)
// ============================================================

export interface TomorrowBriefing {
  headline: string;
  calendarWalkthrough: Array<{ time: string; event: string; prepNote: string }>;
  tasksDue: Array<{ task: string; jobName: string }>;
  prepTonightOrAM: string[];
}

export interface SuggestedAction {
  title: string;
  actionType: 'reply-email' | 'complete-task' | 'reschedule-task' | 'follow-up' | 'prep-meeting' | 'review-document';
  context: {
    taskId?: string; taskName?: string; emailSubject?: string;
    recipient?: string; jobName?: string; suggestedDate?: string; suggestedText?: string;
  };
  priority: 'high' | 'medium' | 'low';
}

export interface MeetingPrepNote {
  eventSummary: string;
  time: string;
  prepNote: string;
  relatedJobName?: string;
}

export interface DashboardAnalysis {
  summary: string;
  urgentItems: Array<{ title: string; description: string; jobName?: string }>;
  upcomingDeadlines: Array<{ title: string; dueDate: string; daysUntilDue: number; jobName?: string }>;
  flaggedMessages: Array<{ preview: string; jobName: string; authorName: string; reason: string }>;
  emailsNeedingReply?: Array<{ from: string; subject: string; snippet: string; reason: string }>;
  actionItems: Array<{ action: string; priority: 'high' | 'medium' | 'low'; jobName?: string }>;
  suggestedActions?: SuggestedAction[];
  meetingPrepNotes?: MeetingPrepNote[];
  tomorrowBriefing?: TomorrowBriefing;
}

export interface ArAutoRecord {
  date: string;
  tier: string;
}

export interface OutstandingInvoice {
  id: string;
  documentNumber: string;
  jobName: string;
  jobId: string;
  amount: number;
  createdAt: string;
  issueDate?: string | null;
  daysPending: number;
  arAutoSent?: ArAutoRecord[];
  arHold?: boolean;
}

export interface ChangeOrderSummary {
  jobId: string;
  jobName: string;
  coName: string;
  status: 'approved' | 'pending';
}

export interface DashboardTask {
  id: string;
  name: string;
  description?: string;
  jobId: string;
  jobName: string;
  jobNumber: string;
  endDate: string | null;
  progress: number;
  urgency: string;
  daysUntilDue: number | null;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  attendeeCount: number;
}

export interface DashboardStats {
  totalTasks: number;
  urgentTasks: number;
  highPriorityTasks: number;
  tasksToday: number;
  tasksTomorrow: number;
  recentMessageCount: number;
  activeJobCount: number;
  unreadEmailCount: number;
  upcomingEventsCount: number;
  tomorrowEventsCount: number;
  outstandingInvoiceCount: number;
  outstandingInvoiceTotal: number;
  pendingCOCount: number;
  approvedCOCount: number;
}

export interface DashboardData {
  timeContext?: { period: string; tomorrowLabel: string; tomorrowDate: string };
  stats: DashboardStats;
  tasks: DashboardTask[];
  recentEmails: Array<{
    id: string; threadId: string; from: string; subject: string;
    snippet: string; date: string; isUnread: boolean;
  }>;
  calendarEvents: CalendarEvent[];
  activeJobs?: Array<{ id: string; name: string; number: string }>;
  outstandingInvoices?: OutstandingInvoice[];
  changeOrders?: ChangeOrderSummary[];
}

export interface OverviewResponse {
  analysis: DashboardAnalysis;
  data: DashboardData;
  _cached: boolean;
  _cachedAt?: string;
  _analysisTimeMs?: number;
}

// ============================================================
// Shared Helper Functions
// ============================================================

export function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

export function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function recalcUrgency(endDate: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(endDate); due.setHours(0, 0, 0, 0);
  const days = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const urgency = days < 0 ? 'urgent' : days <= 2 ? 'high' : 'normal';
  return { urgency, daysUntilDue: days };
}

export function formatDateLabel(daysUntilDue: number | null): string {
  if (daysUntilDue === null) return 'No date';
  if (daysUntilDue < 0) return `${Math.abs(daysUntilDue)}d overdue`;
  if (daysUntilDue === 0) return 'Today';
  if (daysUntilDue === 1) return 'Tomorrow';
  const d = new Date();
  d.setDate(d.getDate() + daysUntilDue);
  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${dayName} ${monthDay}`;
}

export function getDateColor(daysUntilDue: number | null): string {
  if (daysUntilDue !== null && daysUntilDue < 0) return '#ef4444';
  if (daysUntilDue !== null && daysUntilDue <= 2) return '#eab308';
  return '#6a6058';
}

export const TEAM_ASSIGNEES = [
  { id: '22P5SRwhLaYf', name: 'Nathan King', label: 'Nathan' },
  { id: '22P6GTaPEbkh', name: 'Brett King', label: 'Brett' },
  { id: '22P5nJ7ncFj4', name: 'Evan Harrington', label: 'Evan' },
  { id: '22P6GTEnhCre', name: 'Josh King', label: 'Josh' },
  { id: '22P5SpJkype2', name: 'Terri King', label: 'Terri' },
  { id: '22P732t6SgNk', name: 'Kim King', label: 'Kim' },
];

export const BKB_PHASES = [
  'Admin Tasks', 'Conceptual Design', 'Design Development', 'Contract',
  'Preconstruction', 'In Production', 'Inspections', 'Punch List', 'Project Completion',
];

export const isWaitingOn = (name: string) => name.startsWith('⏳') || name.startsWith('\u00e2\u008f\u00b3');
export const stripWoPrefix = (name: string) => name.replace(/^⏳\s*/, '').replace(/^\u00e2\u008f\u00b3\s*/, '');

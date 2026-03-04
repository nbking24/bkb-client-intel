// ============================================================
// Design Manager Agent — Data Gathering & Analysis Layer
//
// Collects data from JobTread + GHL to give the AI agent
// full context on all design-phase projects.
// ============================================================

import {
  STANDARD_PHASES,
  DESIGN_AGENT_STATUSES,
  AGENT_RULES,
  GHL_CONFIG,
  JT_MEMBERS,
  type StatusCategoryKey,
  type ProjectHealthStatus,
} from './constants';
import {
  getActiveJobs,
  getJobSchedule,
  type JTJob,
  type JTJobSchedule,
} from './jobtread';
import {
  searchContacts,
  searchConversations,
  getConversationMessages,
} from './ghl';

// ============================================================
// Types
// ============================================================

export interface ProjectScheduleSummary {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  customStatus: string | null;
  categories: CategorySummary[];
  missingCategories: string[];
  orphanTaskCount: number;
  overdueTasks: TaskSummary[];
  upcomingTasks: TaskSummary[];
  undatedTasks: TaskSummary[];  // NEW: tasks with no start or end date
  currentPhase: string | null;
  totalProgress: number;
}

export interface CategorySummary {
  id: string;
  name: string;
  standardNumber: number | null;
  progress: number;
  taskCount: number;
  completedCount: number;
  tasks: TaskSummary[];
}

export interface TaskSummary {
  id: string;
  name: string;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  assignee: string | null;
  daysUntilDue: number | null;
  isOverdue: boolean;
  categoryName: string;
}

export interface ClientContactInfo {
  lastContactDate: string | null;
  daysSinceContact: number | null;
  lastContactType: string | null;
  lastContactDirection: string | null;
  lastMessagePreview: string | null;
  ghlContactId: string | null;
  noContactAlert: boolean;
}

export interface AgentProjectContext {
  schedule: ProjectScheduleSummary;
  clientContact: ClientContactInfo;
  health: ProjectHealthStatus;
  alerts: string[];
}

export interface AgentFullContext {
  generatedAt: string;
  projectCount: number;
  projects: AgentProjectContext[];
  // Raw summary stats
  alertCount: number;
  stalledCount: number;
  atRiskCount: number;
  onTrackCount: number;
}

// ============================================================
// Date Helpers
// ============================================================

/**
 * Get today's date as a plain YYYY-MM-DD string in US Eastern time.
 * This avoids timezone drift when the server is UTC and JT stores
 * date-only strings (e.g. "2026-03-03").
 */
function getTodayDateString(): string {
  const now = new Date();
  // Use US Eastern (BKB is in Ohio area)
  const eastern = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return eastern; // "YYYY-MM-DD"
}

/**
 * Calculate the difference in calendar days between two date strings.
 * Positive = future, negative = past/overdue.
 * Both dates should be YYYY-MM-DD or ISO strings (only date part used).
 */
function daysBetweenDates(todayStr: string, targetDateStr: string): number {
  // Parse as date-only (noon UTC) to avoid DST issues
  const today = new Date(todayStr + 'T12:00:00Z');
  const target = new Date(targetDateStr.slice(0, 10) + 'T12:00:00Z');
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

// ============================================================
// 1. Get Design-Phase Projects from JobTread
// ============================================================

export async function getDesignPhaseProjects(): Promise<JTJob[]> {
  const allJobs = await getActiveJobs(50);
  return allJobs.filter(
    (job) => job.customStatus && DESIGN_AGENT_STATUSES.includes(job.customStatus as any)
  );
}

// ============================================================
// 2. Analyze a Single Project's Schedule
// ============================================================

export async function analyzeProjectSchedule(jobId: string): Promise<ProjectScheduleSummary | null> {
  const schedule = await getJobSchedule(jobId);
  if (!schedule) return null;

  const todayStr = getTodayDateString();

  // Map phases to category summaries
  const categories: CategorySummary[] = schedule.phases.map((phase) => {
    const standardMatch = STANDARD_PHASES.find(
      (sp) => sp.name.toLowerCase() === phase.name.toLowerCase()
    );
    const tasks: TaskSummary[] = (phase.childTasks?.nodes || []).map((t: any) => {
      // Use date-only comparison to fix timezone-related false overdue reports
      const hasEndDate = !!t.endDate;
      const daysUntilDue = hasEndDate
        ? daysBetweenDates(todayStr, t.endDate)
        : null;

      return {
        id: t.id,
        name: t.name,
        progress: t.progress ?? 0,
        startDate: t.startDate,
        endDate: t.endDate,
        assignee: null, // Will be enriched if needed
        daysUntilDue,
        isOverdue: daysUntilDue !== null && daysUntilDue < 0 && (t.progress ?? 0) < 1,
        categoryName: phase.name,
      };
    });

    const completedCount = tasks.filter((t) => t.progress >= 1).length;

    return {
      id: phase.id,
      name: phase.name,
      standardNumber: standardMatch?.number ?? null,
      progress: phase.progress ?? 0,
      taskCount: tasks.length,
      completedCount,
      tasks,
    };
  });

  // Find missing standard categories
  const existingNames = categories.map((c) => c.name.toLowerCase());
  const missingCategories = STANDARD_PHASES
    .filter((sp) => !existingNames.includes(sp.name.toLowerCase()))
    .map((sp) => sp.name);

  // Identify current active phase (first non-complete category with tasks)
  let currentPhase: string | null = null;
  for (const cat of categories) {
    if (cat.taskCount > 0 && cat.progress < 1) {
      currentPhase = cat.name;
      break;
    }
  }

  // Collect overdue, upcoming, and undated tasks
  const allTasks = categories.flatMap((c) => c.tasks);

  const overdueTasks = allTasks
    .filter((t) => t.isOverdue)
    .sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0));

  const upcomingTasks = allTasks
    .filter(
      (t) =>
        !t.isOverdue &&
        t.daysUntilDue !== null &&
        t.daysUntilDue >= 0 &&
        t.daysUntilDue <= AGENT_RULES.warningDeadlineDays &&
        t.progress < 1
    )
    .sort((a, b) => (a.daysUntilDue ?? 99) - (b.daysUntilDue ?? 99));

  // NEW: Find incomplete tasks with no end date (and no start date)
  const undatedTasks = allTasks.filter(
    (t) => t.progress < 1 && !t.endDate && !t.startDate
  );

  return {
    jobId: schedule.id,
    jobName: schedule.name,
    jobNumber: schedule.number,
    clientName: schedule.clientName || schedule.locationName || 'Unknown',
    customStatus: schedule.customStatus ?? null,
    categories,
    missingCategories,
    orphanTaskCount: schedule.orphanTasks?.length || 0,
    overdueTasks,
    upcomingTasks,
    undatedTasks,
    currentPhase,
    totalProgress: schedule.totalProgress || 0,
  };
}

// ============================================================
// 3. Get Client Contact Info from GHL
// ============================================================

export async function getClientContactInfo(clientName: string): Promise<ClientContactInfo> {
  const empty: ClientContactInfo = {
    lastContactDate: null,
    daysSinceContact: null,
    lastContactType: null,
    lastContactDirection: null,
    lastMessagePreview: null,
    ghlContactId: null,
    noContactAlert: false,
  };

  if (!clientName || clientName === 'Unknown') return empty;

  try {
    // Search for the client in GHL
    const contacts = await searchContacts(clientName, 5);
    if (contacts.length === 0) {
      // Try with just the last name
      const lastName = clientName.split(' ').pop() || clientName;
      const retry = await searchContacts(lastName, 5);
      if (retry.length === 0) return { ...empty, noContactAlert: true };
      contacts.push(...retry);
    }

    const contact = contacts[0];
    empty.ghlContactId = contact.id;

    // Get conversations for this contact
    const conversations = await searchConversations(contact.id);
    if (conversations.length === 0) {
      return { ...empty, ghlContactId: contact.id, noContactAlert: true };
    }

    // Find the most recent conversation with a message date
    const sorted = conversations
      .filter((c: any) => c.lastMessageDate)
      .sort(
        (a: any, b: any) =>
          new Date(b.lastMessageDate).getTime() - new Date(a.lastMessageDate).getTime()
      );

    if (sorted.length === 0) {
      return { ...empty, ghlContactId: contact.id, noContactAlert: true };
    }

    const latest = sorted[0];
    const lastDate = new Date(latest.lastMessageDate);
    const now = new Date();
    const daysSince = Math.floor(
      (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      lastContactDate: latest.lastMessageDate,
      daysSinceContact: daysSince,
      lastContactType: latest.lastMessageType || null,
      lastContactDirection: latest.lastMessageDirection || null,
      lastMessagePreview: latest.lastMessageBody?.slice(0, 100) || null,
      ghlContactId: contact.id,
      noContactAlert: daysSince > AGENT_RULES.maxDaysNoContact,
    };
  } catch (err) {
    console.error(`GHL contact lookup failed for "${clientName}":`, err);
    return empty;
  }
}

// ============================================================
// 4. Determine Project Health
// ============================================================

function assessProjectHealth(
  schedule: ProjectScheduleSummary,
  contact: ClientContactInfo
): { health: ProjectHealthStatus; alerts: string[] } {
  const alerts: string[] = [];
  let health: ProjectHealthStatus = 'on_track';

  // Check for overdue tasks — only trigger at_risk if past the grace period
  if (schedule.overdueTasks.length > 0) {
    const count = schedule.overdueTasks.length;
    const worst = schedule.overdueTasks[0];
    alerts.push(
      `${count} overdue task${count > 1 ? 's' : ''} — worst: "${worst.name}" (${Math.abs(worst.daysUntilDue!)}d overdue)`
    );

    // Only downgrade health if any task is overdue beyond the grace period
    const significantlyOverdue = schedule.overdueTasks.filter(
      (t) => t.daysUntilDue !== null && Math.abs(t.daysUntilDue) >= AGENT_RULES.overdueGraceDays
    );
    if (significantlyOverdue.length > 0) {
      health = 'at_risk';
    }
  }

  // Check for urgent upcoming tasks — INFORMATIONAL ONLY, does NOT change health
  const urgentTasks = schedule.upcomingTasks.filter(
    (t) => t.daysUntilDue !== null && t.daysUntilDue <= AGENT_RULES.urgentDeadlineDays
  );
  if (urgentTasks.length > 0) {
    alerts.push(
      `${urgentTasks.length} task${urgentTasks.length > 1 ? 's' : ''} due within ${AGENT_RULES.urgentDeadlineDays} day${AGENT_RULES.urgentDeadlineDays > 1 ? 's' : ''}`
    );
    // NOTE: No longer sets health to at_risk — upcoming deadlines are normal workflow
  }

  // NEW: Check for undated tasks (tasks without any dates assigned)
  if (schedule.undatedTasks.length > 0) {
    const count = schedule.undatedTasks.length;
    const examples = schedule.undatedTasks.slice(0, 3).map(t => t.name).join(', ');
    alerts.push(
      `${count} task${count > 1 ? 's' : ''} without assigned dates — may be missed work (${examples}${count > 3 ? '...' : ''})`
    );
  }

  // Check for no client contact
  if (contact.noContactAlert) {
    const days = contact.daysSinceContact;
    if (days !== null) {
      alerts.push(`No client contact in ${days} days (limit: ${AGENT_RULES.maxDaysNoContact})`);
    } else {
      alerts.push('No GHL contact record found — cannot track client communication');
    }
    health = 'at_risk';
  }

  // Check for missing schedule categories
  if (schedule.missingCategories.length > 0) {
    alerts.push(
      `Schedule missing standard categories: ${schedule.missingCategories.join(', ')}`
    );
  }

  // Check if no current phase identified (possible stall)
  if (!schedule.currentPhase && schedule.totalProgress < 1) {
    alerts.push('No active phase detected — schedule may be stalled or needs tasks');
    health = 'stalled';
  }

  // If everything is at 100%, it's complete
  if (schedule.totalProgress >= 1) {
    health = 'complete';
  }

  // Escalate to stalled if both significantly overdue AND no contact
  const hasSignificantOverdue = schedule.overdueTasks.some(
    (t) => t.daysUntilDue !== null && Math.abs(t.daysUntilDue) >= AGENT_RULES.overdueGraceDays
  );
  if (hasSignificantOverdue && contact.noContactAlert) {
    health = 'stalled';
  }

  return { health, alerts };
}

// ============================================================
// 5. Build Full Agent Context (the main entry point)
// ============================================================

export async function buildAgentContext(): Promise<AgentFullContext> {
  // 1. Get all design-phase projects
  const jobs = await getDesignPhaseProjects();

  // 2. For each project, gather schedule + contact data in parallel
  const projectContexts: AgentProjectContext[] = await Promise.all(
    jobs.map(async (job) => {
      // Run schedule analysis and GHL lookup in parallel
      const [schedule, clientContact] = await Promise.all([
        analyzeProjectSchedule(job.id),
        getClientContactInfo(job.clientName || job.name.split(' ')[0]),
      ]);

      if (!schedule) {
        // Job found but schedule couldn't be loaded
        return {
          schedule: {
            jobId: job.id,
            jobName: job.name,
            jobNumber: job.number,
            clientName: job.clientName || 'Unknown',
            customStatus: job.customStatus || null,
            categories: [],
            missingCategories: STANDARD_PHASES.map((p) => p.name),
            orphanTaskCount: 0,
            overdueTasks: [],
            upcomingTasks: [],
            undatedTasks: [],
            currentPhase: null,
            totalProgress: 0,
          },
          clientContact,
          health: 'blocked' as ProjectHealthStatus,
          alerts: ['Could not load schedule from JobTread'],
        };
      }

      const { health, alerts } = assessProjectHealth(schedule, clientContact);

      return { schedule, clientContact, health, alerts };
    })
  );

  // 3. Calculate summary stats
  const alertCount = projectContexts.reduce((sum, p) => sum + p.alerts.length, 0);
  const stalledCount = projectContexts.filter((p) => p.health === 'stalled').length;
  const atRiskCount = projectContexts.filter((p) => p.health === 'at_risk').length;
  const onTrackCount = projectContexts.filter((p) => p.health === 'on_track').length;

  return {
    generatedAt: new Date().toISOString(),
    projectCount: projectContexts.length,
    projects: projectContexts,
    alertCount,
    stalledCount,
    atRiskCount,
    onTrackCount,
  };
}

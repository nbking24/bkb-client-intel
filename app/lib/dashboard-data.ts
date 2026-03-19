/**
 * Dashboard Data Aggregation Layer
 *
 * Gathers per-user data from JobTread (tasks, jobs, comments, daily logs),
 * Gmail (unread emails), for the personalized AI dashboard.
 *
 * Data sources per role:
 * - owner (Nathan): JT tasks, all jobs, JT comments directed at them, Gmail inbox, daily logs (actionable only)
 * - admin (Terri): JT tasks, all jobs, JT comments directed at them, daily logs (actionable only)
 * - field_sup: their assigned jobs/tasks, daily logs
 * - field: their tasks only
 */

import {
  getOpenTasksForMember,
  getOpenTasksForMemberAcrossJobs,
  getAllOpenTasks,
  getActiveJobs,
  pave,
  type JTJob,
} from './jobtread';
import { TEAM_USERS, ROLE_CONFIG, type TeamRole } from './constants';
import { createServerClient } from './supabase';
import { fetchGmailInbox, fetchCalendarEvents, type GmailMessage, type CalendarEvent } from './google-api';

export interface DashboardTask {
  id: string;
  name: string;
  jobName: string;
  jobNumber: string;
  endDate: string | null;
  startDate: string | null;
  progress: number;
  urgency: 'urgent' | 'high' | 'normal';
  daysUntilDue: number | null;
  assignee?: string;
}

export interface DashboardMessage {
  id: string;
  content: string;
  authorName: string;
  jobName: string;
  jobNumber: string;
  createdAt: string;
  type: 'jt_comment' | 'gmail';
}

export interface DashboardEmail {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
}

export interface DashboardDailyLog {
  id: string;
  date: string;
  notes: string;
  jobName: string;
  authorName: string;
}

export interface UserDashboardData {
  userId: string;
  userName: string;
  role: TeamRole;
  tasks: DashboardTask[];
  recentMessages: DashboardMessage[];
  recentDailyLogs: DashboardDailyLog[];
  recentEmails: DashboardEmail[];
  calendarEvents: CalendarEvent[];
  activeJobs: Array<{ id: string; name: string; number: string; status?: string }>;
  stats: {
    totalTasks: number;
    urgentTasks: number;
    highPriorityTasks: number;
    tasksToday: number;
    recentMessageCount: number;
    activeJobCount: number;
    unreadEmailCount: number;
    upcomingEventsCount: number;
  };
}

function classifyUrgency(endDate: string | null, progress: number): { urgency: 'urgent' | 'high' | 'normal'; daysUntilDue: number | null } {
  if (!endDate || progress >= 1) return { urgency: 'normal', daysUntilDue: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(endDate);
  due.setHours(0, 0, 0, 0);
  const days = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0 || days <= 2) return { urgency: 'urgent', daysUntilDue: days };
  if (days <= 5) return { urgency: 'high', daysUntilDue: days };
  return { urgency: 'normal', daysUntilDue: days };
}

/**
 * Fetch JT comments directed at a specific user from recent active jobs.
 * Uses PAVE to get comments with full context (author membership, job info).
 * Filters to messages that mention the user's first name (directed at them),
 * excluding messages written by the user themselves.
 */
async function fetchJTCommentsForUser(
  userName: string,
  membershipId: string,
  activeJobIds: string[]
): Promise<DashboardMessage[]> {
  const firstName = userName.split(' ')[0].toLowerCase();
  const messages: DashboardMessage[] = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Query comments from the 25 most recent active jobs, one at a time
  for (const jobId of activeJobIds.slice(0, 25)) {
    try {
      const result = await pave({
        job: {
          $: { id: jobId },
          name: {},
          number: {},
          comments: {
            $: { size: 20 },
            nodes: {
              id: {},
              message: {},
              createdAt: {},
              isPinned: {},
              createdByMembership: { id: {}, user: { name: {} } },
            },
          },
        },
      });

      const job = (result as any)?.job;
      if (!job?.comments?.nodes) continue;
      const jobName = job.name || '';
      const jobNumber = job.number || '';

      for (const c of job.comments.nodes) {
        const createdAt = new Date(c.createdAt);
        if (createdAt < sevenDaysAgo) continue;

        const authorMembershipId = c.createdByMembership?.id || '';
        const authorName = c.createdByMembership?.user?.name || 'Unknown';
        const msgLower = (c.message || '').toLowerCase();

        // Skip messages BY this user (they already know what they wrote)
        if (authorMembershipId === membershipId) continue;

        // Include if message mentions user's first name (directed at them)
        const mentionsUser = msgLower.includes(firstName);

        if (mentionsUser) {
          messages.push({
            id: c.id,
            content: (c.message || '').slice(0, 300),
            authorName,
            jobName,
            jobNumber,
            createdAt: c.createdAt,
            type: 'jt_comment',
          });
        }
      }
    } catch (jobErr: any) {
      // Skip individual job errors silently
    }
  }

  // Sort by date, newest first
  messages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return messages.slice(0, 20);
}

export async function buildUserDashboardData(userId: string): Promise<UserDashboardData> {
  const user = TEAM_USERS[userId];
  if (!user) throw new Error(`Unknown userId: ${userId}`);

  const { role, membershipId, name: userName } = user;

  // Fetch active jobs FIRST — needed for both per-job task scan and comment fetching
  let activeJobs: Array<{ id: string; name: string; number: string; status?: string }> = [];
  try {
    const jobs = await getActiveJobs(50);
    activeJobs = jobs.map((j: JTJob) => ({
      id: j.id,
      name: j.name,
      number: j.number,
      status: j.customStatus || undefined,
    }));
  } catch (err: any) {
    console.error('[DashboardData] Failed to fetch active jobs:', err.message);
  }

  // Fetch tasks assigned to user by scanning each active job.
  // The org-level query caps at 100 tasks (oldest first) and misses newer jobs,
  // so we query per-job to get the complete picture.
  let rawTasks: any[] = [];
  try {
    rawTasks = await getOpenTasksForMemberAcrossJobs(
      membershipId,
      activeJobs.map(j => j.id)
    );
  } catch (err: any) {
    console.error('[DashboardData] Failed to fetch tasks:', err.message);
  }

  const tasks: DashboardTask[] = rawTasks.map((t: any) => {
    const { urgency, daysUntilDue } = classifyUrgency(t.endDate, t.progress ?? 0);
    // Extract assignee names from membership data
    const assigneeNames = (t.assignedMemberships?.nodes || [])
      .map((m: any) => m.user?.name || '')
      .filter(Boolean)
      .join(', ');
    return {
      id: t.id,
      name: t.name,
      jobName: t.jobName || t.job?.name || '',
      jobNumber: t.jobNumber || t.job?.number || '',
      endDate: t.endDate || null,
      startDate: t.startDate || null,
      progress: t.progress ?? 0,
      urgency,
      daysUntilDue,
      assignee: assigneeNames || t.assignee || undefined,
    };
  });

  const urgencyOrder = { urgent: 0, high: 1, normal: 2 };
  tasks.sort((a, b) => {
    const uDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (uDiff !== 0) return uDiff;
    if (a.daysUntilDue === null && b.daysUntilDue === null) return 0;
    if (a.daysUntilDue === null) return 1;
    if (b.daysUntilDue === null) return -1;
    return a.daysUntilDue - b.daysUntilDue;
  });

  // Fetch JT comments directed at this user (live from PAVE with author names)
  let recentMessages: DashboardMessage[] = [];
  try {
    recentMessages = await fetchJTCommentsForUser(
      userName,
      membershipId,
      activeJobs.map(j => j.id)
    );
  } catch (err: any) {
    console.error('[DashboardData] Failed to fetch JT comments:', err.message);
  }

  // Fetch recent daily logs from Supabase cache
  // These are only passed to AI for context — AI is instructed to only flag actionable items
  let recentDailyLogs: DashboardDailyLog[] = [];
  try {
    const supabase = createServerClient();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: logs } = await supabase
      .from('jt_daily_logs')
      .select('*')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(20);

    if (logs) {
      recentDailyLogs = logs.map((l: any) => ({
        id: l.id,
        date: l.date || l.created_at,
        notes: (l.notes || l.content || '').slice(0, 300),
        jobName: l.job_name || '',
        authorName: l.author_name || l.member_name || 'Unknown',
      }));
    }
  } catch (err: any) {
    console.error('[DashboardData] Failed to fetch daily logs:', err.message);
  }

  // Fetch Gmail inbox (recent primary emails — skip promotions/social)
  let recentEmails: DashboardEmail[] = [];
  try {
    const gmailMessages = await fetchGmailInbox(15);
    recentEmails = gmailMessages.map(m => ({
      id: m.id,
      threadId: m.threadId,
      from: m.from,
      subject: m.subject,
      snippet: m.snippet,
      date: m.date,
      isUnread: m.isUnread,
    }));
  } catch (err: any) {
    console.error('[DashboardData] Failed to fetch Gmail:', err.message);
  }

  // Fetch Google Calendar events (next 7 days)
  let calendarEvents: CalendarEvent[] = [];
  try {
    calendarEvents = await fetchCalendarEvents(7);
  } catch (err: any) {
    console.error('[DashboardData] Failed to fetch calendar:', err.message);
  }

  // Compute stats
  const today = new Date().toISOString().split('T')[0];
  const stats = {
    totalTasks: tasks.length,
    urgentTasks: tasks.filter(t => t.urgency === 'urgent').length,
    highPriorityTasks: tasks.filter(t => t.urgency === 'high').length,
    tasksToday: tasks.filter(t => t.endDate?.startsWith(today)).length,
    recentMessageCount: recentMessages.length,
    activeJobCount: activeJobs.length,
    unreadEmailCount: recentEmails.filter(e => e.isUnread).length,
    upcomingEventsCount: calendarEvents.length,
  };

  return {
    userId,
    userName,
    role,
    tasks: tasks.slice(0, 50),
    recentMessages,
    recentDailyLogs,
    recentEmails,
    calendarEvents,
    activeJobs,
    stats,
  };
}

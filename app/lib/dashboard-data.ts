/**
 * Dashboard Data Aggregation Layer
 *
 * Gathers per-user data from JobTread (tasks, jobs, comments, daily logs)
 * and GHL (messages) for the personalized AI dashboard.
 *
 * Role-based filtering:
 * - owner: all jobs, all team tasks, financials
 * - admin: all jobs, billing data
 * - field_sup: their assigned jobs/tasks, daily logs
 * - field: their tasks only
 */

import {
  getOpenTasksForMember,
  getAllOpenTasks,
  getActiveJobs,
  type JTJob,
} from './jobtread';
import { TEAM_USERS, ROLE_CONFIG, type TeamRole } from './constants';
import { createServerClient } from './supabase';

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
  createdAt: string;
  type: 'jt_comment' | 'ghl_message';
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
  activeJobs: Array<{ id: string; name: string; number: string; status?: string }>;
  stats: {
    totalTasks: number;
    urgentTasks: number;
    highPriorityTasks: number;
    tasksToday: number;
    recentMessageCount: number;
    activeJobCount: number;
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

export async function buildUserDashboardData(userId: string): Promise<UserDashboardData> {
  const user = TEAM_USERS[userId];
  if (!user) throw new Error(`Unknown userId: ${userId}`);

  const { role, membershipId, name: userName } = user;
  const permissions = ROLE_CONFIG[role];

  // Fetch tasks based on role
  let rawTasks: any[] = [];
  if (permissions.canViewAllTasks) {
    // Owner: see all team tasks
    rawTasks = await getAllOpenTasks();
  } else {
    // Everyone else: only their assigned tasks
    rawTasks = await getOpenTasksForMember(membershipId);
  }

  // Classify urgency and build task list
  const tasks: DashboardTask[] = rawTasks.map((t: any) => {
    const { urgency, daysUntilDue } = classifyUrgency(t.endDate, t.progress ?? 0);
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
      assignee: t.assignee || undefined,
    };
  });

  // Sort: urgent → high → normal, then by due date
  const urgencyOrder = { urgent: 0, high: 1, normal: 2 };
  tasks.sort((a, b) => {
    const uDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (uDiff !== 0) return uDiff;
    if (a.daysUntilDue === null && b.daysUntilDue === null) return 0;
    if (a.daysUntilDue === null) return 1;
    if (b.daysUntilDue === null) return -1;
    return a.daysUntilDue - b.daysUntilDue;
  });

  // Fetch active jobs
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

  // Fetch recent JT comments from Supabase cache
  let recentMessages: DashboardMessage[] = [];
  try {
    const supabase = createServerClient();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: comments } = await supabase
      .from('jt_comments')
      .select('*')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(30);

    if (comments) {
      recentMessages = comments.map((c: any) => ({
        id: c.id,
        content: (c.content || c.message || '').slice(0, 200),
        authorName: c.author_name || c.member_name || 'Unknown',
        jobName: c.job_name || '',
        createdAt: c.created_at,
        type: 'jt_comment' as const,
      }));
    }
  } catch (err: any) {
    console.error('[DashboardData] Failed to fetch comments:', err.message);
  }

  // Fetch recent daily logs from Supabase cache
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

  // Compute stats
  const today = new Date().toISOString().split('T')[0];
  const stats = {
    totalTasks: tasks.length,
    urgentTasks: tasks.filter(t => t.urgency === 'urgent').length,
    highPriorityTasks: tasks.filter(t => t.urgency === 'high').length,
    tasksToday: tasks.filter(t => t.endDate?.startsWith(today)).length,
    recentMessageCount: recentMessages.length,
    activeJobCount: activeJobs.length,
  };

  return {
    userId,
    userName,
    role,
    tasks: tasks.slice(0, 50), // Cap at 50 for AI context
    recentMessages,
    recentDailyLogs,
    activeJobs,
    stats,
  };
}

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
import { getOpenItems, formatOpenItemsForContext, type ProjectEvent } from './project-memory';

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

export type TimePeriod = 'morning' | 'midday' | 'evening';

export interface TimeContext {
  period: TimePeriod;
  hour: number;
  dayOfWeek: string;
  isWeekend: boolean;
  tomorrowLabel: string; // "tomorrow" or "Monday" if it's Friday
  tomorrowDate: string;  // YYYY-MM-DD
}

export interface TextMessage {
  id: string;
  text: string;
  isFromMe: boolean;
  date: string;
  contactId: string;
  contactDisplay: string;
}

export interface ArAutoRecord {
  date: string;        // ISO date when the AR-AUTO message was sent
  tier: string;        // e.g. "20-day", "30-day", "45-day", "60-day"
}

export interface OutstandingInvoice {
  id: string;
  documentNumber: string;
  jobName: string;
  jobId: string;
  amount: number;
  createdAt: string;
  daysPending: number;
  arAutoSent?: ArAutoRecord[];  // history of automated AR reminders sent
  arHold?: boolean;             // true if [AR-HOLD] is active on this job
}

export interface ChangeOrderSummary {
  jobId: string;
  jobName: string;
  coName: string;
  status: 'approved' | 'pending';
}

export interface UserDashboardData {
  userId: string;
  userName: string;
  role: TeamRole;
  timeContext: TimeContext;
  tasks: DashboardTask[];
  tomorrowTasks: DashboardTask[];
  recentMessages: DashboardMessage[];
  recentDailyLogs: DashboardDailyLog[];
  recentEmails: DashboardEmail[];
  recentTexts: TextMessage[];
  calendarEvents: CalendarEvent[];
  tomorrowCalendarEvents: CalendarEvent[];
  activeJobs: Array<{ id: string; name: string; number: string; status?: string }>;
  openItems: ProjectEvent[];
  openItemsFormatted: string;
  outstandingInvoices: OutstandingInvoice[];
  changeOrders: ChangeOrderSummary[];
  stats: {
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
    recentTextCount: number;
    openItemCount: number;
    outstandingInvoiceCount: number;
    outstandingInvoiceTotal: number;
    pendingCOCount: number;
    approvedCOCount: number;
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

function getTimeContext(): TimeContext {
  // CRITICAL: Vercel runs in UTC. BKB is in Eastern time (America/New_York).
  // All time-of-day logic must use Eastern time, not UTC.
  const nowUTC = new Date();
  const eastern = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'long',
  }).formatToParts(nowUTC);

  const get = (type: string) => eastern.find(p => p.type === type)?.value || '';
  const hour = parseInt(get('hour'), 10);
  const dayOfWeek = get('weekday');
  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);

  // Create a Date object representing "now" in Eastern time components
  const etNow = new Date(year, month - 1, day);
  const dayNum = etNow.getDay(); // 0=Sun, 5=Fri, 6=Sat
  const isWeekend = dayNum === 0 || dayNum === 6;
  const isFriday = dayNum === 5;

  // Tomorrow = next business day (Friday→Monday, Sat→Monday, Sun→Monday, otherwise next day)
  const tomorrowDate = new Date(etNow);
  if (isFriday) {
    tomorrowDate.setDate(tomorrowDate.getDate() + 3);
  } else if (dayNum === 6) {
    tomorrowDate.setDate(tomorrowDate.getDate() + 2);
  } else if (dayNum === 0) {
    tomorrowDate.setDate(tomorrowDate.getDate() + 1); // Sunday→Monday
  } else {
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  }

  const tomorrowLabel = (isFriday || dayNum === 6 || dayNum === 0) ? 'Monday' : 'tomorrow';
  const period: TimePeriod = hour < 12 ? 'morning' : hour < 17 ? 'midday' : 'evening';

  // Format tomorrowDate as YYYY-MM-DD
  const tmY = tomorrowDate.getFullYear();
  const tmM = String(tomorrowDate.getMonth() + 1).padStart(2, '0');
  const tmD = String(tomorrowDate.getDate()).padStart(2, '0');

  return {
    period,
    hour,
    dayOfWeek,
    isWeekend,
    tomorrowLabel,
    tomorrowDate: `${tmY}-${tmM}-${tmD}`,
  };
}

/**
 * Fetch outstanding invoices (sent but unpaid) and CO status across all active jobs.
 * Queries documents per job in parallel batches to avoid overloading PAVE.
 * Returns both AR data and change order summaries.
 */
async function fetchARandCOData(
  activeJobs: Array<{ id: string; name: string; number: string }>
): Promise<{ invoices: OutstandingInvoice[]; changeOrders: ChangeOrderSummary[] }> {
  const invoices: OutstandingInvoice[] = [];
  const changeOrders: ChangeOrderSummary[] = [];
  const today = new Date();

  // Process jobs in parallel batches of 8
  const BATCH_SIZE = 8;
  for (let i = 0; i < activeJobs.length; i += BATCH_SIZE) {
    const batch = activeJobs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (job) => {
        // Single PAVE query per job: get documents + cost groups
        const [docData, groupData] = await Promise.all([
          pave({
            job: {
              $: { id: job.id },
              documents: {
                $: { size: 50 },
                nodes: {
                  id: {}, number: {}, status: {}, type: {},
                  price: {}, createdAt: {},
                  costGroups: { nodes: { name: {} } },
                },
              },
            },
          }),
          pave({
            job: {
              $: { id: job.id },
              costGroups: {
                $: { size: 100 },
                nextPage: {},
                nodes: {
                  id: {}, name: {},
                  parentCostGroup: { id: {}, name: {} },
                },
              },
            },
          }),
        ]);

        const docs = (docData as any)?.job?.documents?.nodes || [];
        const groups = (groupData as any)?.job?.costGroups?.nodes || [];

        // --- Outstanding Invoices (AR) ---
        for (const doc of docs) {
          if (doc.type === 'customerInvoice' && doc.status === 'pending') {
            const created = new Date(doc.createdAt);
            const daysPending = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
            invoices.push({
              id: doc.id,
              documentNumber: doc.number || '',
              jobName: job.name,
              jobId: job.id,
              amount: doc.price || 0,
              createdAt: doc.createdAt,
              daysPending,
            });
          }
        }

        // --- Change Order Tracking ---
        // Collect approved CO document cost group names
        const approvedCOGroupNames = new Set<string>();
        for (const doc of docs) {
          if (doc.type === 'customerOrder' && doc.status === 'approved') {
            for (const g of (doc.costGroups?.nodes || [])) {
              if (g.name) approvedCOGroupNames.add(g.name.trim().toLowerCase());
            }
          }
        }

        // Find CO root groups and their children
        const coRootIds = new Set<string>(
          groups
            .filter((g: any) => /change\s*order|🔁|post\s*pricing/i.test(g.name || ''))
            .map((g: any) => g.id as string)
        );

        if (coRootIds.size === 0) return; // No COs in this job

        const childrenOf = new Map<string, any[]>();
        for (const g of groups) {
          const pid = g.parentCostGroup?.id;
          if (pid) {
            if (!childrenOf.has(pid)) childrenOf.set(pid, []);
            childrenOf.get(pid)!.push(g);
          }
        }

        const visited = new Set<string>();
        const seenNames = new Set<string>();

        function findCOGroups(parentId: string, depth: number) {
          const children = childrenOf.get(parentId) || [];
          for (const child of children) {
            if (visited.has(child.id)) continue;
            visited.add(child.id);

            const isStructural = /^(client|owner|bkb)\s+requested$|^[🟢✅]\s*approved$|^🔴\s*declined$|^scope\s*of\s*work$/i.test(child.name?.trim() || '');

            if (isStructural) {
              findCOGroups(child.id, depth + 1);
            } else if (depth <= 3) {
              const normName = (child.name || '').trim().toLowerCase();
              if (!seenNames.has(normName)) {
                seenNames.add(normName);
                changeOrders.push({
                  jobId: job.id,
                  jobName: job.name,
                  coName: child.name,
                  status: approvedCOGroupNames.has(normName) ? 'approved' : 'pending',
                });
              }
            }
          }
        }

        for (const rootId of Array.from(coRootIds)) {
          findCOGroups(rootId, 0);
        }
      })
    );

    // Log any failures but don't throw
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('[DashboardData] AR/CO fetch error:', r.reason?.message || r.reason);
      }
    }
  }

  // Sort invoices: oldest (most days pending) first
  invoices.sort((a, b) => b.daysPending - a.daysPending);
  // Sort COs: pending first, then by job name
  changeOrders.sort((a, b) => {
    if (a.status === b.status) return a.jobName.localeCompare(b.jobName);
    return a.status === 'pending' ? -1 : 1;
  });

  // --- Enrich invoices with AR-AUTO comment history ---
  // Get unique job IDs from invoices to minimize API calls
  const invoiceJobIds = Array.from(new Set<string>(invoices.map(inv => inv.jobId)));
  const AR_AUTO_RE = /\[AR-AUTO\]/i;
  const AR_HOLD_RE = /\[AR-HOLD\]/i;
  const AR_RESUME_RE = /\[AR-RESUME\]/i;
  const TIER_RE = /(?:Friendly Reminder|Quick Follow-Up|Checking In)/i;

  try {
    const commentResults = await Promise.allSettled(
      invoiceJobIds.map(async (jobId) => {
        const resp = await pave({
          job: {
            $: { id: jobId },
            comments: {
              $: { size: 100 },
              nodes: {
                id: {}, message: {}, createdAt: {}, name: {},
              },
            },
          },
        });
        return { jobId, comments: (resp as any)?.job?.comments?.nodes || [] };
      })
    );

    // Build a map of jobId → { arRecords, isHeld }
    const arDataByJob = new Map<string, { records: ArAutoRecord[]; isHeld: boolean }>();

    for (const result of commentResults) {
      if (result.status !== 'fulfilled') continue;
      const { jobId, comments } = result.value;
      const records: ArAutoRecord[] = [];
      let lastHoldDate = 0;
      let lastResumeDate = 0;

      for (const c of comments) {
        const body = (c.message || '') + ' ' + (c.name || '');
        if (AR_AUTO_RE.test(body)) {
          // Determine tier from subject/name
          let tier = 'reminder';
          const name = c.name || '';
          if (/Friendly Reminder/i.test(name)) tier = '20-day';
          else if (/Quick Follow-Up/i.test(name)) tier = '30-day';
          else if (/Checking In/i.test(name)) tier = '45/60-day';
          records.push({ date: c.createdAt, tier });
        }
        if (AR_HOLD_RE.test(body)) {
          const d = new Date(c.createdAt).getTime();
          if (d > lastHoldDate) lastHoldDate = d;
        }
        if (AR_RESUME_RE.test(body)) {
          const d = new Date(c.createdAt).getTime();
          if (d > lastResumeDate) lastResumeDate = d;
        }
      }

      // Sort records newest first
      records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const isHeld = lastHoldDate > 0 && lastHoldDate > lastResumeDate;
      arDataByJob.set(jobId, { records, isHeld });
    }

    // Enrich each invoice
    for (const inv of invoices) {
      const arData = arDataByJob.get(inv.jobId);
      if (arData) {
        inv.arAutoSent = arData.records;
        inv.arHold = arData.isHeld;
      }
    }
  } catch (err: any) {
    console.error('[DashboardData] AR comment enrichment error:', err.message);
  }

  return { invoices, changeOrders };
}

export async function buildUserDashboardData(userId: string): Promise<UserDashboardData> {
  const user = TEAM_USERS[userId];
  if (!user) throw new Error(`Unknown userId: ${userId}`);

  const { role, membershipId, name: userName } = user;
  const timeContext = getTimeContext();

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
    const gmailMessages = await fetchGmailInbox(15, userId);
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

  // Fetch recent text messages from Supabase (synced from Mac Messages database)
  let recentTexts: TextMessage[] = [];
  try {
    const supabase = createServerClient();
    const { data: textCache } = await supabase
      .from('agent_cache')
      .select('data')
      .eq('key', 'nathan-recent-texts')
      .single();

    if (textCache?.data?.messages) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      recentTexts = (textCache.data.messages as any[])
        .filter((m: any) => m.text && m.date && new Date(m.date) > twentyFourHoursAgo)
        .slice(0, 30)
        .map((m: any) => ({
          id: m.id,
          text: m.text.slice(0, 300),
          isFromMe: m.is_from_me,
          date: m.date,
          contactId: m.contact_id || '',
          contactDisplay: m.contact_display || 'Unknown',
        }));
    }
  } catch (err: any) {
    console.error('[DashboardData] Failed to fetch texts:', err.message);
  }

  // Fetch Google Calendar events (next 7 days)
  let calendarEvents: CalendarEvent[] = [];
  try {
    calendarEvents = await fetchCalendarEvents(7, undefined, undefined, userId);
  } catch (err: any) {
    console.error('[DashboardData] Failed to fetch calendar:', err.message);
  }

  // Fetch tomorrow's calendar events specifically
  let tomorrowCalendarEvents: CalendarEvent[] = [];
  try {
    const tmDate = new Date(timeContext.tomorrowDate + 'T00:00:00');
    const tmEnd = new Date(timeContext.tomorrowDate + 'T23:59:59');
    tomorrowCalendarEvents = await fetchCalendarEvents(1, tmDate, tmEnd, userId);
  } catch (err: any) {
    console.error('[DashboardData] Failed to fetch tomorrow calendar:', err.message);
  }

  // Fetch PML open items (pending follow-ups across all projects)
  let openItems: ProjectEvent[] = [];
  let openItemsFormatted = '';
  try {
    openItems = await getOpenItems({ limit: 30 });
    openItemsFormatted = formatOpenItemsForContext(openItems);
  } catch (err: any) {
    console.error('[DashboardData] Failed to fetch PML open items:', err.message);
  }

  // Fetch outstanding invoices (AR) and change order tracking for admin/owner roles
  let outstandingInvoices: OutstandingInvoice[] = [];
  let changeOrders: ChangeOrderSummary[] = [];
  if (role === 'admin' || role === 'owner') {
    try {
      const arcoData = await fetchARandCOData(activeJobs);
      outstandingInvoices = arcoData.invoices;
      changeOrders = arcoData.changeOrders;
    } catch (err: any) {
      console.error('[DashboardData] Failed to fetch AR/CO data:', err.message);
    }
  }

  // Filter tomorrow's tasks
  const tomorrowTasks = tasks.filter(t => t.endDate?.startsWith(timeContext.tomorrowDate));

  // Compute stats
  const today = new Date().toISOString().split('T')[0];
  const stats = {
    totalTasks: tasks.length,
    urgentTasks: tasks.filter(t => t.urgency === 'urgent').length,
    highPriorityTasks: tasks.filter(t => t.urgency === 'high').length,
    tasksToday: tasks.filter(t => t.endDate?.startsWith(today)).length,
    tasksTomorrow: tomorrowTasks.length,
    recentMessageCount: recentMessages.length,
    activeJobCount: activeJobs.length,
    unreadEmailCount: recentEmails.filter(e => e.isUnread).length,
    upcomingEventsCount: calendarEvents.length,
    tomorrowEventsCount: tomorrowCalendarEvents.length,
    recentTextCount: recentTexts.length,
    openItemCount: openItems.length,
    outstandingInvoiceCount: outstandingInvoices.length,
    outstandingInvoiceTotal: outstandingInvoices.reduce((sum, inv) => sum + inv.amount, 0),
    pendingCOCount: changeOrders.filter(co => co.status === 'pending').length,
    approvedCOCount: changeOrders.filter(co => co.status === 'approved').length,
  };

  return {
    userId,
    userName,
    role,
    timeContext,
    tasks: tasks.slice(0, 50),
    tomorrowTasks,
    recentMessages,
    recentDailyLogs,
    recentEmails,
    recentTexts,
    calendarEvents,
    tomorrowCalendarEvents,
    activeJobs,
    openItems,
    openItemsFormatted,
    outstandingInvoices,
    changeOrders,
    stats,
  };
}

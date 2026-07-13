// @ts-nocheck
// ============================================================
// Daily Briefing generator (Nathan's Overview)
//
// Pulls from JobTread, Gmail, Google Calendar, the leads engine, and the
// cached job-costing summary, then assembles ONE pre-computed payload that the
// 3 AM cron stores in `daily_briefings`. The Overview page just reads the row.
//
// Cadence = Option C (Two-Tier):
//   - Daily core (Mon-Fri): calendar, email-needs-reply, JT messages, my tasks,
//     slip alerts, leads, outstanding team tasks
//   - Monday adds "Week Planner" (full job-costing review + week task load)
//   - Friday adds "Week in Review" (job-costing wrap + aging team tasks)
//
// Every section is independently try/caught so one failing source never blanks
// the whole briefing. No em dashes in any generated text (Nathan's rule).
// ============================================================

import { JT_MEMBERS } from '@/app/lib/constants';
import {
  getActiveJobs,
  getOpenTasksForMemberAcrossJobs,
  getAllOpenTasks,
  pave,
  getCommentsFromDB,
  getMembers,
} from '@/app/lib/jobtread';
import { fetchFullInbox, fetchCalendarEvents, threadRepliedByNathan } from '@/app/lib/google-api';
import { computeLeadsNeedsAttention } from '@/app/lib/leads-needs-attention';
import { createServerClient } from '@/app/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

const NATHAN_MEMBERSHIP = JT_MEMBERS.nathan;
const NATHAN_GOOGLE_USER = 'nathan';
const NATHAN_EMAIL = 'nathan@brettkingbuilder.com';

// ---- time helpers (BKB is Central / America/Chicago) ----------------------
function centralNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
}
function startOfTodayCentral(): Date {
  const d = centralNow();
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export type CadenceKind = 'monday' | 'friday' | 'daily';
export function cadenceForDate(d = centralNow()): CadenceKind {
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  if (dow === 1) return 'monday';
  if (dow === 5) return 'friday';
  return 'daily';
}

// ============================================================
// Section builders
// ============================================================

async function buildCalendar() {
  try {
    const start = startOfTodayCentral();
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    const events = await fetchCalendarEvents(0, start, end, NATHAN_GOOGLE_USER);
    return {
      events: (events || []).map((e) => ({
        id: e.id,
        summary: e.summary,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        location: e.location,
        attendeeCount: e.attendeeCount,
      })),
    };
  } catch (err: any) {
    return { events: [], error: err?.message || 'calendar failed' };
  }
}

const AUTOMATED_FROM = [
  'no-reply', 'noreply', 'no_reply', 'notifications@', 'notification@',
  'mailer-daemon', 'donotreply', 'do-not-reply', 'postmaster@', 'bounce',
  'updates@', 'newsletter', 'news@', 'support@resend', 'calendar-notification',
];
function looksAutomated(from: string): boolean {
  const f = (from || '').toLowerCase();
  return AUTOMATED_FROM.some((s) => f.includes(s));
}

// Classify candidate emails with Haiku. Returns a Map<index, {category, needsReply, reason}>
// or null if the AI call fails (so the caller can fall back to a strict heuristic).
async function classifyEmailsForReply(candidates: any[]): Promise<Map<number, any> | null> {
  if (!candidates.length) return new Map();
  try {
    const anthropic = new Anthropic();
    const list = candidates
      .map((m, i) => `${i}. From: ${m.from}\n   Subject: ${m.subject}\n   Preview: ${(m.snippet || '').slice(0, 220)}`)
      .join('\n\n');
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `You are triaging the inbox of Nathan King, owner of Brett King Builder, a high-end residential construction company. For EACH email below decide two things.

category: one of
  "vendor"      a supplier, trade partner, materials or fixtures rep, lumberyard, showroom, inspector, or other business Nathan works with on projects
  "client"      a homeowner or customer for a current or prospective project (including a new lead inquiry)
  "internal"    a Brett King Builder team member (brettkingbuilder.com or a known staffer)
  "automated"   receipts, order or shipping notifications, bank or account statements, calendar or system notices, anything no-reply
  "promotional" marketing, newsletters, cold sales or recruiting outreach
  "other"       anything that does not fit above

needsReply: true ONLY if this specific message is genuinely awaiting a response or action from Nathan, such as a direct question, a request for a quote, scheduling, pricing, an approval, or a decision. Set false for statements, FYIs, confirmations, receipts, marketing, and anything informational that does not ask Nathan for something.

Return ONLY a JSON array, one object per email, in the same order, no prose:
[{"i":0,"category":"vendor","needsReply":true,"reason":"<max 6 words>"}]

Emails:
${list}`,
      }],
    });
    const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const match = text.match(/\[[\s\S]*\]/);
    const arr = match ? JSON.parse(match[0]) : [];
    const map = new Map<number, any>();
    for (const o of arr) if (typeof o.i === 'number') map.set(o.i, o);
    return map;
  } catch (err: any) {
    console.warn('[daily-briefing] email AI triage failed, using heuristic fallback:', err?.message);
    return null;
  }
}

// Strict heuristic fallback when AI triage is unavailable: only keep messages
// that actually look like they request something (a question or a request verb).
function heuristicNeedsReply(m: any): boolean {
  const t = `${m.subject || ''} ${m.snippet || ''}`.toLowerCase();
  if (t.includes('?')) return true;
  return /\b(can you|could you|could we|can we|please (send|confirm|advise|let me know|provide|review|approve)|let me know|need(ed|s)? (your|the)|when (can|will|are)|are you available|quote|estimate|pricing|proposal|schedule|confirm|approve|sign off|get back to)\b/.test(t);
}

async function buildEmailNeedsReply() {
  try {
    const sb = createServerClient();
    const [inbox, dismissalsRes] = await Promise.all([
      // 150 messages over 14 days: covers a moderate inbox volume so
      // Friday inbound emails still surface in Monday's briefing (the
      // downstream cutoff is 14 days but the Gmail query MUST include
      // that window or nothing older than the query window can appear).
      fetchFullInbox(150, NATHAN_GOOGLE_USER, 14),
      sb.from('briefing_email_dismissals').select('gmail_thread_id, dismissed_at'),
    ]);
    const dismissed = new Map<string, string>();
    for (const r of dismissalsRes.data || []) dismissed.set(r.gmail_thread_id, r.dismissed_at);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);

    // Pre-filter: drop self-sent, automated senders, internal teammates, stale, and dismissed.
    const candidates = (inbox || [])
      .filter((m) => {
        const from = (m.from || '').toLowerCase();
        if (from.includes(NATHAN_EMAIL)) return false;          // sent by Nathan
        if (from.includes('@brettkingbuilder.com')) return false; // internal teammate, not a vendor/client
        if (looksAutomated(from)) return false;
        const dt = new Date(m.date);
        if (isNaN(dt.getTime()) || dt < cutoff) return false;
        const dAt = dismissed.get(m.threadId);
        if (dAt && dt <= new Date(dAt)) return false;           // dismissed and nothing newer
        return true;
      })
      .map((m) => ({
        id: m.id,
        threadId: m.threadId,
        from: m.from,
        subject: m.subject || '(no subject)',
        snippet: m.snippet || '',
        date: m.date,
        isUnread: m.isUnread,
        ageDays: daysBetween(centralNow(), new Date(m.date)),
      }));

    // Dedupe to one entry per thread (keep the newest message on each thread).
    const byThread = new Map<string, any>();
    for (const c of candidates) {
      const prev = byThread.get(c.threadId);
      if (!prev || new Date(c.date).getTime() > new Date(prev.date).getTime()) byThread.set(c.threadId, c);
    }
    const deduped = Array.from(byThread.values());

    // Drop threads Nathan has already replied to (his sent reply leaves the
    // original inbound message in the inbox, so we must inspect the thread).
    const replyStates = await Promise.all(
      deduped.map((c) => threadRepliedByNathan(c.threadId, NATHAN_GOOGLE_USER).catch(() => false))
    );
    const unanswered = deduped.filter((_, i) => !replyStates[i]);

    // AI triage: keep only vendor/client emails that genuinely need a reply.
    const cls = await classifyEmailsForReply(unanswered);
    let items: any[];
    let triage: 'ai' | 'heuristic';
    if (cls) {
      triage = 'ai';
      items = unanswered
        .map((m, i) => ({ ...m, ...(cls.get(i) || {}) }))
        .filter((m) => m.needsReply === true && (m.category === 'vendor' || m.category === 'client'));
    } else {
      triage = 'heuristic';
      items = unanswered
        .filter(heuristicNeedsReply)
        .map((m) => ({ ...m, category: null, reason: null }));
    }
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return { items, count: items.length, triage, candidateCount: unanswered.length };
  } catch (err: any) {
    return { items: [], count: 0, error: err?.message || 'gmail failed' };
  }
}

async function buildMyTasks() {
  try {
    const today = startOfTodayCentral();
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 7);

    const tasks = await getOpenTasksForMemberAcrossJobs(NATHAN_MEMBERSHIP);
    const mapped = (tasks || [])
      .map((t) => {
        const due = t.endDate ? new Date(t.endDate) : null;
        const daysUntil = due ? daysBetween(due, today) : null;
        return {
          id: t.id,
          name: t.name,
          jobName: t.job?.name || null,
          jobId: t.job?.id || null,
          jobNumber: t.job?.number || null,
          endDate: t.endDate,
          progress: t.progress,
          daysUntilDue: daysUntil,
          overdue: daysUntil !== null && daysUntil < 0,
        };
      })
      .filter((t) => t.endDate && t.daysUntilDue !== null && new Date(t.endDate) <= horizon)
      .sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0));

    return {
      overdue: mapped.filter((t) => t.overdue),
      upcoming: mapped.filter((t) => !t.overdue),
      count: mapped.length,
    };
  } catch (err: any) {
    return { overdue: [], upcoming: [], count: 0, error: err?.message || 'tasks failed' };
  }
}

async function buildOutstandingTeamTasks() {
  try {
    const today = startOfTodayCentral();
    const [all, members] = await Promise.all([
      getAllOpenTasks(),
      getMembers().catch(() => []),
    ]);
    const nameByMembership = new Map<string, string>();
    for (const m of members || []) if (m?.id) nameByMembership.set(m.id, m.user?.name || '');
    const mapped = (all || [])
      // Drop tasks assigned to Nathan; those appear in the "Your Tasks" section.
      .filter((t) => !((t.assignedMemberships?.nodes) || []).some((n: any) => n.id === NATHAN_MEMBERSHIP))
      .map((t) => {
        const due = t.endDate ? new Date(t.endDate) : null;
        const daysOverdue = due ? daysBetween(today, due) : null;
        const assignees = ((t.assignedMemberships?.nodes) || [])
          .map((n: any) => n.user?.name || nameByMembership.get(n.id) || '')
          .filter(Boolean);
        return {
          id: t.id,
          name: t.name,
          jobName: t.job?.name || null,
          jobNumber: t.job?.number || null,
          endDate: t.endDate,
          progress: t.progress,
          assignees,
          assigneeLabel: assignees.length ? assignees.join(', ') : 'Unassigned',
          daysOverdue: daysOverdue !== null && daysOverdue > 0 ? daysOverdue : 0,
        };
      });
    const overdue = mapped.filter((t) => t.daysOverdue > 0).sort((a, b) => b.daysOverdue - a.daysOverdue);
    return {
      totalOpen: mapped.length,
      overdueCount: overdue.length,
      overdue: overdue.slice(0, 25),
      aging: overdue.filter((t) => t.daysOverdue >= 14).slice(0, 40), // Friday deep view uses this
    };
  } catch (err: any) {
    return { totalOpen: 0, overdueCount: 0, overdue: [], aging: [], error: err?.message || 'team tasks failed' };
  }
}

// Classify candidate JT comments with Haiku. Returns Map<index, {needsReply, reason}>
// or null if the AI call fails (caller falls back to a strict heuristic).
// Same shape as classifyEmailsForReply but tuned for construction-team chatter.
async function classifyJTMessagesForReply(candidates: any[]): Promise<Map<number, any> | null> {
  if (!candidates.length) return new Map();
  try {
    const anthropic = new Anthropic();
    const list = candidates
      .map((m, i) => `${i}. Job: ${m.jobName || '(no job)'}\n   Author: ${m.author || '(unknown)'}\n   Message: ${(m.message || '').slice(0, 500)}`)
      .join('\n\n');
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `You are triaging JobTread messages for Nathan King, owner of Brett King Builder, a high-end residential construction company. These messages are project comments posted by team members, trade partners, or clients on active jobs. For EACH message decide whether Nathan needs to reply.

needsReply: true ONLY when the message directly requests something from Nathan personally, such as:
  - a direct question addressed to him
  - a decision, approval, or sign-off he needs to give
  - pricing, quote, or scope input only he can provide
  - being pinged for confirmation on a specific matter
Set false when the message:
  - just mentions his name in passing ("Nathan approved this yesterday", "waiting on Nathan")
  - is an FYI, status update, log entry, or team chatter
  - is directed at someone else even if his name appears
  - is a system-generated or automated comment
  - is a general observation without an ask

Return ONLY a JSON array, one object per message, in the same order, no prose:
[{"i":0,"needsReply":true,"reason":"<max 6 words>"}]

Messages:
${list}`,
      }],
    });
    const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const match = text.match(/\[[\s\S]*\]/);
    const arr = match ? JSON.parse(match[0]) : [];
    const map = new Map<number, any>();
    for (const o of arr) if (typeof o.i === 'number') map.set(o.i, o);
    return map;
  } catch (err: any) {
    console.warn('[daily-briefing] JT message AI triage failed, using heuristic fallback:', err?.message);
    return null;
  }
}

// Heuristic fallback: only flag messages that both mention Nathan by name
// AND contain a question mark or an obvious request verb. Strict on purpose.
function heuristicJTNeedsReply(m: any): boolean {
  const t = (m.message || '').toLowerCase();
  if (!/\bnathan\b/i.test(t) && !/@nathan/i.test(m.message || '')) return false;
  if (/\?/.test(t)) return true;
  return /\b(please|can you|could you|need|approve|confirm|decide|quote|price|sign off|review|thoughts|update|let me know|get back|response|reply)\b/i.test(t);
}

async function buildMessages(activeJobs: any[]) {
  try {
    // Widened from 3 days to 14 days so messages from earlier in the
    // week still surface on Monday, matching the emails-needing-reply
    // window and giving Nathan a full workweek horizon.
    const sinceDays = 14;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - sinceDays);

    // Author names we treat as "Nathan himself" and exclude from the
    // needs-reply queue (his own comments cannot need his reply).
    const NATHAN_AUTHORS = ['nathan king', 'nathan', 'nate king', 'nate'];
    const isNathanAuthor = (name: string) =>
      NATHAN_AUTHORS.includes((name || '').trim().toLowerCase());

    const jobs = (activeJobs || []).slice(0, 80);
    const collected: any[] = [];
    const BATCH = 20;
    for (let i = 0; i < jobs.length; i += BATCH) {
      const batch = jobs.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (j) => {
          try {
            const comments = await getCommentsFromDB(j.id, 50);
            return (comments || [])
              .filter((c) => c.createdAt && new Date(c.createdAt) >= cutoff)
              .filter((c) => !isNathanAuthor(c.name || ''))
              .map((c) => ({
                id: c.id,
                jobId: j.id,
                jobName: j.name,
                jobNumber: j.number,
                author: c.name || '',
                message: (c.message || '').slice(0, 500),
                createdAt: c.createdAt,
              }));
          } catch {
            return [];
          }
        })
      );
      for (const r of results) collected.push(...r);
    }

    // Cap the classifier input so Haiku bills stay reasonable. We only need
    // the freshest slice to be triaged - older messages that are not yet
    // replied to are unlikely to spike back into "needs reply" territory.
    collected.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const forTriage = collected.slice(0, 60);

    // AI triage: strict "needs Nathan's reply" bar (not just mentions).
    const cls = await classifyJTMessagesForReply(forTriage);
    let flagged: any[];
    let triage: 'ai' | 'heuristic';
    if (cls) {
      triage = 'ai';
      flagged = forTriage
        .map((m, i) => ({ ...m, ...(cls.get(i) || {}) }))
        .filter((m) => m.needsReply === true);
    } else {
      triage = 'heuristic';
      flagged = forTriage.filter(heuristicJTNeedsReply).map((m) => ({ ...m, reason: null }));
    }
    flagged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      flagged: flagged.slice(0, 15),
      count: collected.length,       // total in window (for diagnostics)
      mentionCount: flagged.length,  // number needing Nathan's reply (drives priorities)
      triage,
    };
  } catch (err: any) {
    return { flagged: [], count: 0, mentionCount: 0, error: err?.message || 'messages failed' };
  }
}

async function buildJobCosting() {
  // Read the cached job-costing summary (single row) rather than recompute.
  try {
    const sb = createServerClient();
    const { data } = await sb
      .from('job_costing_summary_cache')
      .select('payload, computed_at')
      .eq('key', 'summary')
      .single();
    const summaries = data?.payload?.summaries || [];
    const rows = summaries.map((s: any) => ({
      jobId: s.jobId,
      jobName: s.jobName,
      jobNumber: s.jobNumber,
      health: s.health,
      margin: s.margin,
      marginPct: s.marginPct,
      contractPrice: s.contractPrice,
      totalCosts: s.totalCosts,
      estimatedCost: s.estimatedCost,
      overUnderBilled: s.overUnderBilled,
      overUnderPercent: s.overUnderPercent,
      costBasedPercent: s.costBasedPercent,
      manualPercentComplete: s.manualPercentComplete ?? null,
      isCostPlus: s.isCostPlus,
      alerts: s.alerts || [],
    }));
    const overBudget = rows.filter((r) => r.health === 'over-budget');
    const watch = rows.filter((r) => r.health === 'watch');
    // Worst margins first for the full-review (Mon/Fri) table
    const sorted = [...rows].sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0));
    return {
      computedAt: data?.computed_at || null,
      jobCount: rows.length,
      overBudget,
      watch,
      all: sorted,
    };
  } catch (err: any) {
    return { computedAt: null, jobCount: 0, overBudget: [], watch: [], all: [], error: err?.message || 'job costing failed' };
  }
}

// Fetch a job's daily logs directly with the correct PAVE fields. The shared
// getDailyLogsForJob() requests an "assignedMemberships" field that does not
// exist on dailyLog in this org's schema, so it 400s and returns []. Daily logs
// expose the author as `user`, and we sort by date desc server-side.
async function fetchLatestDailyLog(jobId: string): Promise<{ date: string | null; by: string | null } | null> {
  try {
    const data = await pave({
      job: {
        $: { id: jobId },
        dailyLogs: {
          $: { size: 1, sortBy: [{ field: 'date', order: 'desc' }] },
          nodes: { id: {}, date: {}, createdAt: {}, user: { id: {}, name: {} } },
        },
      },
    });
    const node = (data as any)?.job?.dailyLogs?.nodes?.[0];
    if (!node) return null;
    return { date: node.date || (node.createdAt ? String(node.createdAt).split('T')[0] : null), by: node.user?.name || null };
  } catch (err: any) {
    console.warn('[daily-briefing] daily log fetch failed for', jobId, err?.message);
    return null;
  }
}

async function buildDailyLogGaps() {
  try {
    const sb = createServerClient();
    const { data: monitored } = await sb
      .from('briefing_monitored_jobs')
      .select('jt_job_id, job_name, job_number, expect_logs, frequency_per_week')
      .eq('expect_logs', true);

    const today = startOfTodayCentral();
    const report: any[] = [];
    for (const m of monitored || []) {
      let lastLogDate: string | null = null;
      let lastLogBy: string | null = null;
      let daysSinceLastLog: number | null = null;
      const latest = await fetchLatestDailyLog(m.jt_job_id);
      if (latest?.date) {
        lastLogDate = latest.date;
        lastLogBy = latest.by;
        const when = new Date(latest.date);
        if (!isNaN(when.getTime())) daysSinceLastLog = daysBetween(today, when);
      }
      const freq = m.frequency_per_week || 2;
      const thresholdDays = Math.ceil(7 / freq) + 1; // grace of 1 day
      const behind = lastLogDate == null || (daysSinceLastLog != null && daysSinceLastLog > thresholdDays);
      report.push({
        jobId: m.jt_job_id,
        jobName: m.job_name,
        jobNumber: m.job_number,
        frequencyPerWeek: freq,
        lastLogDate,
        lastLogBy,
        daysSinceLastLog,
        behind,
      });
    }
    // Behind jobs sort to the top of the report; gaps drive the slip alert + priority count.
    report.sort((a, b) => (b.behind ? 1 : 0) - (a.behind ? 1 : 0) || (b.daysSinceLastLog ?? 999) - (a.daysSinceLastLog ?? 999));
    const gaps = report.filter((r) => r.behind);
    return { gaps, report, monitoredCount: (monitored || []).length };
  } catch (err: any) {
    return { gaps: [], report: [], monitoredCount: 0, error: err?.message || 'daily-log check failed' };
  }
}

async function buildLeads() {
  try {
    const res = await computeLeadsNeedsAttention();
    return {
      newUncontacted: (res.newUncontacted || []).map((l: any) => ({
        contactName: l.contactName,
        opportunityName: l.opportunityName,
        contactId: l.contactId,
      })),
      counts: res.counts,
    };
  } catch (err: any) {
    return { newUncontacted: [], counts: { newUncontacted: 0, upcoming: 0, stale: 0, totalActive: 0 }, error: err?.message || 'leads failed' };
  }
}

// ============================================================
// Assembly
// ============================================================

function buildPriorities(payload: any): string[] {
  const p: string[] = [];
  const email = payload.email?.count || 0;
  if (email > 0) p.push(`${email} email${email === 1 ? '' : 's'} awaiting your reply`);

  const ob = payload.jobCosting?.overBudget?.length || 0;
  if (ob > 0) p.push(`${ob} job${ob === 1 ? '' : 's'} over budget`);

  const gaps = payload.slip?.dailyLogGaps?.length || 0;
  if (gaps > 0) p.push(`${gaps} monitored job${gaps === 1 ? '' : 's'} missing daily logs`);

  const overdueTasks = payload.myTasks?.overdue?.length || 0;
  if (overdueTasks > 0) p.push(`${overdueTasks} of your tasks overdue`);

  const slipTasks = payload.slip?.overdueScheduleJobs?.length || 0;
  if (slipTasks > 0) p.push(`${slipTasks} job${slipTasks === 1 ? '' : 's'} with overdue schedule items`);

  // JT messages priority removed with the section per Nathan 2026-07-06.

  const leads = payload.leads?.counts?.newUncontacted || 0;
  if (leads > 0) p.push(`${leads} new uncontacted lead${leads === 1 ? '' : 's'}`);

  const teamOverdue = payload.teamTasks?.overdueCount || 0;
  if (teamOverdue > 0) p.push(`${teamOverdue} open team task${teamOverdue === 1 ? '' : 's'} overdue across the company`);

  if (p.length === 0) p.push('Nothing urgent flagged. Good morning.');
  return p;
}

export async function generateBriefing() {
  const startTs = Date.now();
  const cadence = cadenceForDate();
  const today = startOfTodayCentral();

  const activeJobs = await getActiveJobs().catch(() => []);

  // JT Messages section removed from the briefing per Nathan
  // (2026-07-06). The AI-triaged needs-reply signal was too noisy to
  // be worth surfacing daily. buildMessages() remains in the file for
  // now in case we revive a curated version later.
  const [calendar, email, myTasks, teamTasks, jobCosting, dailyLogs, leads] = await Promise.all([
    buildCalendar(),
    buildEmailNeedsReply(),
    buildMyTasks(),
    buildOutstandingTeamTasks(),
    buildJobCosting(),
    buildDailyLogGaps(),
    buildLeads(),
  ]);

  // Slip detection aggregates several signals by job.
  // 1) Overdue schedule items: from the team-task overdue list (active jobs).
  const overdueByJob = new Map<string, { jobName: string; jobNumber: string; count: number; maxDaysOverdue: number }>();
  for (const t of teamTasks.overdue || []) {
    const key = t.jobName || 'Unassigned';
    const cur = overdueByJob.get(key) || { jobName: t.jobName, jobNumber: t.jobNumber, count: 0, maxDaysOverdue: 0 };
    cur.count += 1;
    cur.maxDaysOverdue = Math.max(cur.maxDaysOverdue, t.daysOverdue);
    overdueByJob.set(key, cur);
  }
  const overdueScheduleJobs = Array.from(overdueByJob.values()).sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue);

  // 2) Stale tasks: open tasks >14 days overdue.
  const staleJobs = (teamTasks.aging || []).reduce((acc: any[], t: any) => {
    const found = acc.find((x) => x.jobName === t.jobName);
    if (found) found.count += 1;
    else acc.push({ jobName: t.jobName, jobNumber: t.jobNumber, count: 1 });
    return acc;
  }, []);

  const payload: any = {
    version: 1,
    cadence,
    generatedAt: new Date().toISOString(),
    briefingDate: today.toISOString().split('T')[0],
    weekdayLabel: centralNow().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    calendar,
    email,
    myTasks,
    leads,
    teamTasks,
    jobCosting: {
      // Tue-Thu only show exceptions; Mon/Fri include the full list (UI decides via cadence)
      computedAt: jobCosting.computedAt,
      jobCount: jobCosting.jobCount,
      overBudget: jobCosting.overBudget,
      watch: jobCosting.watch,
      all: cadence === 'daily' ? [] : jobCosting.all,
    },
    dailyLogReport: {
      jobs: dailyLogs.report || [],
      monitoredCount: dailyLogs.monitoredCount,
    },
    slip: {
      overdueScheduleJobs,
      budgetBurn: [...jobCosting.overBudget, ...jobCosting.watch],
      dailyLogGaps: dailyLogs.gaps,
      monitoredCount: dailyLogs.monitoredCount,
      staleJobs,
    },
  };

  payload.priorities = buildPriorities(payload);
  payload.generateMs = Date.now() - startTs;
  return payload;
}

export async function storeBriefing(payload: any) {
  const sb = createServerClient();
  const briefingDate = payload.briefingDate;
  const { error } = await sb
    .from('daily_briefings')
    .upsert(
      { briefing_date: briefingDate, payload, generated_at: new Date().toISOString(), generate_ms: payload.generateMs || null },
      { onConflict: 'briefing_date' }
    );
  if (error) throw new Error(`store briefing failed: ${error.message}`);
  return briefingDate;
}

export async function getLatestBriefing() {
  const sb = createServerClient();
  const { data } = await sb
    .from('daily_briefings')
    .select('payload, generated_at, briefing_date')
    .order('briefing_date', { ascending: false })
    .limit(1)
    .single();
  return data || null;
}

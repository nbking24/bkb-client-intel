// @ts-nocheck
/**
 * Planning Meeting: Claude's read of each job for the "Project review" box.
 *
 * Built with the Prep Brief (Tuesday cron or Refresh). Claude gets only what we
 * read from JobTread for that job (Job Plan text, gate checklist, open tasks,
 * roadblocks, selections counts, documents, and the last 30 days of job
 * messages and daily logs including daily log custom fields)
 * plus what the team has told it (corrections to earlier reads, standing
 * context, last meeting's notes, all of which outrank JobTread messages)
 * and writes a short review: where the job actually stands, what we are
 * waiting on, what to focus on to keep it moving, and whether the start date
 * and client goals look realistic. It is told to use only the facts given and
 * to name the source, never to invent dates, numbers or prices.
 */
import Anthropic from '@anthropic-ai/sdk';
import { pave } from '@/app/lib/jobtread';

const MODEL = 'claude-sonnet-4-6';
const clip = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) + ' ...' : s || '');

/** How far back Claude reads messages and daily logs, and how much of it. */
export const CONTEXT_DAYS = 30;
const MIN_COMMENTS = 5;      // a quiet job still gets its last few messages
const MIN_LOGS = 2;
const MAX_COMMENTS = 40;
const MAX_LOGS = 12;
const COMMENT_CHARS = 900;
const LOG_CHARS = 4000;
const COMMENT_BUDGET = 22000; // total characters per job
const LOG_BUDGET = 18000;

/** Drop pasted email footers so they do not eat the budget. */
function tidyMessage(s: string) {
  return String(s || '')
    .replace(/\n\s*NOTICE:[\s\S]*$/i, '')
    .replace(/\n\s*(This email is intended|CONFIDENTIALITY NOTICE)[\s\S]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function keepRecent<T>(rows: T[], dateOf: (r: T) => string, cutoff: string, min: number) {
  return rows.filter((r, i) => i < min || dateOf(r) >= cutoff);
}

function withinBudget<T extends { text: string }>(rows: T[], budget: number) {
  const out: T[] = [];
  let used = 0;
  for (const r of rows) {
    if (used + r.text.length > budget) {
      const room = budget - used;
      if (room > 300) out.push({ ...r, text: clip(r.text, room) });
      break;
    }
    out.push(r);
    used += r.text.length;
  }
  return out;
}

/**
 * Messages and daily logs from the last CONTEXT_DAYS days (at least the last few
 * of each), newest first. Messages include replies and messages on tasks and
 * documents. Daily logs include the notes and every daily log custom field
 * (Work Completed Today, Upcoming Work, Crews, Owner Notes), so Josh's field
 * logs are read too. Photo-only logs are skipped.
 */
export async function fetchJobContext(jobId: string, today?: string) {
  const d: any = await pave({
    job: {
      $: { id: jobId },
      comments: {
        $: { size: MAX_COMMENTS, sortBy: [{ field: ['createdAt'], order: 'desc' }] },
        nodes: { createdAt: {}, message: {}, createdByUser: { name: {} }, parentComment: { id: {} }, task: { name: {} }, document: { name: {} }, dailyLog: { date: {} }, isVisibleToCustomerRoles: {} },
      },
      dailyLogs: {
        $: { size: MAX_LOGS, sortBy: [{ field: ['date'], order: 'desc' }] },
        nodes: { date: {}, notes: {}, user: { name: {} }, customFieldValues: { $: { size: 10 }, nodes: { value: {}, customField: { name: {} } } } },
      },
    },
  });
  const base = today || new Date().toISOString().slice(0, 10);
  const cut = new Date(Date.parse(base + 'T00:00:00Z') - CONTEXT_DAYS * 86400000).toISOString().slice(0, 10);

  const rawComments = d?.job?.comments?.nodes || [];
  const comments = withinBudget(
    keepRecent(rawComments
      .map((c: any) => {
        const on = c.task?.name ? `on task "${c.task.name}"` : c.document?.name ? `on document "${c.document.name}"` : c.dailyLog?.date ? `on daily log ${c.dailyLog.date}` : '';
        return {
          date: String(c.createdAt || '').slice(0, 10),
          by: c.createdByUser?.name || '',
          where: [c.parentComment?.id ? 'reply' : '', on, c.isVisibleToCustomerRoles ? 'client can see' : ''].filter(Boolean).join(', '),
          text: clip(tidyMessage(c.message), COMMENT_CHARS),
        };
      })
      .filter((c) => c.text), (c) => c.date, cut, MIN_COMMENTS),
    COMMENT_BUDGET,
  );

  const rawLogs = d?.job?.dailyLogs?.nodes || [];
  const logs = withinBudget(
    keepRecent(rawLogs
      .map((l: any) => {
        const fields = (l.customFieldValues?.nodes || [])
          .filter((v: any) => v?.value != null && String(v.value).trim())
          .map((v: any) => `${v.customField?.name || 'Field'}: ${String(v.value).trim()}`);
        const text = [String(l.notes || '').trim(), ...fields].filter(Boolean).join('\n');
        return { date: l.date, by: l.user?.name || '', text: clip(text, LOG_CHARS) };
      })
      .filter((l) => l.text), (l) => String(l.date || ''), cut, MIN_LOGS),
    LOG_BUDGET,
  );

  return { comments, logs, days: CONTEXT_DAYS };
}

const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'get', 'got', 'our', 'are', 'was', 'has', 'have', 'that', 'this', 'still', 'need', 'needs', 'next', 'week', 'job']);
/** Rough word stems (first 5 letters, no filler words) for comparing two lines. */
function stems(s: string) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5)));
}
/** True when two lines say nearly the same thing (Dice overlap of word stems). */
export function sameLine(a: string, b: string, threshold = 0.6) {
  const A = stems(a), B = stems(b);
  if (A.size < 2 || B.size < 2) return false;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return (2 * both) / (A.size + B.size) >= threshold;
}

/**
 * What the team has told Claude about this job:
 *   corrections  lines marked "Not right" (target) with the reason (note)
 *   context      standing facts Claude cannot see in JobTread
 *   lastMeeting  the notes typed for this job at the last confirmed meeting
 */
export type TeamContext = {
  corrections?: { date: string; by: string; target: string; note: string }[];
  context?: { date: string; by: string; note: string }[];
  lastMeeting?: { date: string; notes: string } | null;
};

export async function jobInsight(j: any, ctx: any, planText: string, today: string, team: TeamContext = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const gateLines = j.gates.map((g) => `${g.name}: ${g.items.filter((i) => i[1]).length}/${g.items.length} done. Open: ${g.items.filter((i) => !i[1]).map((i) => i[0]).join('; ')}`).join('\n');
  const facts = {
    today,
    job: `${j.name} (#${j.number})`,
    productionStart: j.start ? `${j.startName} on ${j.start}` : 'no production dates on the schedule',
    gateMarkers: j.markers.map((m) => `${m.name.split(' (')[0]}: ${m.date || 'not dated'}`),
    gates: gateLines,
    jobPlan: planText ? clip(planText, 3000) : 'blank template',
    openTasks: j.tasks.map((t) => `${t.name} | ${t.who.join(', ') || 'no owner'} | due ${t.due || 'none'}${t.overdue ? ' | LATE ' + t.days + ' days' : ''}${t.type ? ' | type ' + t.type : ''}`),
    roadblocks: j.roadblocks.map((r) => `${r.name} | ${r.who.join(', ') || 'no owner'} | open ${r.daysOpen} days`),
    selectionsByStatus: j.sel,
    decisionsByDecideBy: (j.decisions?.list || []).slice(0, 15).map((x) => `${x.name}${x.tag ? ' (' + x.tag + ')' : ''} | ${x.status || 'no status'} | decide by ${x.decideBy}${x.decideBy < today ? ' | PAST DUE' : ''}`),
    decisionsWithNoDecideBy: j.decisions?.undated || 0,
    draftOrPendingDocuments: j.docs.map((d) => `${d.name} (${d.type}, ${d.status}, created ${d.created})`),
    messagesLast30Days: ctx.comments,
    dailyLogsLast30Days: ctx.logs,
    teamCorrections: (team.corrections || []).map((c) => ({ date: c.date, by: c.by, claudeSaid: c.target, whyItIsWrong: c.note || 'no reason given' })),
    teamContext: (team.context || []).map((c) => ({ date: c.date, by: c.by, fact: c.note })),
    lastMeetingNotes: team.lastMeeting?.notes ? { date: team.lastMeeting.date, notes: clip(team.lastMeeting.notes, 3000) } : null,
  };
  const system = `You prepare one job for Brett King Builder's weekly planning meeting (high-end residential renovation, jobs in design moving toward a build start).
Write a short project review for the room from ONLY the facts given. Never invent dates, numbers, names, prices or decisions. Do not mention money amounts at all.
Plain language, no jargon, no em dashes or en dashes (use commas or periods). Each line under 25 words.
The messages and daily logs (newest first) are the team's, the client's and vendors' own words from the last ${ctx.days || 30} days. Use them to find decisions, open questions, who is waiting on whom and what changed. Newer outweighs older. If a message says something is done or decided that the tasks or gate checklist do not show, say so in "gaps". Daily logs may be meeting summaries or field reports; field reports describe build progress, not design.
The team's own word outranks everything else. "teamContext" is standing facts from the team; treat them as true. "lastMeetingNotes" are what the team said at the last planning meeting; treat them as true as of that date. "teamCorrections" are lines you wrote before that the team marked wrong or already handled, with the reason. Never repeat or reword a corrected line, and never raise the same item again, unless a message or daily log dated AFTER the correction clearly reopens it; if so, say what reopened it and its date.
Return JSON only:
{"stand":"one or two sentences: where the job actually is in design and how sure we are of the start date",
 "waiting":["2 or 3 items, each under 8 words: who or what, e.g. 'Client: tile choice' (max 3, most blocking first)"],
 "focus":["the 1 to 3 things that would move this job forward most this week"],
 "recent":["what changed or was decided in the messages and daily logs, newest first, each starting with the date like 25 Sep (max 4, empty if nothing)"],
 "goal":"one sentence on whether the start date and the client's priorities look on track, or what puts them at risk",
 "gaps":["important facts missing from JobTread that the team should fill in (max 3)"]}`;
  const res = await anthropic.messages.create({ model: MODEL, max_tokens: 1200, system, messages: [{ role: 'user', content: JSON.stringify(facts) }] });
  const text = (res.content || []).map((c: any) => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const p = JSON.parse(m[0]);
  const clean = (s: any) => String(s || '').replace(/[–—]/g, ',').trim();
  // Safety net: drop any line that is nearly the same as one the team dismissed.
  const dismissed = (team.corrections || []).map((c) => c.target).filter(Boolean);
  const notDismissed = (x: string) => !dismissed.some((d) => sameLine(x, d));
  const arr = (a: any, n: number) => (Array.isArray(a) ? a.map(clean).filter(Boolean).filter(notDismissed).slice(0, n) : []);
  return {
    stand: clean(p.stand), waiting: arr(p.waiting, 3), focus: arr(p.focus, 3), recent: arr(p.recent, 4), goal: clean(p.goal), gaps: arr(p.gaps, 3),
    read: { messages: ctx.comments?.length || 0, logs: ctx.logs?.length || 0, days: ctx.days || 30, corrections: (team.corrections || []).length, context: (team.context || []).length, lastMeeting: !!team.lastMeeting?.notes },
    at: new Date().toISOString(),
  };
}

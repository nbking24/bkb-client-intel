// @ts-nocheck
/**
 * Planning Meeting: Claude's read of each job for the "Project review" box.
 *
 * Built with the Prep Brief (Tuesday cron or Refresh). Claude gets only what we
 * read from JobTread for that job (Job Plan text, gate checklist, open tasks,
 * roadblocks, selections counts, documents, and the last 30 days of job
 * messages and daily logs including daily log custom fields)
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

export async function jobInsight(j: any, ctx: any, planText: string, today: string) {
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
    draftOrPendingDocuments: j.docs.map((d) => `${d.name} (${d.type}, ${d.status}, created ${d.created})`),
    messagesLast30Days: ctx.comments,
    dailyLogsLast30Days: ctx.logs,
  };
  const system = `You prepare one job for Brett King Builder's weekly planning meeting (high-end residential renovation, jobs in design moving toward a build start).
Write a short project review for the room from ONLY the facts given. Never invent dates, numbers, names, prices or decisions. Do not mention money amounts at all.
Plain language, no jargon, no em dashes or en dashes (use commas or periods). Each line under 25 words.
The messages and daily logs (newest first) are the team's, the client's and vendors' own words from the last ${ctx.days || 30} days. Use them to find decisions, open questions, who is waiting on whom and what changed. Newer outweighs older. If a message says something is done or decided that the tasks or gate checklist do not show, say so in "gaps". Daily logs may be meeting summaries or field reports; field reports describe build progress, not design.
Return JSON only:
{"stand":"one or two sentences: where the job actually is in design and how sure we are of the start date",
 "waiting":["what or who we are waiting on, with owner if known (max 4)"],
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
  const arr = (a: any, n: number) => (Array.isArray(a) ? a.map(clean).filter(Boolean).slice(0, n) : []);
  return {
    stand: clean(p.stand), waiting: arr(p.waiting, 4), focus: arr(p.focus, 3), recent: arr(p.recent, 4), goal: clean(p.goal), gaps: arr(p.gaps, 3),
    read: { messages: ctx.comments?.length || 0, logs: ctx.logs?.length || 0, days: ctx.days || 30 },
    at: new Date().toISOString(),
  };
}

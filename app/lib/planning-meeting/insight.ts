// @ts-nocheck
/**
 * Planning Meeting: Claude's read of each job for the "Project review" box.
 *
 * Built with the Prep Brief (Tuesday cron or Refresh). Claude gets only what we
 * read from JobTread for that job (Job Plan text, gate checklist, open tasks,
 * roadblocks, selections counts, documents, recent comments and daily logs)
 * and writes a short review: where the job actually stands, what we are
 * waiting on, what to focus on to keep it moving, and whether the start date
 * and client goals look realistic. It is told to use only the facts given and
 * to name the source, never to invent dates, numbers or prices.
 */
import Anthropic from '@anthropic-ai/sdk';
import { pave } from '@/app/lib/jobtread';

const MODEL = 'claude-sonnet-4-6';
const clip = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) + ' ...' : s || '');

/** Recent comments and daily logs for context. */
export async function fetchJobContext(jobId: string) {
  const d: any = await pave({
    job: {
      $: { id: jobId },
      comments: { $: { size: 8, sortBy: [{ field: ['createdAt'], order: 'desc' }] }, nodes: { createdAt: {}, message: {}, createdByUser: { name: {} } } },
      dailyLogs: { $: { size: 2, sortBy: [{ field: ['date'], order: 'desc' }] }, nodes: { date: {}, notes: {} } },
    },
  });
  return {
    comments: (d?.job?.comments?.nodes || []).map((c) => ({ date: String(c.createdAt || '').slice(0, 10), by: c.createdByUser?.name || '', text: clip(c.message, 700) })),
    logs: (d?.job?.dailyLogs?.nodes || []).map((l) => ({ date: l.date, text: clip(l.notes, 3500) })),
  };
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
    recentComments: ctx.comments,
    recentDailyLogs: ctx.logs,
  };
  const system = `You prepare one job for Brett King Builder's weekly planning meeting (high-end residential renovation, jobs in design moving toward a build start).
Write a short project review for the room from ONLY the facts given. Never invent dates, numbers, names, prices or decisions. Do not mention money amounts at all.
Plain language, no jargon, no em dashes or en dashes (use commas or periods). Each line under 25 words.
Return JSON only:
{"stand":"one or two sentences: where the job actually is in design and how sure we are of the start date",
 "waiting":["what or who we are waiting on, with owner if known (max 4)"],
 "focus":["the 1 to 3 things that would move this job forward most this week"],
 "goal":"one sentence on whether the start date and the client's priorities look on track, or what puts them at risk",
 "gaps":["important facts missing from JobTread that the team should fill in (max 3)"]}`;
  const res = await anthropic.messages.create({ model: MODEL, max_tokens: 900, system, messages: [{ role: 'user', content: JSON.stringify(facts) }] });
  const text = (res.content || []).map((c: any) => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const p = JSON.parse(m[0]);
  const clean = (s: any) => String(s || '').replace(/[–—]/g, ',').trim();
  const arr = (a: any, n: number) => (Array.isArray(a) ? a.map(clean).filter(Boolean).slice(0, n) : []);
  return { stand: clean(p.stand), waiting: arr(p.waiting, 4), focus: arr(p.focus, 3), goal: clean(p.goal), gaps: arr(p.gaps, 3), at: new Date().toISOString() };
}

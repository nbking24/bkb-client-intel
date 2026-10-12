/**
 * Production Meeting (Monday): shared constants.
 *
 * Design agreed with Nathan 2026-10-12 (JobTread Assistant project,
 * claude/BKB-Production-Meeting-Design-2026-10-12.md and the SOP doc section
 * "Weekly production meeting"). Reuses the planning meeting's helpers for
 * dates, group names and task types.
 */
import { addDays, parseDay, fmtDay } from '../planning-meeting/constants';

export const PRODUCTION_STATUS = '6. In Production';
export const PUNCH_STATUS = '6.5 Ongoing / Punch List';
/** Jobs at 6.5 that are not client work and never come to the meeting. */
export const EXCLUDED_JOB_NUMBERS = ['130', '192']; // Admin Project, Evan Project
/** Ongoing service jobs sit at 6.5 too; they come to the meeting only when flagged. */
export const isOngoingJob = (name: string) => /ongoing/i.test(String(name || ''));

/** Flag thresholds (days). Starting points agreed 2026-10-12; change here. */
export const PROD_RULES = {
  behindBaselineDays: 5,   // a milestone finishing this many days after its baseline
  noDailyLogWorkingDays: 5, // working days without a daily log on a job in production
  unsignedChangeOrderDays: 7,
  quietPunchDays: 14,      // punch job with no activity
  agingAskDays: 14,
  lookaheadDays: 42,       // 6 weeks
  crewPlanDays: 14,        // next 2 weeks
};

/** The four questions for a job in production. Keys match state.jobs[jobId].q */
export const PROD_QUESTIONS = [
  { key: 'q1', label: 'Are we on schedule for the next milestone?' },
  { key: 'q2', label: 'What is in the way?' },
  { key: 'q3', label: 'Is everything for the next 6 weeks ready?' },
  { key: 'q4', label: 'Who owes what, by when?' },
];
export const PROD_TRACK_LABELS: Record<string, string> = { on: 'On schedule', risk: 'At risk', off: 'Behind' };

/** Make-ready check for the work entering week 6 (Schroeder, Layer 3). */
export const MAKE_READY = [
  'Selections decided',
  'Material ordered and arriving',
  'Sub confirmed, pre-install booked',
  'Details in hand',
  'Inspections scheduled',
  'Prior trade finishing on time',
  'Client informed',
  'Access and protection ready',
];

/** Closeout steps for a punch list job (from the 9 Sep closeout analysis). */
export const CLOSEOUT_STEPS = [
  'Walkthrough with the client booked',
  'Punch list written (one task per item)',
  'Punch list complete, client confirmed',
  'Final costs in (every bill entered)',
  'Final invoice sent',
  'Final invoice paid',
  'Ready to close the job',
];

const n0 = (n: number) => Math.round(n).toLocaleString('en-US');
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : null);

/** The job's schedule in one sentence: finish against the baseline, and what caused any slip. */
export function scheduleLine(sch: any): string {
  if (!sch) return '';
  const fin = sch.finish ? fmtDay(sch.finish) : '';
  if (sch.slip == null) return fin ? `Finish ${fin} (no baseline set).` : '';
  if (sch.slip <= 0) return `Finish ${fin}, ${sch.slip === 0 ? 'on' : Math.abs(sch.slip) + ' days ahead of'} the baseline${sch.slip === 0 ? '' : ' (' + fmtDay(sch.baselineFinish) + ')'}.`;
  const d = (sch.drivers || [])[0];
  const cause = d ? ` The slip started with ${d.name}, which ${d.done ? 'finished' : 'is running'} ${d.added} day${d.added === 1 ? '' : 's'} late.` : '';
  return `Finish ${fin}, ${sch.slip} day${sch.slip === 1 ? '' : 's'} behind the baseline (${fmtDay(sch.baselineFinish)}).${cause}`;
}

/**
 * The job's numbers at the meeting, one line each (hours and days only, never dollars).
 * Used on the card and in the daily log.
 */
export function numbersLines(j: any): string[] {
  const out: string[] = [];
  const sch = j?.schedule;
  if (sch?.pctComplete != null) out.push(`Complete: ${sch.pctComplete}% (production milestones)`);
  const h = j?.hours;
  if (h) {
    const row = (label: string, x: any) => {
      if (!x || (!x.budget && !x.used)) return;
      const p = pctOf(x.used, x.budget);
      out.push(`${label}: ${n0(x.used)} of ${x.budget ? n0(x.budget) : 'no'} budgeted hours used${p != null ? ` (${p}%)` : ''}`);
    };
    row('Labor hours', h.labor);
    row('Admin hours', h.admin);
  }
  if (sch?.daysAllotted) {
    const p = pctOf(sch.daysUsed, sch.daysAllotted);
    out.push(`Production days: ${sch.daysUsed} of ${sch.daysAllotted} used${p != null ? ` (${p}%)` : ''}, ${sch.daysLeft} left`);
  }
  return out;
}

/** Anything typed or clicked for this job (so a job nobody touched gets no daily log). */
export const hasAnswers = (js: any) =>
  !!js && (Object.values(js.q || {}).some((a: any) => a?.track || String(a?.note || '').trim()) ||
    Object.keys(js.ready || {}).length > 0 || (js.items || []).length > 0 || String(js.notes || '').trim() !== '' ||
    (js.closeout != null && js.closeout !== ''));

/**
 * One job's daily log body, organized like the job card:
 * Schedule, Hours and days, Next 6 weeks, Next closeout step, Notes and decisions.
 * New tasks and task updates are added after this by the write-back.
 */
export function productionNotesText(js: any, job?: any): string {
  if (!hasAnswers(js)) return '';
  const q = js.q || {};
  const parts: string[] = [];
  const a1 = q.q1 || {};
  const sched = [a1.track ? PROD_TRACK_LABELS[a1.track] || '' : '', String(a1.note || '').trim()].filter(Boolean).join('. ');
  const auto = job?.kind === 'production' ? scheduleLine(job?.schedule) : '';
  if (sched || auto) parts.push(['Schedule', sched, auto].filter(Boolean).join('\n'));
  const nums = job?.kind === 'production' ? numbersLines(job) : [];
  if (nums.length) parts.push(['Hours and days at this meeting', ...nums.map((l) => '- ' + l)].join('\n'));
  const a3 = q.q3 || {};
  let ready = '';
  if (js.ready && Object.keys(js.ready).length) {
    const yes = MAKE_READY.filter((_, i) => js.ready[i] === 'yes');
    const no = MAKE_READY.filter((_, i) => js.ready[i] === 'no');
    ready = [yes.length ? `Ready: ${yes.join(', ')}` : '', no.length ? `Not ready: ${no.join(', ')}` : ''].filter(Boolean).join('\n');
  }
  const n3 = String(a3.note || '').trim();
  if (ready || n3) parts.push(['Next 6 weeks', ready, n3].filter(Boolean).join('\n'));
  if (js.closeout != null && js.closeout !== '') parts.push(`Next closeout step\n${CLOSEOUT_STEPS[Number(js.closeout)] || js.closeout}`);
  const other = String(js.notes || '').trim();
  if (other) parts.push(`Notes and decisions\n${other}`);
  return parts.join('\n\n');
}

/** The next Monday on or after `from` (YYYY-MM-DD). */
export function nextMonday(from: string): string {
  const d = parseDay(from);
  const diff = (1 - d.getUTCDay() + 7) % 7;
  return addDays(from, diff);
}

/** Working days (Mon to Fri) from a to b, a exclusive, b inclusive. */
export function workingDaysBetween(a: string, b: string): number {
  let n = 0;
  let d = a;
  for (let i = 0; i < 400 && d < b; i++) {
    d = addDays(d, 1);
    const dow = parseDay(d).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/**
 * The schedule in one place, from a job's production milestones (sorted by start):
 * % complete (the milestone group's progress), production days allotted (baseline
 * start to baseline finish, working days), used and left, the finish against the
 * baseline, and where the slip started. Milestones are chained, so one late
 * milestone pushes every later one by the same days; the first milestone running
 * late is named as where it started.
 */
export function computeSchedule(milestones: any[], pctComplete: number | null, today: string) {
  if (!milestones?.length) return null;
  const minOf = (k: string) => milestones.reduce((d, m) => (m[k] && (!d || m[k] < d) ? m[k] : d), null as string | null);
  const maxOf = (k: string) => milestones.reduce((d, m) => (m[k] && (!d || m[k] > d) ? m[k] : d), null as string | null);
  const start = minOf('start'), finish = maxOf('end');
  const baselineStart = minOf('bStart'), baselineFinish = maxOf('bEnd');
  const planStart = baselineStart || start, planFinish = baselineFinish || finish;
  const daysAllotted = planStart && planFinish ? workingDaysBetween(addDays(planStart, -1), planFinish) : null;
  const daysUsed = start && today >= start ? workingDaysBetween(addDays(start, -1), finish && finish < today ? finish : today) : 0;
  const daysLeft = finish && finish > today ? workingDaysBetween(today, finish) : 0;
  const slip = baselineFinish && finish ? Math.round((parseDay(finish).getTime() - parseDay(baselineFinish).getTime()) / 86400000) : null;
  // where the slip started: the first milestone (in order) running later than its baseline
  const first = milestones.find((m) => m.slip != null && m.slip > 0);
  const drivers = first ? [{ name: first.name, added: first.slip, done: !!first.done, end: first.end, bEnd: first.bEnd }] : [];
  return { pctComplete, start, finish, baselineStart, baselineFinish, slip, daysAllotted, daysUsed, daysLeft, drivers };
}

/**
 * Production Meeting (Monday): shared constants.
 *
 * Design agreed with Nathan 2026-10-12 (JobTread Assistant project,
 * claude/BKB-Production-Meeting-Design-2026-10-12.md and the SOP doc section
 * "Weekly production meeting"). Reuses the planning meeting's helpers for
 * dates, group names and task types.
 */
import { addDays, parseDay } from '../planning-meeting/constants';

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

/** One job's meeting notes as plain text: the four answers, make-ready, closeout step, then other notes. */
export function productionNotesText(js: any): string {
  if (!js) return '';
  const q = js.q || {};
  const parts: string[] = [];
  for (const { key, label } of PROD_QUESTIONS) {
    const a = q[key] || {};
    const track = key === 'q1' && a.track ? PROD_TRACK_LABELS[a.track] || '' : '';
    const note = String(a.note || '').trim();
    let ready = '';
    if (key === 'q3' && js.ready && Object.keys(js.ready).length) {
      const yes = MAKE_READY.filter((_, i) => js.ready[i] === 'yes');
      const no = MAKE_READY.filter((_, i) => js.ready[i] === 'no');
      ready = [yes.length ? `Ready: ${yes.join(', ')}` : '', no.length ? `Not ready: ${no.join(', ')}` : ''].filter(Boolean).join('. ');
    }
    if (track || note || ready) parts.push(`${label}\n${[track, ready, note].filter(Boolean).join('. ')}`);
  }
  if (js.closeout != null && js.closeout !== '') parts.push(`Next closeout step\n${CLOSEOUT_STEPS[Number(js.closeout)] || js.closeout}`);
  const other = String(js.notes || '').trim();
  if (other) parts.push(`Other notes and decisions\n${other}`);
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

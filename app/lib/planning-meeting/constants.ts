/**
 * Planning Meeting: shared constants.
 *
 * Source of truth for the meeting design:
 *   JobTread Assistant project, claude/BKB-Meetings-and-Job-Setup-Game-Plan-2026-10-10.md
 * Gate and marker wording lives on A-TEST PROJECT (100), the master copy.
 */

export const DESIGN_STATUS = '5. Design Phase';

/** Task type created in JobTread on 2026-10-10 for meeting roadblocks (red). */
export const ROADBLOCK_TASK_TYPE_ID = '22Pg3rvKW5tr';
export const ROADBLOCK_TASK_TYPE_NAME = 'Roadblock';

/** Selection Status custom field on cost items. */
export const SELECTION_STATUS_CF_ID = '22P5WiHgkzx9';

/** Group names. Matched loosely (emoji and punctuation stripped). */
export const ACTIVE_GROUP_NAME = '🔵 ACTIVE';
export const ANCHOR_NAME = '➕ Add new items here';

/** Weeks before the production start each gate (2 to 8) is due by default. */
export const GATE_DEFAULT_WEEKS = [20, 16, 14, 12, 8, 4, 1];

/** Flag thresholds (days). */
export const RULES = {
  statusMismatchDays: 30, // production starts within this many days while Status is Design Phase
  agingAskDays: 14,       // Pending task waiting longer than this
  unsignedContractDays: 14,
  quietDays: 14,
  gateDueSoonDays: 14,
  oldDocumentDays: 14,
};

/** Task types that mean "this is done" even if the task is not ticked. */
export const DONE_LIKE_TYPES = ['x.Completed'];

export const SLIP_REASONS = [
  'Waiting on the client',
  'Waiting on engineer or designer',
  'Waiting on a sub or supplier',
  'Too much on one person',
  'Not a real task',
  'Other',
];

/** Strip leading emoji and punctuation so group names match on their words. */
export function normName(s: string | null | undefined): string {
  return String(s || '').replace(/^[^A-Za-z0-9]+/, '').replace(/\*/g, '').trim().toUpperCase();
}
export const isActiveGroup = (n: string) => normName(n) === 'ACTIVE';
export const isFieldGroup = (n: string) => normName(n).startsWith('FIELD TASKS');
export const isCompletedGroup = (n: string) => normName(n) === 'COMPLETED';
export const isGatesGroup = (n: string) => normName(n).includes('PROJECT GATES');
export const isPlanTodo = (n: string) => normName(n).startsWith('JOB PLAN');
export const isMilestonesGroup = (n: string) => normName(n).includes('PLANNING MILESTONES');
export const isProductionGroup = (n: string) => normName(n).includes('PRODUCTION MILESTONES');
export const isOldGatesGroup = (n: string) => normName(n).includes('OLD DESIGN PHASE GATES');

/* ---------------- dates (all YYYY-MM-DD strings, treated as UTC days) ---------------- */

export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function parseDay(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function addDays(s: string, n: number): string {
  const d = parseDay(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toDay(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
}
/** Today's date in Eastern time. */
export function todayEastern(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
/** The next Tuesday on or after `from` (YYYY-MM-DD). */
export function nextTuesday(from: string): string {
  const d = parseDay(from);
  const diff = (2 - d.getUTCDay() + 7) % 7;
  return addDays(from, diff);
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "13 Oct", "4 Jan 2027", optionally "Tue 13 Oct". */
export function fmtDay(s: string | null | undefined, withDow = false, thisYear?: number): string {
  if (!s) return '';
  const d = parseDay(s);
  const y = thisYear ?? new Date().getUTCFullYear();
  return (withDow ? DOW[d.getUTCDay()] + ' ' : '') + d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + (d.getUTCFullYear() !== y ? ' ' + d.getUTCFullYear() : '');
}

/** "Sasu - Master Suite" #119 -> "Sasu 119" */
export function shortJobName(name: string, number?: string | number | null): string {
  const first = String(name || '').split(/\s+-\s+|\s+/)[0].replace(/[^A-Za-z'-]/g, '') || String(name || '');
  return number ? `${first} ${number}` : first;
}

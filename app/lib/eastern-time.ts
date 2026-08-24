/**
 * Eastern-time helpers for the meeting-transcript pipeline.
 *
 * Plaud (via the Zapier "Create Time" field) sends the recording time as the
 * recorder's LOCAL wall-clock time but formats it like UTC, e.g.
 * "2026-08-21T09:31:48Z" for a 9:31 AM Eastern meeting. Node on Vercel runs in
 * UTC, so `new Date(...)` on that string lands 4-5 hours early. Everything the
 * Hub does with a recording time (display, daily-log date, PML event date)
 * should go through these helpers so the whole pipeline agrees on Eastern.
 */

export const BKB_TZ = 'America/New_York';

/** Minutes east of UTC for `BKB_TZ` at the given instant (EDT = -240, EST = -300). */
function tzOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BKB_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * Interpret a timestamp whose clock digits are Eastern wall-clock time
 * (regardless of a trailing "Z" or missing zone) and return a real UTC ISO
 * string. Strings that carry an explicit non-Z offset (e.g. "-04:00") are
 * trusted as-is. Returns null when the input cannot be parsed.
 */
export function easternWallClockToIso(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const [, y, mo, d, h, mi, sec, zone] = m;
  if (zone && zone.toUpperCase() !== 'Z') {
    const d2 = new Date(s);
    return isNaN(d2.getTime()) ? null : d2.toISOString();
  }
  // Treat the digits as Eastern. Two passes handle the DST edge correctly.
  const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(sec || 0));
  let guess = naive - tzOffsetMinutes(new Date(naive)) * 60000;
  guess = naive - tzOffsetMinutes(new Date(guess)) * 60000;
  return new Date(guess).toISOString();
}

/** YYYY-MM-DD for the given instant in Eastern time (for JobTread daily-log dates). */
export function easternDateString(iso: string | Date | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: BKB_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "Aug 21, 2026" in Eastern time. */
export function formatEasternDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { timeZone: BKB_TZ, year: 'numeric', month: 'short', day: 'numeric' }); } catch { return String(iso); }
}

/** "Aug 21, 2026, 9:31 AM ET" in Eastern time. */
export function formatEasternDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', { timeZone: BKB_TZ, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
  } catch { return String(iso); }
}

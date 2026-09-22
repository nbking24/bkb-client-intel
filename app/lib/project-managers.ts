/**
 * BKB project-manager roster — the single place the Hub agrees on who the
 * PMs are and what color each one owns.
 *
 * The assignment itself lives in JobTread, on the job's "Project Manager"
 * option custom field (id 22P5TA732Mu9). This file only maps that field's
 * option values to a short label and a stable color, so the Production
 * Schedule (and anything else that wants to) can color by PM instead of by
 * job and roll workload up per person.
 *
 * Adding a PM: add the option in JobTread first (Settings > Custom Fields >
 * Project Manager), then add the matching row here. `value` MUST match the
 * JobTread option string exactly.
 *
 * Colors are deliberately far apart in hue and all dark enough for white
 * text on a Gantt bar. UNASSIGNED is a neutral grey so an unset job reads
 * as "needs a PM" rather than as somebody's work.
 */

export type ProjectManager = {
  /** Stable key used in URLs, localStorage and API payloads. */
  key: string;
  /** Exact JobTread "Project Manager" custom-field option value. */
  value: string;
  /** Short name for chips and legends. */
  label: string;
  /** Bar / chip color. Dark enough for white text. */
  color: string;
};

export const JT_PROJECT_MANAGER_FIELD_ID = '22P5TA732Mu9';

export const PROJECT_MANAGERS: ProjectManager[] = [
  { key: 'evan',  value: 'Evan Harrington', label: 'Evan',  color: '#1d4ed8' }, // blue
  { key: 'brett', value: 'Brett King',      label: 'Brett', color: '#68050a' }, // BKB maroon
  { key: 'josh',  value: 'Joshua Hodnett',  label: 'Josh',  color: '#047857' }, // green
  { key: 'nate',  value: 'Nathan King',     label: 'Nate',  color: '#b45309' }, // amber/brown
];

/** Pseudo-PM for jobs with no Project Manager set in JobTread. */
export const UNASSIGNED_PM: ProjectManager = {
  key: 'unassigned',
  value: '',
  label: 'Unassigned',
  color: '#8a8078',
};

/** Roster plus the unassigned bucket, in display order. */
export const PM_LANES: ProjectManager[] = [...PROJECT_MANAGERS, UNASSIGNED_PM];

/**
 * Resolve a raw JobTread custom-field value to a roster entry.
 * Matches on the exact option value first, then on a case-insensitive
 * first-name prefix so a hand-typed "Evan" or a renamed option still lands
 * on the right person instead of falling into Unassigned.
 */
export function resolvePm(raw: string | null | undefined): ProjectManager {
  const s = (raw || '').trim();
  if (!s) return UNASSIGNED_PM;
  const exact = PROJECT_MANAGERS.find((p) => p.value.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const lower = s.toLowerCase();
  const loose = PROJECT_MANAGERS.find(
    (p) => lower.startsWith(p.label.toLowerCase()) || p.value.toLowerCase().startsWith(lower),
  );
  return loose || UNASSIGNED_PM;
}

/** Roster entry for a key ('evan', 'unassigned', …). */
export function pmByKey(key: string | null | undefined): ProjectManager {
  return PM_LANES.find((p) => p.key === key) || UNASSIGNED_PM;
}

/** True when `value` is a legal JobTread option (or the clear-it empty string). */
export function isValidPmValue(value: string): boolean {
  return value === '' || PROJECT_MANAGERS.some((p) => p.value === value);
}

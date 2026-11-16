// @ts-nocheck
/**
 * Marketing pipeline, Step 1: FTP inventory and reorg plan. READ ONLY.
 *
 * Walks the marketing root on Mike's FTP, matches every job folder to its
 * JobTread job, reads the job's Status, and works out what the one time
 * reorganization (Step 2) would do:
 *   - rename the folder to "<Last>-<Job Name> (<Status label>)"
 *   - move loose files at the folder root into Photos/, Videos/ or
 *     Plans & Renderings/ (the profile .docx stays at the root)
 *   - create any missing subfolders
 *
 * Nothing on the FTP is changed here. Step 2 applies an approved plan.
 *
 * Style note: no em or en dashes in this file.
 */
import { listRootTree, rootName } from '@/app/api/lib/ftp';
import { getAllJobs, getJobStatuses, folderNameForJob } from '@/app/api/lib/jobtread';
import { getFolderOverrides } from '@/app/api/lib/marketing/folder-overrides';

export const SUBFOLDERS = ['Photos', 'Plans & Renderings', 'Videos'] as const;

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'gif', 'webp', 'tif', 'tiff', 'bmp']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'avi', 'wmv', 'mkv', 'webm', '3gp', 'mts']);
const PLAN_EXT = new Set(['pdf']);
const PROFILE_EXT = new Set(['docx', 'doc']);

/** An image whose name says it is a rendering or a drawing, not a site photo. */
const RENDERING_RE = /render|enscape|revit|concept|design vision|\(rendering\)|floor ?plan|site ?plan|plan set|sketch|drawing/i;

/**
 * Status label for the folder name. Returns null when the Status value is not
 * covered by the agreed mapping, so the plan flags it instead of guessing.
 *   5 and earlier, and 10. Ready: In Design
 *   6. In Production: In Progress
 *   6.5 Ongoing / Punch List (finished, in punch list), 7. Final Billing,
 *   11. Closed, or a closed job: Completed
 *   8. Lost: excluded, the folder is left out of the reorg entirely
 * Anything else (or no Status) is flagged for Nathan.
 */
export function isLostStatus(status: string | null): boolean {
  return /^8\./.test((status || '').trim());
}

export function statusLabel(status: string | null, closedOn: string | null): { label: string | null; note?: string } {
  const s = (status || '').trim();
  if (isLostStatus(s)) return { label: null, note: 'Lost job, left out of the reorg' };
  if (closedOn) return { label: 'Completed' };
  if (!s) return { label: null, note: 'No Status set in JobTread' };
  const m = s.match(/^(\d+(?:\.\d+)?)/);
  const n = m ? parseFloat(m[1]) : NaN;
  if (n === 10) return { label: 'In Design' };
  if (n <= 5) return { label: 'In Design' };
  if (n === 6) return { label: 'In Progress' };
  if (n === 6.5 || n === 7 || n === 11) return { label: 'Completed' };
  return { label: null, note: 'Status "' + s + '" is not in the agreed mapping' };
}

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[‐-―_\/\\-]+/g, ' ')
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip a trailing "(...)" status suffix from a folder name. */
function baseOfFolder(folder: string): { base: string; suffix: string | null } {
  const m = folder.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (m) return { base: m[1], suffix: m[2] };
  return { base: folder, suffix: null };
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter(Boolean));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  const union = new Set([...a, ...b]).size;
  return union ? hit / union : 0;
}

type Job = { id: string; name: string; number: string; closedOn: string | null };

/**
 * Match a folder to a job.
 *   exact:     folder base equals the job name once punctuation is ignored
 *   likely:    same last name, best word overlap on the rest, clear winner
 *   ambiguous: several jobs fit about equally well
 *   none:      no job with that last name
 */
function matchFolder(folder: string, jobs: Job[]) {
  const { base } = baseOfFolder(folder);
  const nb = norm(base);

  const exact = jobs.filter((j) => norm(j.name) === nb || norm(folderNameForJob(j.name)) === nb);
  if (exact.length === 1) return { confidence: 'exact', job: exact[0], candidates: [] };
  if (exact.length > 1) {
    const open = exact.filter((j) => !j.closedOn);
    if (open.length === 1) return { confidence: 'exact', job: open[0], candidates: exact };
    return { confidence: 'ambiguous', job: null, candidates: exact };
  }

  const last = nb.split(' ')[0] || '';
  if (!last) return { confidence: 'none', job: null, candidates: [] };
  const sameLast = jobs.filter((j) => norm(j.name).split(' ')[0] === last);
  if (sameLast.length === 0) return { confidence: 'none', job: null, candidates: [] };

  const rest = tokens(nb.split(' ').slice(1).join(' '));
  const scored = sameLast
    .map((j) => ({ j, score: overlap(rest, tokens(norm(j.name).split(' ').slice(1).join(' '))) }))
    .sort((a, b) => b.score - a.score || (a.j.closedOn ? 1 : 0) - (b.j.closedOn ? 1 : 0));

  if (scored.length === 1 && (scored[0].score > 0 || rest.size === 0)) {
    return { confidence: 'likely', job: scored[0].j, candidates: [] };
  }
  if (scored[0].score > 0 && scored[0].score > (scored[1]?.score ?? -1)) {
    return { confidence: 'likely', job: scored[0].j, candidates: scored.slice(1, 4).map((x) => x.j) };
  }
  return { confidence: 'ambiguous', job: null, candidates: scored.slice(0, 6).map((x) => x.j) };
}

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export async function buildReorgPlan() {
  const [tree, jobs, overrides] = await Promise.all([listRootTree(), getAllJobs(), getFolderOverrides()]);
  const folderNames = Object.keys(tree.folders).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  // A folder marked "no JobTread job, keep name" skips the job match.
  const matches = folderNames.map((f) =>
    overrides[f]?.mode === 'no_job_keep_name'
      ? { folder: f, confidence: 'manual', job: null, candidates: [] }
      : { folder: f, ...matchFolder(f, jobs) }
  );
  const statuses = await getJobStatuses(matches.filter((m) => m.job).map((m) => m.job.id));

  const folders = matches.map((m) => {
    const listing = tree.folders[m.folder];
    const entries = listing.entries || [];
    const existingDirs = entries.filter((e) => e.isDir).map((e) => e.name);
    const lowerDirs = new Set(existingDirs.map((d) => d.toLowerCase()));
    const missingSubfolders: string[] = SUBFOLDERS.filter((s) => !lowerDirs.has(s.toLowerCase()));
    const otherSubfolders = existingDirs.filter(
      (d) => !SUBFOLDERS.some((s) => s.toLowerCase() === d.toLowerCase())
    );

    const moves: { file: string; size: number; to: string; why?: string }[] = [];
    const profileFiles: string[] = [];
    const leftInPlace: { file: string; size: number }[] = [];
    for (const e of entries) {
      if (e.isDir) continue;
      const x = ext(e.name);
      if (IMAGE_EXT.has(x) && RENDERING_RE.test(e.name)) moves.push({ file: e.name, size: e.size, to: 'Plans & Renderings', why: 'rendering' });
      else if (IMAGE_EXT.has(x)) moves.push({ file: e.name, size: e.size, to: 'Photos' });
      else if (VIDEO_EXT.has(x)) moves.push({ file: e.name, size: e.size, to: 'Videos' });
      else if (PLAN_EXT.has(x)) moves.push({ file: e.name, size: e.size, to: 'Plans & Renderings' });
      else if (PROFILE_EXT.has(x) && /profile/i.test(e.name)) profileFiles.push(e.name);
      else leftInPlace.push({ file: e.name, size: e.size });
    }

    let currentStatus = null;
    let label = null;
    let statusNote = undefined;
    let targetName = null;
    const override = overrides[m.folder] || null;
    if (override) {
      // No JobTread job: keep the name exactly, skip the status check.
      label = override.label || null;
      targetName = m.folder;
      statusNote = 'No JobTread job, name kept';
    }
    if (m.job) {
      const st = statuses[m.job.id] || { status: null, closedOn: m.job.closedOn };
      currentStatus = st.status;
      const r = statusLabel(st.status, st.closedOn ?? m.job.closedOn);
      label = r.label;
      statusNote = r.note;
      if (label) targetName = folderNameForJob(m.job.name) + ' (' + label + ')';
    }

    const excluded = isLostStatus(currentStatus);
    if (excluded) {
      moves.length = 0;
      leftInPlace.length = 0;
      missingSubfolders.length = 0;
    }

    return {
      folder: m.folder,
      excluded,
      keepName: !!override,
      override,
      confidence: m.confidence,
      job: m.job
        ? { id: m.job.id, name: m.job.name, number: m.job.number, closed: !!m.job.closedOn }
        : null,
      candidates: (m.candidates || []).map((j) => ({ id: j.id, name: j.name, number: j.number, closed: !!j.closedOn })),
      jobStatus: currentStatus,
      statusLabel: label,
      statusNote,
      targetName,
      rename: !!targetName && targetName !== m.folder,
      moves,
      profileFiles,
      leftInPlace,
      missingSubfolders,
      otherSubfolders,
      listError: listing.error || null,
    };
  });

  // Two folders that would end up with the same name.
  const byTarget: Record<string, string[]> = {};
  for (const f of folders) if (f.targetName) (byTarget[f.targetName] ||= []).push(f.folder);
  const collisions = Object.entries(byTarget)
    .filter(([, list]) => list.length > 1)
    .map(([target, list]) => ({ target, folders: list }));

  const looseRootFiles = tree.root.filter((e) => !e.isDir).map((e) => ({ file: e.name, size: e.size }));

  return {
    root: rootName(),
    generatedAt: new Date().toISOString(),
    summary: {
      folders: folders.length,
      matched: folders.filter((f) => f.job).length,
      keptNoJob: folders.filter((f) => f.keepName).length,
      unmatched: folders.filter((f) => !f.job && !f.keepName).length,
      renames: folders.filter((f) => f.rename).length,
      filesToMove: folders.reduce((n, f) => n + f.moves.length, 0),
      foldersMissingSubfolders: folders.filter((f) => f.missingSubfolders.length > 0).length,
      statusNeedsDecision: folders.filter((f) => f.job && !f.statusLabel && !f.excluded).length,
      filesToDecide: folders.reduce((n, f) => n + f.leftInPlace.length, 0),
      lostExcluded: folders.filter((f) => f.excluded).length,
      collisions: collisions.length,
    },
    folders,
    unmatched: folders.filter((f) => !f.job && !f.keepName).map((f) => ({ folder: f.folder, confidence: f.confidence, candidates: f.candidates })),
    collisions,
    looseRootFiles,
    filesToDecide: folders.flatMap((f) => f.leftInPlace.map((x) => ({ folder: f.folder, ...x }))),
  };
}

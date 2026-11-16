// @ts-nocheck
/**
 * Marketing pipeline, Step 3: copy new photos, videos and plans for one job
 * from JobTread to Mike's FTP.
 *
 * For one flagged job:
 *   1. Make sure the job's folder exists under its current name
 *      "<Last>-<Job Name> (<Status>)", renaming it when the JobTread Status
 *      changed, and that Photos/, Plans & Renderings/ and Videos/ exist.
 *   2. List the job's JobTread files created since the last processed time
 *      (all files on a job's first full scan) and drop any file already in
 *      the asset ledger (sent or excluded before).
 *   3. Sort each file into: send, exclude for good, or wait (a photo the
 *      labeler has not labeled yet; it is looked at again next run).
 *   4. Unless dryRun, stream each original from JobTread into the right
 *      subfolder (never overwriting) and record every sent or excluded file
 *      in marketing_photo_assets as it happens.
 *
 * Stops starting new uploads near the time limit and reports done: false;
 * the next call picks up where it left off because sent files are in the
 * ledger.
 *
 * Style note: no em or en dashes in this file.
 */
import { Readable } from 'stream';
import { getSupabase } from '@/app/api/lib/supabase';
import { pave } from '@/app/lib/jobtread';
import { folderNameForJob, JOB_STATUS_FIELD_ID } from '@/app/api/lib/jobtread';
import { applyFolderReorg, listPath, listNames, uploadStreamNoOverwrite } from '@/app/api/lib/ftp';
import { statusLabel, isLostStatus, SUBFOLDERS } from '@/app/api/lib/marketing/ftp-plan';
import { recordFolderRename } from '@/app/api/lib/marketing/ftp-reorg';
import { videoDurationSeconds } from '@/app/api/lib/marketing/video-duration';

// JobTread file tag ids (organization file tags).
export const TAG = {
  preConstruction: '22P5SRxXqzTW',
  projectStart: '22P5YhhQb4ti',
  roughIn: '22P5xMGwU3dh',
  inProgress: '22P5SRxXqzTR',
  finish: '22P5SRxXqzTY',
  plans: '22P5SRxXqzTV', // Documents/Plans
  design: '22P5y8nnYb6A', // Design
  receipts: '22PAweRnnMyj',
  vendor: '22P5SRxXqzSZ', // X. Vendor
  selections: '22P5YiHfFx45',
  bids: '22P5umiEzzdZ', // Bids-Pricing
  permits: '22P5SRxXqzTS',
};

const MIN_VIDEO_SECONDS = 3;
const ASSUMED_BYTES_PER_SECOND = 4 * 1024 * 1024; // for the time budget only

const LABELED_NAME_RE = /^(.+?) - (.+) - (\d{4}-\d{2}-\d{2})$/;

type JTFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  description: string | null;
  document: { id: string; type: string } | null;
  tags: { id: string; name: string }[];
};

export type Decision =
  | { action: 'send'; file: JTFile; sub: string; kind: string; ftpName: string }
  | { action: 'exclude'; file: JTFile; kind: string; reason: string }
  | { action: 'wait'; file: JTFile; reason: string };

// ---------------------------------------------------------------- naming

function stemAndExt(name: string, mime: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && name.length - dot <= 6) return { stem: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
  const fromMime = (mime || '').split('/')[1] || 'bin';
  const map: Record<string, string> = { jpeg: 'jpg', quicktime: 'mov', 'x-m4v': 'm4v', pdf: 'pdf' };
  return { stem: name, ext: map[fromMime] || fromMime.replace(/[^a-z0-9]/g, '') || 'bin' };
}

/** Make a string safe for an FTP file name: no path characters, no dashes other than plain hyphens. */
export function cleanPart(s: string): string {
  return (s || '')
    .replace(/[‐-―]/g, ' ')
    .replace(/[\/\\:*?"<>|\0]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** "What it shows" from a labeled name, or else a short phrase from the description. */
/**
 * Default names that cameras, phones and the JobTread app give a file. Any
 * other name was typed by a person on upload and counts as a label
 * (Nathan, 2026-11-16).
 */
const DEFAULT_NAME_RES = [
  /^(img|img_e|dsc|dscn|dscf|pxl|mvimg|vid|pano|gopr|dji|mov|hpim|sam|cimg|dcim)[\s_-]*[\w-]*$/i,
  /^photo(\s*\(?\d+\)?)?$/i,
  /^image(\s*\(?\d+\)?)?$/i,
  /^video(\s*\(?\d+\)?)?$/i,
  /^annotation[\s_-]/i,
  /^screen ?shot/i,
  /^untitled/i,
  /^p\d{6,}$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[\d\s_.-]+$/,
];

export function isDefaultName(stem: string): boolean {
  const s = (stem || '').trim();
  return !s || DEFAULT_NAME_RES.some((re) => re.test(s));
}

export function whatItShows(f: JTFile): string | null {
  const { stem } = stemAndExt(f.name, f.type);
  const m = stem.match(LABELED_NAME_RE);
  if (m) return cleanPart(m[2]);
  if (!isDefaultName(stem)) return cleanPart(stem);
  if (f.description) {
    const first = f.description.split(/[.;]/)[0];
    const short = first.split(/[,:(]/)[0];
    const words = short.trim().split(/\s+/).slice(0, 8).join(' ');
    if (words) return cleanPart(words.charAt(0).toUpperCase() + words.slice(1));
  }
  return null;
}

function isLabeled(f: JTFile): boolean {
  const { stem } = stemAndExt(f.name, f.type);
  return LABELED_NAME_RE.test(stem) || !isDefaultName(stem) || !!(f.description && f.description.trim());
}

export function isHeic(f: { type?: string; name?: string }): boolean {
  return /image\/hei[cf]/i.test(f.type || '') || /\.hei[cf]$/i.test(f.name || '');
}

/** Full resolution, high quality JPEG from a HEIC original. Nothing is resized. */
async function heicToJpeg(input: Buffer): Promise<Buffer> {
  const convert = (await import('heic-convert')).default;
  const out = await convert({ buffer: input, format: 'JPEG', quality: 0.92 });
  return Buffer.from(out);
}

function hasTag(f: JTFile, id: string) {
  return f.tags.some((t) => t.id === id);
}

function photoKind(f: JTFile): string {
  if (hasTag(f, TAG.preConstruction)) return 'Before';
  if (hasTag(f, TAG.finish)) return 'Finished';
  return 'Progress';
}

// ---------------------------------------------------------------- sorting

export function decide(f: JTFile, jobName: string): Decision {
  const mime = (f.type || '').toLowerCase();
  const { stem, ext } = stemAndExt(f.name, f.type);
  const job = cleanPart(jobName);

  if (f.document) return { action: 'exclude', file: f, kind: 'document', reason: 'attached to a ' + (f.document.type || 'document') };
  if (hasTag(f, TAG.receipts)) return { action: 'exclude', file: f, kind: 'receipt', reason: 'receipt' };
  if (hasTag(f, TAG.selections)) return { action: 'exclude', file: f, kind: 'selection', reason: 'selection reference' };
  if (hasTag(f, TAG.bids)) return { action: 'exclude', file: f, kind: 'document', reason: 'bid or pricing' };
  if (hasTag(f, TAG.permits)) return { action: 'exclude', file: f, kind: 'document', reason: 'permit' };
  if (f.tags.length > 0 && f.tags.every((t) => t.id === TAG.vendor)) {
    return { action: 'exclude', file: f, kind: 'document', reason: 'tagged X. Vendor only' };
  }

  const isPlan = hasTag(f, TAG.plans);
  const isDesign = hasTag(f, TAG.design);

  if (mime === 'application/pdf') {
    if (isPlan || isDesign) {
      return { action: 'send', file: f, sub: 'Plans & Renderings', kind: 'plan', ftpName: job + ' - ' + cleanPart(stem) + '.pdf' };
    }
    return { action: 'exclude', file: f, kind: 'document', reason: 'PDF not tagged Documents/Plans or Design' };
  }

  if (mime.startsWith('image/')) {
    // HEIC is the one conversion: sent as a full size JPEG so Mike's site can show it.
    const outExt = isHeic(f) ? 'jpg' : ext;
    if (/screen ?shot/i.test(f.name)) return { action: 'exclude', file: f, kind: 'other', reason: 'screenshot' };
    if (isDesign) {
      const what = whatItShows(f) || cleanPart(stem);
      return { action: 'send', file: f, sub: 'Plans & Renderings', kind: 'rendering', ftpName: job + ' - ' + what + ' (Rendering).' + outExt };
    }
    if (isPlan) {
      const what = whatItShows(f) || cleanPart(stem);
      return { action: 'send', file: f, sub: 'Plans & Renderings', kind: 'plan', ftpName: job + ' - ' + what + '.' + outExt };
    }
    if (!isLabeled(f)) return { action: 'wait', file: f, reason: 'not labeled yet' };
    const kind = photoKind(f);
    return { action: 'send', file: f, sub: 'Photos', kind: kind.toLowerCase(), ftpName: job + ' - ' + whatItShows(f) + ' (' + kind + ').' + outExt };
  }

  if (mime.startsWith('video/')) {
    const date = (f.createdAt || '').slice(0, 10);
    const what = whatItShows(f) || 'Site Video ' + date;
    if (isDesign) {
      return { action: 'send', file: f, sub: 'Videos', kind: 'design-video', ftpName: job + ' - ' + what + ' (Rendering).' + ext };
    }
    return { action: 'send', file: f, sub: 'Videos', kind: 'video', ftpName: job + ' - ' + what + '.' + ext };
  }

  return { action: 'exclude', file: f, kind: 'other', reason: 'not a photo, video or plan (' + (mime || 'unknown type') + ')' };
}

/** Same name stem and same size counts as a near duplicate; the earliest upload is kept. */
export function markNearDuplicates(decisions: Decision[]): Decision[] {
  const seen = new Map<string, string>();
  const sorted = [...decisions].sort((a, b) => (a.file.createdAt || '').localeCompare(b.file.createdAt || ''));
  const dupIds = new Set<string>();
  for (const d of sorted) {
    if (d.action === 'exclude') continue;
    const key = stemAndExt(d.file.name, d.file.type).stem.toLowerCase().replace(/\s+\d+$/, '') + '|' + d.file.size;
    if (seen.has(key)) dupIds.add(d.file.id);
    else seen.set(key, d.file.id);
  }
  return decisions.map((d) =>
    dupIds.has(d.file.id)
      ? { action: 'exclude', file: d.file, kind: d.action === 'send' ? d.kind : 'progress', reason: 'near duplicate of ' + seen.get(stemAndExt(d.file.name, d.file.type).stem.toLowerCase().replace(/\s+\d+$/, '') + '|' + d.file.size) }
      : d
  );
}

// ---------------------------------------------------------------- JobTread

async function loadJob(jobId: string) {
  const data: any = await pave({
    job: {
      $: { id: jobId },
      id: {},
      name: {},
      number: {},
      closedOn: {},
      statusVal: {
        _: 'customFieldValues',
        $: { where: [['customField', 'id'], JOB_STATUS_FIELD_ID], size: 1 },
        nodes: { value: {} },
      },
    },
  });
  const j = data?.job;
  if (!j?.id) throw new Error('JobTread job ' + jobId + ' not found');
  return { id: j.id, name: j.name, number: j.number, closedOn: j.closedOn ?? null, status: j.statusVal?.nodes?.[0]?.value ?? null };
}

async function listJobFiles(jobId: string, sinceISO: string | null): Promise<JTFile[]> {
  const out: JTFile[] = [];
  let page: string | undefined;
  for (let i = 0; i < 50; i++) {
    const data: any = await pave({
      job: {
        $: { id: jobId },
        files: {
          $: {
            size: 100,
            ...(sinceISO ? { where: ['createdAt', '>', sinceISO] } : {}),
            sortBy: [{ field: 'createdAt', order: 'asc' }],
            ...(page ? { page } : {}),
          },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            type: {},
            size: {},
            createdAt: {},
            description: {},
            document: { id: {}, type: {} },
            fileTags: { nodes: { id: {}, name: {} } },
          },
        },
      },
    });
    const files = data?.job?.files;
    for (const n of files?.nodes || []) {
      out.push({
        id: n.id,
        name: n.name || '',
        type: n.type || '',
        size: n.size || 0,
        createdAt: n.createdAt,
        description: n.description ?? null,
        document: n.document?.id ? n.document : null,
        tags: n.fileTags?.nodes || [],
      });
    }
    page = files?.nextPage || undefined;
    if (!page) break;
  }
  return out;
}

/** A fresh download URL for the original file (JobTread URLs are short lived). */
async function originalUrl(fileId: string): Promise<string> {
  const data: any = await pave({ file: { $: { id: fileId }, url: {} } });
  const url = data?.file?.url;
  if (!url) throw new Error('No download URL for file ' + fileId);
  return url;
}

// ---------------------------------------------------------------- folder

/**
 * Work out the job's folder on the FTP and what has to happen to it.
 * Returns the actions (rename, create subfolders) and the folder name to use
 * once they are done.
 */
async function planFolder(job, savedFolder: string | null) {
  if (isLostStatus(job.status)) return { skip: 'Lost job' };
  const { label, note } = statusLabel(job.status, job.closedOn);
  if (!label) return { skip: note || 'Status not in the agreed mapping' };

  const base = folderNameForJob(job.name);
  const target = base + ' (' + label + ')';
  const root = (await listPath('')).filter((e) => e.isDir).map((e) => e.name);
  const stripSuffix = (n: string) => n.replace(/\s*\([^()]*\)\s*$/, '');

  let current = savedFolder && root.includes(savedFolder) ? savedFolder : null;
  if (!current) current = root.find((n) => n === target) || root.find((n) => stripSuffix(n).toLowerCase() === base.toLowerCase()) || null;

  const actions = [];
  if (!current) {
    for (const sub of SUBFOLDERS) actions.push({ type: 'mkdir', folder: target, sub });
    return { current: null, target, actions, isNew: true };
  }
  const subs = new Set((await listNames(current)).map((n) => n.toLowerCase()));
  for (const sub of SUBFOLDERS) if (!subs.has(sub.toLowerCase())) actions.push({ type: 'mkdir', folder: current, sub });
  if (current !== target) actions.push({ type: 'rename', folder: current, to: target });
  return { current, target, actions, isNew: false };
}

// ---------------------------------------------------------------- main

export async function runCopyStep(opts: { jobId: string; dryRun: boolean; deadlineMs?: number }) {
  const started = Date.now();
  const supabase = getSupabase();

  const { data: sel } = await supabase
    .from('marketing_photo_selected_jobs')
    .select('job_id, folder_name, included, needs_processing, scan_mode, last_processed_at')
    .eq('job_id', opts.jobId)
    .maybeSingle();
  if (!sel) throw new Error('That job is not selected for the photo engine');

  const job = await loadJob(opts.jobId);
  const folder = await planFolder(job, sel.folder_name);
  if (folder.skip) {
    return { job, dryRun: opts.dryRun, skipped: folder.skip, done: true, send: [], exclude: [], wait: [] };
  }

  const since = sel.scan_mode === 'full' ? null : sel.last_processed_at || null;
  const files = await listJobFiles(opts.jobId, since);

  // Anything already in the ledger (sent or excluded) is never looked at again.
  // Older rows may lack job_id, so also match by folder name.
  const known = new Set<string>();
  const byJob = await supabase.from('marketing_photo_assets').select('jobtread_file_id').eq('job_id', opts.jobId);
  for (const r of byJob.data || []) if (r.jobtread_file_id) known.add(r.jobtread_file_id);
  if (folder.current) {
    const byFolder = await supabase.from('marketing_photo_assets').select('jobtread_file_id').eq('folder_name', folder.current);
    for (const r of byFolder.data || []) if (r.jobtread_file_id) known.add(r.jobtread_file_id);
  }
  const fresh = files.filter((f) => !known.has(f.id));

  let decisions = markNearDuplicates(fresh.map((f) => decide(f, job.name)));

  // Videos shorter than a few seconds are dropped. Only checked for videos we
  // would otherwise send, and only when not out of time.
  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    if (d.action !== 'send' || !(d.file.type || '').startsWith('video/')) continue;
    const secs = await videoDurationSeconds(await originalUrl(d.file.id));
    (d as any).seconds = secs;
    if (secs != null && secs < MIN_VIDEO_SECONDS) {
      decisions[i] = { action: 'exclude', file: d.file, kind: 'video', reason: 'clip is ' + secs.toFixed(1) + ' seconds' };
    }
  }

  const summary = (d: Decision) => ({
    id: d.file.id,
    name: d.file.name,
    size: d.file.size,
    createdAt: d.file.createdAt,
    tags: d.file.tags.map((t) => t.name),
    ...(d.action === 'send' ? { to: d.sub, kind: d.kind, ftpName: d.ftpName, seconds: (d as any).seconds ?? null } : {}),
    ...(d.action !== 'send' ? { reason: d.reason } : {}),
  });

  const sends = decisions.filter((d) => d.action === 'send');
  const excludes = decisions.filter((d) => d.action === 'exclude');
  const waits = decisions.filter((d) => d.action === 'wait');

  const base = {
    job: { id: job.id, name: job.name, number: job.number, status: job.status },
    dryRun: opts.dryRun,
    scan: since ? 'new since ' + since : 'full (first build)',
    folder: { current: folder.current, target: folder.target, isNew: folder.isNew, actions: folder.actions },
    counts: { filesSeen: files.length, alreadyHandled: files.length - fresh.length, send: sends.length, exclude: excludes.length, wait: waits.length },
    earliestWaiting: waits.length ? waits.map((d) => d.file.createdAt).sort()[0] : null,
  };

  if (opts.dryRun) {
    // Show the exact final names: a name already in the subfolder (or picked
    // earlier in this batch) gets " 2", " 3" and so on, as the real upload does.
    const taken: Record<string, Set<string>> = {};
    const preview = [];
    for (const d of sends) {
      if (!taken[d.sub]) {
        taken[d.sub] = new Set(folder.current ? (await listNames(folder.current, d.sub)).map((n) => n.toLowerCase()) : []);
      }
      const dot = d.ftpName.lastIndexOf('.');
      const stem = dot > 0 ? d.ftpName.slice(0, dot) : d.ftpName;
      const ext = dot > 0 ? d.ftpName.slice(dot) : '';
      let name = d.ftpName;
      for (let n = 2; taken[d.sub].has(name.toLowerCase()); n++) name = stem + ' ' + n + ext;
      taken[d.sub].add(name.toLowerCase());
      preview.push({ ...summary(d), ftpName: name, renamedBecauseTaken: name !== d.ftpName });
    }
    return { ...base, done: true, send: preview, exclude: excludes.map(summary), wait: waits.map(summary) };
  }

  // ---- real run
  // 1. Folder: create or rename, then subfolders.
  let folderName = folder.current || folder.target;
  if (folder.actions.length) {
    const results = [];
    await applyFolderReorg(folder.actions, async (a, r) => { results.push({ a, r }); });
    const renamed = results.find((x) => x.a.type === 'rename');
    if (renamed) {
      if (!renamed.r.ok || renamed.r.skipped) throw new Error('Could not rename the folder to ' + folder.target + ': ' + (renamed.r.skipped || renamed.r.error));
      await recordFolderRename(folder.current, folder.target);
    }
    folderName = folder.target;
    await supabase.from('marketing_photo_selected_jobs').update({ folder_name: folderName, updated_at: new Date().toISOString() }).eq('job_id', job.id);
  }

  // 2. Exclusions are recorded straight away so they are never reconsidered.
  for (const d of excludes) {
    await supabase.from('marketing_photo_assets').insert({
      job_id: job.id,
      folder_name: folderName,
      ftp_filename: d.file.name + ' [' + d.file.id + ']',
      jobtread_file_id: d.file.id,
      kind: d.kind,
      excluded: true,
      excluded_at: new Date().toISOString(),
    });
  }

  // 3. Uploads, one at a time, each recorded the moment it lands.
  const reserved = new Set<string>();
  const sent = [];
  const failed = [];
  let outOfTime = false;
  for (const d of sends) {
    const budget = 20000 + (d.file.size / ASSUMED_BYTES_PER_SECOND) * 1000;
    if (opts.deadlineMs && Date.now() - started + budget > opts.deadlineMs) {
      outOfTime = true;
      break;
    }
    try {
      const res = await fetch(await originalUrl(d.file.id), { cache: 'no-store' });
      if (!res.ok || !res.body) throw new Error('JobTread download failed (' + res.status + ')');
      const stream = isHeic(d.file)
        ? Readable.from(await heicToJpeg(Buffer.from(await res.arrayBuffer())))
        : Readable.fromWeb(res.body as any);
      const finalName = await uploadStreamNoOverwrite({
        folder: folderName,
        sub: d.sub,
        fileName: d.ftpName,
        key: d.file.id,
        stream,
        reserved,
      });
      await supabase.from('marketing_photo_assets').insert({
        job_id: job.id,
        folder_name: folderName,
        ftp_filename: finalName,
        jobtread_file_id: d.file.id,
        kind: d.kind,
        excluded: false,
      });
      sent.push({ ...summary(d), ftpName: finalName });
    } catch (err: any) {
      failed.push({ ...summary(d), error: err?.message || 'upload failed' });
    }
  }

  const sentIds = new Set(sent.map((s) => s.id));
  const failedIds = new Set(failed.map((s) => s.id));
  return {
    ...base,
    folderName,
    done: !outOfTime,
    send: sends.map((d) => ({ ...summary(d), status: sentIds.has(d.file.id) ? 'sent' : failedIds.has(d.file.id) ? 'failed' : 'not yet' })),
    sent,
    failed,
    exclude: excludes.map(summary),
    wait: waits.map(summary),
  };
}

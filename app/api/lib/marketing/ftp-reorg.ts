// @ts-nocheck
/**
 * Marketing pipeline, Step 2: one time reorganization of Mike's FTP.
 *
 * Builds the same plan as Step 1 from the live FTP, turns each folder's plan
 * into an ordered action list (create subfolders, move files, rename the
 * folder last) and, unless dryRun, applies it. Never deletes anything.
 *
 * Folders that are skipped entirely:
 *   - Lost jobs
 *   - folders with no matched job and no "keep name" mark
 *   - folders whose Status is not in the agreed mapping
 *
 * Every real action is logged to marketing_photo_runs (trigger "ftp-reorg"),
 * one row per folder, updated after every step.
 *
 * Style note: no em or en dashes in this file.
 */
import { getSupabase } from '@/app/api/lib/supabase';
import { applyFolderReorg, ReorgAction } from '@/app/api/lib/ftp';
import { buildReorgPlan } from '@/app/api/lib/marketing/ftp-plan';

export const REORG_TRIGGER = 'ftp-reorg';

function actionsFor(f: any): { actions: ReorgAction[]; skipReason: string | null } {
  if (f.excluded) return { actions: [], skipReason: 'Lost job, left out' };
  if (!f.job && !f.keepName) return { actions: [], skipReason: 'No JobTread job matched and not marked keep name' };
  if (!f.keepName && !f.targetName) return { actions: [], skipReason: f.statusNote || 'Status needs a decision' };
  if (f.listError) return { actions: [], skipReason: 'Could not read the folder: ' + f.listError };

  const actions: ReorgAction[] = [];
  for (const sub of f.missingSubfolders) actions.push({ type: 'mkdir', folder: f.folder, sub });
  for (const m of f.moves) actions.push({ type: 'move', folder: f.folder, file: m.file, to: m.to });
  if (!f.keepName && f.rename && f.targetName) actions.push({ type: 'rename', folder: f.folder, to: f.targetName });
  return { actions, skipReason: null };
}

function describe(a: ReorgAction): string {
  if (a.type === 'mkdir') return 'Create ' + a.folder + '/' + a.sub + '/';
  if (a.type === 'move') return 'Move ' + a.folder + '/' + a.file + ' to ' + a.folder + '/' + a.to + '/' + a.file;
  return 'Rename folder ' + a.folder + ' to ' + a.to;
}

/**
 * Pick folders by exact current folder name, by JobTread job id, or all.
 * Returns the dry run or applied result per folder.
 */
export async function runReorg(opts: {
  folder?: string;
  jobId?: string;
  all?: boolean;
  dryRun: boolean;
  userId?: string | null;
  deadlineMs?: number;
}) {
  const started = Date.now();
  const plan = await buildReorgPlan();

  let targets = plan.folders;
  if (opts.folder) targets = targets.filter((f) => f.folder === opts.folder);
  else if (opts.jobId) targets = targets.filter((f) => f.job?.id === opts.jobId);
  else if (!opts.all) throw new Error('Pick a folder, a job, or all');
  if (targets.length === 0) throw new Error('No folder on the FTP matches that request');

  const supabase = getSupabase();
  const results = [];
  let stoppedEarly = false;

  for (const f of targets) {
    const { actions, skipReason } = actionsFor(f);
    const base = {
      folder: f.folder,
      job: f.job,
      keepName: f.keepName,
      newName: f.keepName ? f.folder : f.targetName,
    };

    if (skipReason) {
      results.push({ ...base, skipped: skipReason, actions: [] });
      continue;
    }
    if (opts.dryRun || actions.length === 0) {
      results.push({
        ...base,
        actions: actions.map((a) => ({ ...a, text: describe(a), status: opts.dryRun ? 'would do' : 'nothing to do' })),
      });
      continue;
    }
    if (opts.deadlineMs && Date.now() - started > opts.deadlineMs) {
      stoppedEarly = true;
      results.push({ ...base, skipped: 'Not started, out of time for this run. Run again to continue.', actions: [] });
      continue;
    }

    // Real run: open a log row first, then update it after every step.
    const log = [];
    const { data: row } = await supabase
      .from('marketing_photo_runs')
      .insert({
        job_id: f.job?.id || 'no-job',
        job_number: f.job?.number || null,
        job_name: f.job?.name || null,
        folder_name: f.folder,
        trigger: REORG_TRIGGER,
        status: 'processing',
        email_status: 'skipped',
        change_summary: JSON.stringify({ kind: REORG_TRIGGER, by: opts.userId || null, actions: [] }),
      })
      .select('id')
      .single();
    const runId = row?.id;

    let error = null;
    try {
      await applyFolderReorg(actions, async (a, r) => {
        log.push({ ...a, text: describe(a), status: r.error ? 'error' : r.skipped ? 'skipped' : 'done', note: r.skipped || r.error || null, at: new Date().toISOString() });
        if (runId) {
          await supabase
            .from('marketing_photo_runs')
            .update({ change_summary: JSON.stringify({ kind: REORG_TRIGGER, by: opts.userId || null, actions: log }) })
            .eq('id', runId);
        }
      });
    } catch (err: any) {
      error = err?.message || 'FTP error';
    }

    if (runId) {
      await supabase
        .from('marketing_photo_runs')
        .update({
          status: error ? 'error' : 'complete',
          error,
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId);
    }
    results.push({ ...base, runId, error, actions: log });
  }

  const flat = results.flatMap((r) => r.actions);
  return {
    dryRun: opts.dryRun,
    generatedAt: new Date().toISOString(),
    stoppedEarly,
    summary: {
      folders: results.length,
      skipped: results.filter((r) => r.skipped).length,
      creates: flat.filter((a) => a.type === 'mkdir').length,
      moves: flat.filter((a) => a.type === 'move').length,
      renames: flat.filter((a) => a.type === 'rename').length,
      done: flat.filter((a) => a.status === 'done').length,
      problems: flat.filter((a) => a.status === 'skipped' || a.status === 'error').length,
    },
    results,
  };
}

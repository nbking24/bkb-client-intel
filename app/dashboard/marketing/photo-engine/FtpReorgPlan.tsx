// @ts-nocheck
'use client';

/**
 * Marketing pipeline Step 1 panel: runs the read only FTP reorg plan and shows
 * it as a table for Nathan to review. Nothing on the FTP changes from here.
 *
 * Style note: no em or en dashes in this file.
 */
import { Fragment, useState } from 'react';
import { Loader2, ClipboardList, AlertTriangle, ChevronDown, ChevronRight, Download } from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

const CONF: Record<string, { label: string; cls: string }> = {
  exact: { label: 'Exact', cls: 'bg-green-100 text-green-700' },
  likely: { label: 'Likely', cls: 'bg-amber-100 text-amber-800' },
  ambiguous: { label: 'Unclear', cls: 'bg-red-100 text-red-700' },
  none: { label: 'No match', cls: 'bg-red-100 text-red-700' },
  manual: { label: 'No JobTread job', cls: 'bg-gray-200 text-gray-700' },
};

export default function FtpReorgPlan() {
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [marking, setMarking] = useState<string | null>(null);
  const [reorg, setReorg] = useState<any>(null);
  const [reorgBusy, setReorgBusy] = useState<string | null>(null);

  // Step 2. dryRun is true unless the caller says otherwise; a real run asks first.
  async function callReorg(target: { folder?: string; all?: boolean }, dryRun: boolean) {
    const token = getToken();
    if (!token) return;
    const what = target.all ? 'EVERY folder' : '"' + target.folder + '"';
    if (!dryRun && !window.confirm('Run the reorg for real on ' + what + '?\n\nThis creates subfolders, moves files and renames the folder on Mike\'s FTP. Nothing is deleted.')) return;
    const key = (target.all ? '*all*' : target.folder) + (dryRun ? ':dry' : ':real');
    setReorgBusy(key);
    setError(null);
    try {
      const r = await fetch('/api/marketing/photo-engine/ftp/reorg', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...target, dryRun }),
      });
      const data = await r.json().catch(() => ({ error: 'The server returned an unreadable response (status ' + r.status + ').' }));
      if (data.error) setError(data.error);
      else {
        setReorg({ ...data, target: target.all ? 'All folders' : target.folder });
        if (!dryRun) await run();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReorgBusy(null);
    }
  }

  async function run() {
    const token = getToken();
    if (!token) { setError('Sign in again, then retry.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/marketing/photo-engine/ftp/plan', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await r.json().catch(() => ({ error: 'The server returned an unreadable response (status ' + r.status + ').' }));
      if (r.status === 401 || r.status === 403) setError('Only the owner can run the plan.');
      else if (data.error) setError(data.error);
      else setPlan(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function markKeepName(folder: string, keep: boolean) {
    const token = getToken();
    if (!token) return;
    let label = null;
    if (keep) {
      const answer = window.prompt(
        'Mark "' + folder + '" as having no JobTread job. Its name will never change.\n\nStatus to show for it (In Design, In Progress or Completed):',
        'Completed'
      );
      if (answer === null) return;
      label = answer.trim() || null;
    }
    setMarking(folder);
    setError(null);
    try {
      const r = await fetch('/api/marketing/photo-engine/ftp/folder-override', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, keepName: keep, label }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.error) setError(data.error || 'Could not save the change.');
      else await run();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMarking(null);
    }
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ftp-reorg-plan-' + (plan.generatedAt || '').slice(0, 10) + '.json';
    a.click();
  }

  const s = plan?.summary;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-blue-700" />
          Folder reorganization plan
          <span className="text-xs font-normal text-gray-400">Building the plan and dry runs change nothing on the FTP</span>
        </h3>
        <div className="flex items-center gap-2">
          {plan && (
            <button onClick={downloadJson} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">
              <Download className="w-3.5 h-3.5" /> Download
            </button>
          )}
          <button
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />}
            {busy ? 'Reading the FTP...' : plan ? 'Run again' : 'Build reorg plan'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-red-700 text-sm mb-2">{error}</div>}

      {!plan && !error && (
        <div className="bg-white border border-dashed border-gray-300 rounded-lg p-4 text-sm text-gray-500">
          Reads every job folder in {'"'}BKB Review{'"'}, matches it to its JobTread job and Status, and shows the
          renames, file moves and missing subfolders the one time cleanup would make. It can take a minute.
        </div>
      )}

      {plan && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Stat label="Folders" value={s.folders} />
            <Stat label="Matched" value={s.matched} />
            <Stat label="Not matched" value={s.unmatched} warn={s.unmatched > 0} />
            {s.keptNoJob > 0 && <Stat label="No JobTread job, name kept" value={s.keptNoJob} />}
            <Stat label="Renames" value={s.renames} />
            <Stat label="Files to move" value={s.filesToMove} />
            <Stat label="Need subfolders" value={s.foldersMissingSubfolders} />
            <Stat label="Status needs a decision" value={s.statusNeedsDecision} warn={s.statusNeedsDecision > 0} />
            {s.filesToDecide > 0 && <Stat label="Files for you to decide" value={s.filesToDecide} warn />}
            {s.lostExcluded > 0 && <Stat label="Lost jobs left out" value={s.lostExcluded} />}
            {s.collisions > 0 && <Stat label="Name clashes" value={s.collisions} warn />}
          </div>

          {plan.collisions?.length > 0 && (
            <Warn>
              {plan.collisions.map((c) => (
                <div key={c.target}>These folders would all become {'"'}{c.target}{'"'}: {c.folders.join(', ')}</div>
              ))}
            </Warn>
          )}

          {plan.looseRootFiles?.length > 0 && (
            <Warn>
              Files sitting directly in {plan.root} (not in a job folder), left alone: {plan.looseRootFiles.map((f) => f.file).join(', ')}
            </Warn>
          )}

          {plan.filesToDecide?.length > 0 && (
            <Warn>
              <div className="font-medium">Left at the folder root for you to decide:</div>
              <ul className="ml-4 list-disc">
                {plan.filesToDecide.map((x) => <li key={x.folder + '/' + x.file}>{x.folder} / {x.file} <span className="text-amber-700">({x.reason})</span></li>)}
              </ul>
            </Warn>
          )}

          {reorg && <ReorgResult result={reorg} onClose={() => setReorg(null)} />}

          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => callReorg({ all: true }, true)}
              disabled={!!reorgBusy}
              className="px-2.5 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              {reorgBusy === '*all*:dry' ? 'Working...' : 'Dry run all folders'}
            </button>
            <button
              onClick={() => callReorg({ all: true }, false)}
              disabled={!!reorgBusy}
              className="px-2.5 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {reorgBusy === '*all*:real' ? 'Working...' : 'Run reorg on all folders'}
            </button>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 text-left">
                <tr>
                  <th className="px-3 py-2 w-6"></th>
                  <th className="px-3 py-2">Folder now</th>
                  <th className="px-3 py-2">JobTread job</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">New folder name</th>
                  <th className="px-3 py-2 text-right">Files to move</th>
                  <th className="px-3 py-2">Subfolders to add</th>
                  <th className="px-3 py-2">Reorg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plan.folders.map((f) => {
                  const c = CONF[f.confidence] || CONF.none;
                  const isOpen = !!open[f.folder];
                  const hasDetail = true; // every row has at least the keep name button
                  return (
                    <Fragment key={f.folder}>
                      <tr className={`align-top ${f.excluded ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-2">
                          {hasDetail ? (
                            <button title="Details"  onClick={() => setOpen({ ...open, [f.folder]: !isOpen })} className="text-gray-400 hover:text-gray-700">
                              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-900">{f.folder}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium mr-1.5 ${c.cls}`}>{c.label}</span>
                          {f.keepName ? (
                            <span className="text-gray-500">None, name kept</span>
                          ) : f.job ? (
                            <span className="text-gray-700">{f.job.name}{f.job.number ? ' #' + f.job.number : ''}{f.job.closed ? ' (closed)' : ''}</span>
                          ) : (
                            <span className="text-gray-400">None</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {f.keepName ? (f.statusLabel || '') : f.job ? (f.jobStatus || (f.job.closed ? 'Closed' : 'Not set')) : ''}
                          {f.statusNote && <div className={`text-xs mt-0.5 ${f.excluded ? "text-gray-500" : "text-red-600"}`}>{f.statusNote}</div>}
                        </td>
                        <td className="px-3 py-2">
                          {f.excluded ? (
                            <span className="text-gray-400">Left out (Lost)</span>
                          ) : f.keepName ? (
                            <span className="text-gray-400">No change (name kept)</span>
                          ) : f.targetName ? (
                            f.rename ? <span className="text-blue-800">{f.targetName}</span> : <span className="text-gray-400">No change</span>
                          ) : (
                            <span className="text-gray-400">Needs review</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{f.moves.length || ''}</td>
                        <td className="px-3 py-2 text-gray-600 text-xs">{f.missingSubfolders.join(', ')}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">
                          {!f.excluded && (f.job || f.keepName) && (f.moves.length || f.missingSubfolders.length || f.rename) ? (
                            <>
                              <button
                                onClick={() => callReorg({ folder: f.folder }, true)}
                                disabled={!!reorgBusy}
                                className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 mr-1"
                              >
                                {reorgBusy === f.folder + ':dry' ? '...' : 'Dry run'}
                              </button>
                              <button
                                onClick={() => callReorg({ folder: f.folder }, false)}
                                disabled={!!reorgBusy}
                                className="px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                              >
                                {reorgBusy === f.folder + ':real' ? '...' : 'Run'}
                              </button>
                            </>
                          ) : (
                            <span className="text-gray-400">Nothing to do</span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50/60">
                          <td></td>
                          <td colSpan={7} className="px-3 py-2 text-xs text-gray-600 space-y-1.5">
                            <div>
                              {f.keepName ? (
                                <button onClick={() => markKeepName(f.folder, false)} disabled={marking === f.folder} className="px-2 py-1 rounded border border-gray-300 hover:bg-white disabled:opacity-50">
                                  {marking === f.folder ? 'Saving...' : 'Undo: match this folder to a JobTread job again'}
                                </button>
                              ) : (
                                <button onClick={() => markKeepName(f.folder, true)} disabled={marking === f.folder} className="px-2 py-1 rounded border border-gray-300 hover:bg-white disabled:opacity-50">
                                  {marking === f.folder ? 'Saving...' : 'No JobTread job, keep this name'}
                                </button>
                              )}
                            </div>
                            {f.listError && <div className="text-red-600">Could not read this folder: {f.listError}</div>}
                            {f.candidates.length > 0 && (
                              <div><span className="font-medium">{f.job ? 'Other possible jobs' : 'Possible jobs'}:</span> {f.candidates.map((j) => j.name + (j.number ? ' #' + j.number : '') + (j.closed ? ' (closed)' : '')).join('; ')}</div>
                            )}
                            {f.profileFiles.length > 0 && <div><span className="font-medium">Stays at folder root:</span> {f.profileFiles.join(', ')}</div>}
                            {f.moves.length > 0 && (
                              <div>
                                <span className="font-medium">Moves:</span>
                                <ul className="mt-0.5 ml-4 list-disc">
                                  {f.moves.map((m) => <li key={m.file}>{m.file} <span className="text-gray-400">to {m.to}/{m.why === 'rendering' ? ' (name looks like a rendering)' : ''}</span></li>)}
                                </ul>
                              </div>
                            )}
                            {f.leftInPlace.length > 0 && <div><span className="font-medium">Other files left where they are:</span> {f.leftInPlace.map((x) => x.file).join(', ')}</div>}
                            {f.clashes?.length > 0 && <div className="text-amber-800"><span className="font-medium">Not moved, same name already in the subfolder:</span> {f.clashes.map((x) => x.file + ' (' + x.to + '/)').join(', ')}</div>}
                            {f.otherSubfolders.length > 0 && <div><span className="font-medium">Other subfolders already there, left alone:</span> {f.otherSubfolders.join(', ')}</div>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-gray-400">Plan built {new Date(plan.generatedAt).toLocaleString()}.</div>
        </div>
      )}
    </div>
  );
}

const ACTION_STYLE: Record<string, string> = {
  'would do': 'text-gray-700',
  done: 'text-green-700',
  skipped: 'text-amber-700',
  error: 'text-red-700',
  'nothing to do': 'text-gray-400',
};

function ReorgResult({ result, onClose }: { result: any; onClose: () => void }) {
  const s = result.summary;
  const icon = (t: string) => (t === 'mkdir' ? 'Create' : t === 'move' ? 'Move' : 'Rename');
  return (
    <div className={`rounded-lg border p-3 text-xs ${result.dryRun ? 'border-blue-200 bg-blue-50/50' : 'border-green-300 bg-green-50/50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-900">
            {result.dryRun ? 'Dry run, nothing was changed' : 'Reorg applied'}: {result.target}
          </div>
          <div className="text-gray-600 mt-0.5">
            {s.creates} subfolders to create, {s.moves} files to move, {s.renames} folder renames
            {!result.dryRun && <>; {s.done} done, {s.problems} skipped or failed</>}
            {s.skipped > 0 && <>; {s.skipped} folders left out</>}
          </div>
          {result.stoppedEarly && <div className="text-amber-800 mt-1">Ran out of time before every folder was done. Run it again to continue; finished folders show nothing to do.</div>}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700">Close</button>
      </div>
      <div className="mt-2 space-y-2 max-h-96 overflow-y-auto">
        {result.results.map((r) => (
          <div key={r.folder} className="bg-white rounded border border-gray-200 p-2">
            <div className="font-medium text-gray-900">
              {r.folder}
              {r.newName && r.newName !== r.folder && <span className="text-blue-800"> {'->'} {r.newName}</span>}
            </div>
            {r.skipped && <div className="text-gray-500">Left out: {r.skipped}</div>}
            {r.error && <div className="text-red-700">Stopped on an error: {r.error}. Nothing after this step was done; run it again to retry.</div>}
            {r.actions.length > 0 && (
              <table className="mt-1 w-full">
                <tbody>
                  {r.actions.map((a, i) => (
                    <tr key={i} className="align-top">
                      <td className="pr-2 text-gray-400 w-14">{icon(a.type)}</td>
                      <td className={`pr-2 ${ACTION_STYLE[a.status] || ''}`}>
                        {a.type === 'mkdir' && <>{a.sub}/</>}
                        {a.type === 'move' && <>{a.file} <span className="text-gray-400">{'->'}</span> {a.to}/</>}
                        {a.type === 'rename' && <>Folder {'->'} {a.to}</>}
                        {a.note && <span className="text-gray-500"> ({a.note})</span>}
                      </td>
                      <td className={`text-right whitespace-nowrap ${ACTION_STYLE[a.status] || ''}`}>{a.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!r.skipped && r.actions.length === 0 && <div className="text-gray-400">Nothing to do</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`px-2.5 py-1.5 rounded-md border ${warn ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-700'}`}>
      <span className="font-semibold tabular-nums">{value}</span> {label}
    </div>
  );
}

function Warn({ children }: { children: any }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex gap-2">
      <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-600" />
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

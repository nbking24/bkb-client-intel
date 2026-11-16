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
};

export default function FtpReorgPlan() {
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

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
          <span className="text-xs font-normal text-gray-400">Read only, nothing on the FTP changes</span>
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
            <Stat label="Renames" value={s.renames} />
            <Stat label="Files to move" value={s.filesToMove} />
            <Stat label="Need subfolders" value={s.foldersMissingSubfolders} />
            <Stat label="Status needs a decision" value={s.statusNeedsDecision} warn={s.statusNeedsDecision > 0} />
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plan.folders.map((f) => {
                  const c = CONF[f.confidence] || CONF.none;
                  const isOpen = !!open[f.folder];
                  const hasDetail = f.moves.length || f.leftInPlace.length || f.otherSubfolders.length || f.candidates.length || f.profileFiles.length || f.listError;
                  return (
                    <Fragment key={f.folder}>
                      <tr className={`align-top ${f.excluded ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-2">
                          {hasDetail ? (
                            <button onClick={() => setOpen({ ...open, [f.folder]: !isOpen })} className="text-gray-400 hover:text-gray-700">
                              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-900">{f.folder}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium mr-1.5 ${c.cls}`}>{c.label}</span>
                          {f.job ? (
                            <span className="text-gray-700">{f.job.name}{f.job.number ? ' #' + f.job.number : ''}{f.job.closed ? ' (closed)' : ''}</span>
                          ) : (
                            <span className="text-gray-400">None</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {f.job ? (f.jobStatus || (f.job.closed ? 'Closed' : 'Not set')) : ''}
                          {f.statusNote && <div className={`text-xs mt-0.5 ${f.excluded ? "text-gray-500" : "text-red-600"}`}>{f.statusNote}</div>}
                        </td>
                        <td className="px-3 py-2">
                          {f.excluded ? (
                            <span className="text-gray-400">Left out (Lost)</span>
                          ) : f.targetName ? (
                            f.rename ? <span className="text-blue-800">{f.targetName}</span> : <span className="text-gray-400">No change</span>
                          ) : (
                            <span className="text-gray-400">Needs review</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{f.moves.length || ''}</td>
                        <td className="px-3 py-2 text-gray-600 text-xs">{f.missingSubfolders.join(', ')}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50/60">
                          <td></td>
                          <td colSpan={6} className="px-3 py-2 text-xs text-gray-600 space-y-1.5">
                            {f.listError && <div className="text-red-600">Could not read this folder: {f.listError}</div>}
                            {f.candidates.length > 0 && (
                              <div><span className="font-medium">{f.job ? 'Other possible jobs' : 'Possible jobs'}:</span> {f.candidates.map((j) => j.name + (j.number ? ' #' + j.number : '') + (j.closed ? ' (closed)' : '')).join('; ')}</div>
                            )}
                            {f.profileFiles.length > 0 && <div><span className="font-medium">Stays at folder root:</span> {f.profileFiles.join(', ')}</div>}
                            {f.moves.length > 0 && (
                              <div>
                                <span className="font-medium">Moves:</span>
                                <ul className="mt-0.5 ml-4 list-disc">
                                  {f.moves.map((m) => <li key={m.file}>{m.file} <span className="text-gray-400">to {m.to}/</span></li>)}
                                </ul>
                              </div>
                            )}
                            {f.leftInPlace.length > 0 && <div><span className="font-medium">Other files left where they are:</span> {f.leftInPlace.map((x) => x.file).join(', ')}</div>}
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

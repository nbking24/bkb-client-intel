// @ts-nocheck
'use client';

/**
 * Marketing pipeline Step 3 panel: preview or run the copy of new photos,
 * videos and plans from JobTread to Mike's FTP, one job at a time.
 *
 * Style note: no em or en dashes in this file.
 */
import { useState } from 'react';
import { Loader2, Send, RefreshCw } from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

function fmtBytes(n: number) {
  if (!n) return '';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export default function CopyStepPanel() {
  const [jobs, setJobs] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);

  // Step 4: build the profile. Preview emails it to Nathan; publish replaces it on the FTP.
  async function runProfile(job: any, mode: 'preview' | 'publish') {
    const token = getToken();
    if (!token) return;
    if (mode === 'publish' && !window.confirm('Publish the rebuilt profile for ' + job.job_name + ' to Mike\'s FTP?\n\nThe current profile is backed up first. Preview it before publishing.')) return;
    setBusy(job.job_id + ':' + mode);
    setError(null);
    try {
      const r = await fetch('/api/marketing/photo-engine/profile', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.job_id, mode }),
      });
      const data = await r.json().catch(() => ({ error: 'Unreadable response (status ' + r.status + ')' }));
      if (data.error) setError(data.error);
      else setProfile(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function loadJobs() {
    const token = getToken();
    if (!token) return;
    setBusy('load');
    setError(null);
    try {
      const r = await fetch('/api/marketing/photo-engine/copy', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await r.json().catch(() => ({ error: 'Unreadable response (status ' + r.status + ')' }));
      if (data.error) setError(data.error);
      else setJobs(data.jobs || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function run(job: any, dryRun: boolean) {
    const token = getToken();
    if (!token) return;
    if (!dryRun && !window.confirm('Copy the new files for ' + job.job_name + ' to Mike\'s FTP now?\n\nNothing on the FTP is replaced or deleted. Run the preview first.')) return;
    setBusy(job.job_id + (dryRun ? ':dry' : ':real'));
    setError(null);
    try {
      const r = await fetch('/api/marketing/photo-engine/copy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.job_id, dryRun }),
      });
      const data = await r.json().catch(() => ({ error: 'Unreadable response (status ' + r.status + ')' }));
      if (data.error) setError(data.error);
      else setResult({ ...data, jobRow: job });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Send className="w-4 h-4 text-blue-700" />
          Copy new files to Mike
          <span className="text-xs font-normal text-gray-400">Preview changes nothing; Copy uploads originals, never replaces</span>
        </h3>
        <button
          onClick={loadJobs}
          disabled={busy === 'load'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === 'load' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {jobs ? 'Refresh jobs' : 'Show jobs'}
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-red-700 text-sm mb-2">{error}</div>}

      {jobs && (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
          {jobs.length === 0 && <div className="p-3 text-gray-500">No jobs are selected for the engine.</div>}
          {jobs.map((j) => (
            <div key={j.job_id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">{j.job_name}</div>
                <div className="text-xs text-gray-400 truncate">
                  {j.needs_processing ? <span className="text-amber-700 font-medium">Flagged ({j.scan_mode || 'delta'})</span> : 'Nothing flagged'}
                  {j.last_processed_at && <> . last processed {new Date(j.last_processed_at).toLocaleDateString()}</>}
                  {j.folder_name && <> . {j.folder_name}</>}
                </div>
              </div>
              <div className="flex-shrink-0 text-xs">
                <button onClick={() => run(j, true)} disabled={!!busy} className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 mr-1">
                  {busy === j.job_id + ':dry' ? 'Checking...' : 'Preview'}
                </button>
                <button onClick={() => run(j, false)} disabled={!!busy} className="px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 mr-3">
                  {busy === j.job_id + ':real' ? 'Copying...' : 'Copy'}
                </button>
                <button onClick={() => runProfile(j, 'preview')} disabled={!!busy} title="Build the profile and email it to Nathan. Nothing goes to the FTP." className="px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 mr-1">
                  {busy === j.job_id + ':preview' ? 'Building (1 to 3 min)...' : 'Profile preview'}
                </button>
                <button onClick={() => runProfile(j, 'publish')} disabled={!!busy} className="px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50">
                  {busy === j.job_id + ':publish' ? 'Publishing...' : 'Publish'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {profile && (
        <div className={`mt-3 rounded-lg border p-3 text-xs ${profile.mode === 'preview' ? 'border-blue-200 bg-blue-50/50' : 'border-green-300 bg-green-50/50'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5 text-gray-700">
              <div className="text-sm font-semibold text-gray-900">
                {profile.mode === 'preview' ? 'Profile preview' : profile.published ? 'Profile published' : 'Profile not published'}: {profile.job}
              </div>
              <div>{profile.fileName} . {Math.round(profile.bytes / 1024)} KB</div>
              {profile.notes?.map((n) => <div key={n}>{n}</div>)}
              {profile.whatsNew && <div>What's new: {profile.whatsNew.text}</div>}
              <div>New photos {profile.newPhotos}, renderings {profile.newRenderings}, videos {profile.newVideos}, plans {profile.newPlans}{profile.newChangeOrders?.length ? ', change orders ' + profile.newChangeOrders.join(', ') : ''}.</div>
              {profile.rulesFixed > 0 && <div className="text-amber-800">Writing rule fixes: {profile.rulesFixed}{profile.rulesScrubbed ? ' (' + profile.rulesScrubbed + ' hard scrubbed, worth a look)' : ''}</div>}
              {profile.mode === 'preview' && <div>{profile.emailed ? 'Emailed to Nathan.' : 'Email failed: ' + profile.emailError}{profile.downloadUrl && <> <a className="underline text-blue-700" href={profile.downloadUrl}>Download the .docx</a></>}</div>}
              {profile.reason && <div>{profile.reason}</div>}
            </div>
            <button onClick={() => setProfile(null)} className="text-gray-400 hover:text-gray-700">Close</button>
          </div>
        </div>
      )}

      {result && <CopyResult r={result} onClose={() => setResult(null)} onContinue={() => run(result.jobRow, false)} busy={!!busy} />}
    </div>
  );
}

function CopyResult({ r, onClose, onContinue, busy }) {
  const f = r.folder || {};
  return (
    <div className={`mt-3 rounded-lg border p-3 text-xs ${r.dryRun ? 'border-blue-200 bg-blue-50/50' : 'border-green-300 bg-green-50/50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-900">
            {r.dryRun ? 'Preview, nothing was changed' : 'Copy run'}: {r.job?.name}
          </div>
          {r.skipped ? (
            <div className="text-gray-600 mt-0.5">Skipped: {r.skipped}</div>
          ) : (
            <div className="text-gray-600 mt-0.5 space-y-0.5">
              <div>Looked at {r.scan}. {r.counts.filesSeen} files, {r.counts.alreadyHandled} already handled before.</div>
              <div>
                Folder: {f.isNew ? <>new folder <b>{f.target}</b></> : f.current}
                {!f.isNew && f.current !== f.target && <> . renamed to <b>{f.target}</b></>}
                {f.actions?.filter((a) => a.type === 'mkdir').length > 0 && <> . adds {f.actions.filter((a) => a.type === 'mkdir').map((a) => a.sub + '/').join(', ')}</>}
              </div>
            </div>
          )}
          {!r.dryRun && !r.done && (
            <div className="mt-1 text-amber-800">
              Stopped near the time limit. <button onClick={onContinue} disabled={busy} className="underline font-medium">Continue copying</button>
            </div>
          )}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700">Close</button>
      </div>

      {!r.skipped && (
        <div className="mt-2 space-y-2 max-h-[28rem] overflow-y-auto">
          <Section title={(r.dryRun ? 'Would send' : 'Send') + ' (' + r.send.length + ')'}>
            {r.send.map((s) => (
              <Row key={s.id} left={s.to + '/'} main={s.ftpName} sub={s.name + ' . ' + fmtBytes(s.size) + (s.seconds != null ? ' . ' + Math.round(s.seconds) + 's' : '') + (s.renamedBecauseTaken ? ' . name was taken, number added' : '')} right={s.status || ''} />
            ))}
          </Section>
          {r.failed?.length > 0 && (
            <Section title={'Failed (' + r.failed.length + '), will retry next run'}>
              {r.failed.map((s) => <Row key={s.id} left="" main={s.name} sub={s.error} right="failed" />)}
            </Section>
          )}
          <Section title={'Waiting for labels (' + r.wait.length + '), checked again next run'}>
            {r.wait.map((s) => <Row key={s.id} left="" main={s.name} sub={new Date(s.createdAt).toLocaleDateString() + ' . ' + fmtBytes(s.size)} right="" />)}
          </Section>
          <Section title={(r.dryRun ? 'Would exclude for good' : 'Excluded for good') + ' (' + r.exclude.length + ')'}>
            {r.exclude.map((s) => <Row key={s.id} left="" main={s.name} sub={s.reason} right="" />)}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded border border-gray-200 p-2">
      <div className="font-medium text-gray-900 mb-1">{title}</div>
      <div className="divide-y divide-gray-50">{children}</div>
    </div>
  );
}

function Row({ left, main, sub, right }) {
  return (
    <div className="flex items-start gap-2 py-1">
      {left && <div className="text-gray-400 w-32 flex-shrink-0 truncate">{left}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-gray-800 break-words">{main}</div>
        {sub && <div className="text-gray-400 break-words">{sub}</div>}
      </div>
      {right && <div className={`flex-shrink-0 ${right === 'sent' ? 'text-green-700' : right === 'failed' ? 'text-red-700' : 'text-gray-500'}`}>{right}</div>}
    </div>
  );
}

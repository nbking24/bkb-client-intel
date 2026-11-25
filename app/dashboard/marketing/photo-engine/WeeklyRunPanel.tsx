// @ts-nocheck
'use client';

/**
 * Marketing pipeline Step 5 panel: the Friday run and Run now. Shows whether
 * the schedule is on, live or draft, when Mike was last sent files, and the
 * latest run; runs a live Run now or a draft on demand.
 *
 * Style note: no em or en dashes in this file.
 */
import { useState } from 'react';
import { Loader2, CalendarClock, Send } from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

function when(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function WeeklyRunPanel() {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<any>(null);

  async function call(method: 'GET' | 'POST', body?: any) {
    const token = getToken();
    const r = await fetch('/api/marketing/photo-engine/weekly', {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await r.json().catch(() => ({ error: 'The server took too long to answer (status ' + r.status + '). Click the button again to carry on; nothing is lost.' }));
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function load() {
    setBusy('load');
    setError(null);
    try {
      setState(await call('GET'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(enable: boolean) {
    if (enable && !window.confirm('Switch the Friday run on? It runs every Friday at about 2am ET in ' + (state?.live ? 'LIVE mode (copies, publishes, emails Mike).' : 'draft mode (changes nothing, emails you).'))) return;
    setBusy('toggle');
    try {
      await call('POST', { action: enable ? 'enable' : 'disable' });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleLive(on: boolean) {
    if (on && !window.confirm('Turn the Hub live setting on? With the Vercel variable also on, the Friday run copies files, publishes profiles and emails Mike.')) return;
    setBusy('live');
    try {
      await call('POST', { action: on ? 'live-on' : 'live-off' });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  // Each call does as much as fits in a few minutes; keep calling until the
  // run finishes. If one call fails, the next click picks up where it stopped.
  async function runUntilDone(action: 'draft' | 'run-now') {
    if (action === 'run-now' && !window.confirm(
      'Send to Mike now?\n\nThis does exactly what the Friday run does: copies every new photo, video and plan to his FTP, updates each job\'s writeup, and emails him from your address (you get a copy).\n\nThe next Friday run then only sends what is added after this.'
    )) return;
    setBusy(action);
    setError(null);
    setProgress(null);
    try {
      for (let i = 0; i < 30; i++) {
        const r = await call('POST', { action });
        setState(r);
        setProgress(r.tick);
        if (r.tick?.finished || r.tick?.waiting) break;
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  // Show the most recent of today's Friday run and the latest Run now or draft.
  const candidates = [state?.run, state?.manualRun].filter(Boolean);
  const run = candidates.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0] || null;
  const runLabel = !run ? '' : run.trigger === 'friday' || run.trigger === 'cron' ? 'Friday run' : run.mode === 'live' ? 'Run now' : 'Draft';
  const lastLive = state?.lastLive;

  return (
    <div className="border border-gray-200 rounded-lg bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-blue-700" />
          Send to Mike
          {state && (
            <span className="text-xs font-normal text-gray-400">
              Friday schedule {state.config?.enabled ? 'on' : 'off'} . {state.live ? 'live' : 'draft mode'}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {!state && (
            <button onClick={load} disabled={!!busy} className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
              {busy === 'load' ? 'Loading...' : 'Show'}
            </button>
          )}
          {state && (
            <>
              <button
                onClick={() => runUntilDone('run-now')}
                disabled={!!busy || !state.live}
                title={state.live ? 'Send everything new to Mike now' : 'Live mode is off, so nothing can be sent'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === 'run-now' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {busy === 'run-now' ? 'Sending...' : 'Run now'}
              </button>
              <button onClick={() => runUntilDone('draft')} disabled={!!busy} className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
                {busy === 'draft' ? <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Running draft...</span> : 'Preview (draft)'}
              </button>
              <button onClick={load} disabled={!!busy} className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
                Refresh
              </button>
              <button onClick={() => toggle(!state.config?.enabled)} disabled={!!busy} className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
                {state.config?.enabled ? 'Switch Friday off' : 'Switch Friday on'}
              </button>
            </>
          )}
        </div>
      </div>

      {state && (
        <p className="mt-2 text-xs text-gray-500">
          {lastLive
            ? <>Last sent to Mike {when(lastLive.finishedAt)} ({lastLive.trigger === 'friday' ? 'Friday run' : 'Run now'}{lastLive.jobs?.length ? ': ' + lastLive.jobs.join(', ') : ', nothing new'}). The next run sends only what was added after that.</>
            : <>Each run sends only what was added since the last run. Run now does the same as Friday, right away. Preview emails only you and changes nothing.</>}
        </p>
      )}

      {error && <div className="mt-2 rounded-md bg-red-50 p-3 text-red-700 text-sm">{error}</div>}

      {state?.checks && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <Check ok={state.config?.enabled} label={'Friday schedule ' + (state.config?.enabled ? 'on' : 'off')} />
          <Check ok={state.checks.hubLive} label={'Hub live setting ' + (state.checks.hubLive ? 'on' : 'off')} />
          <button onClick={() => toggleLive(!state.checks.hubLive)} disabled={!!busy} className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
            {state.checks.hubLive ? 'Turn live off' : 'Turn live on'}
          </button>
          <Check ok={state.checks.vercelLive} label={'Vercel MARKETING_PHOTO_ENGINE_LIVE ' + (state.checks.vercelLive ? 'true' : 'not true')} />
          <Check ok={state.checks.cronSecretSet} label={'CRON_SECRET ' + (state.checks.cronSecretSet ? 'set' : 'missing')} />
          {state.checks.recipient && <span className="text-gray-500">Mike's address: {state.checks.recipient}</span>}
        </div>
      )}

      {progress?.waiting && <div className="mt-2 text-xs text-amber-700">{progress.waiting}</div>}

      {run && (
        <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-1">
          <div className="font-medium text-gray-900">
            {runLabel} . started {when(run.startedAt)} . {run.emailed ? 'finished' : busy ? 'working...' : 'not finished, click the button again to carry on'}
            {run.emailed && run.email && (
              <> . {run.mode === 'live'
                ? (run.email.skipped ? 'nothing new, no email sent' : run.email.ok ? 'email sent to Mike' : 'email NOT sent: ' + (run.email.error || 'unknown error'))
                : (run.email.ok ? 'preview emailed to you' : 'preview email NOT sent: ' + (run.email.error || 'unknown error'))}</>
            )}
          </div>
          {run.jobs?.length === 0 && <div>No monitored job had anything new.</div>}
          {(run.jobs || []).map((j) => (
            <div key={j.jobId}>
              <span className="font-medium">{j.name}</span>:{' '}
              {j.copy === 'done' && j.profile === 'done' ? 'done' : j.copy === 'done' ? 'files done, writeup next' : 'waiting'}
              {j.counts && <> . {Object.entries(j.counts).filter(([, n]) => n).map(([k, n]) => n + ' ' + k).join(', ') || 'no new files'}</>}
              {j.profileUpdated ? <> . writeup updated</> : null}
              {j.waiting ? <> . {j.waiting} waiting for labels</> : null}
              {j.error && <span className="text-red-700"> . {j.error}</span>}
              {j.skipped && <span className="text-gray-500"> . skipped: {j.skipped}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full border ${ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-300 bg-gray-50 text-gray-600'}`}>
      {ok ? '✓ ' : ''}{label}
    </span>
  );
}

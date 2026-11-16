// @ts-nocheck
'use client';

/**
 * Marketing pipeline Step 5 panel: the Friday run. Shows whether the schedule
 * is on, live or draft, and today's run; runs a draft on demand.
 *
 * Style note: no em or en dashes in this file.
 */
import { useState } from 'react';
import { Loader2, CalendarClock } from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

export default function WeeklyRunPanel() {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(method: 'GET' | 'POST', body?: any) {
    const token = getToken();
    const r = await fetch('/api/marketing/photo-engine/weekly', {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await r.json().catch(() => ({ error: 'Unreadable response (status ' + r.status + ')' }));
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

  async function runDraft() {
    setBusy('draft');
    setError(null);
    try {
      // Each call does as much as fits; keep calling until the run finishes.
      for (let i = 0; i < 20; i++) {
        const r = await call('POST', { action: 'draft' });
        setState((s) => ({ ...(s || {}), run: { ...r, jobs: r.jobs } }));
        if (r.finished) break;
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const run = state?.run;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-blue-700" />
          Friday run
          {state && (
            <span className="text-xs font-normal text-gray-400">
              Schedule {state.config?.enabled ? 'on' : 'off'} . {state.live ? 'LIVE' : 'draft mode'}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={load} disabled={!!busy} className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
            {busy === 'load' ? 'Loading...' : state ? 'Refresh' : 'Show'}
          </button>
          {state && (
            <>
              <button onClick={runDraft} disabled={!!busy} className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
                {busy === 'draft' ? <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Running draft...</span> : 'Run a draft now'}
              </button>
              <button onClick={() => toggle(!state.config?.enabled)} disabled={!!busy} className="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">
                {state.config?.enabled ? 'Switch schedule off' : 'Switch schedule on'}
              </button>
            </>
          )}
        </div>
      </div>
      {error && <div className="rounded-md bg-red-50 p-3 text-red-700 text-sm mb-2">{error}</div>}
      {state && !run && <div className="text-xs text-gray-500">No run today.</div>}
      {run && (
        <div className="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-1">
          <div className="font-medium text-gray-900">
            {run.date} . {run.mode} . {run.finished || run.emailed ? 'finished' : 'in progress'}{run.emailed ? ' . email ' + (run.email?.ok ? 'sent' : 'not sent') : ''}
          </div>
          {(run.jobs || []).map((j) => (
            <div key={j.jobId}>
              <span className="font-medium">{j.name}</span>: copy {j.copy}, profile {j.profile}
              {j.counts && <> . {Object.entries(j.counts).filter(([, n]) => n).map(([k, n]) => n + ' ' + k).join(', ') || 'nothing new to send'}</>}
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

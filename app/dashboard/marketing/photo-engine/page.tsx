// @ts-nocheck
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Images, RefreshCw, AlertTriangle, Folder, Camera, Film,
  FileText, Play, CheckCircle2, Clock, XCircle, Plus, X, Search,
} from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    queued: { label: 'Queued', cls: 'bg-gray-100 text-gray-700' },
    processing: { label: 'Processing', cls: 'bg-blue-100 text-blue-700' },
    complete: { label: 'Complete', cls: 'bg-green-100 text-green-700' },
    error: { label: 'Error', cls: 'bg-red-100 text-red-700' },
  };
  const s = status ? map[status] : null;
  if (!s) return <span className="text-xs text-gray-400">No runs yet</span>;
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

function EmailBadge({ status }: { status: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: 'Draft', cls: 'bg-amber-100 text-amber-800' },
    held: { label: 'Held', cls: 'bg-amber-100 text-amber-800' },
    sent: { label: 'Sent', cls: 'bg-green-100 text-green-700' },
    skipped: { label: 'Skipped', cls: 'bg-gray-100 text-gray-600' },
  };
  const s = status ? map[status] : map.draft;
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export default function PhotoEnginePage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [liveMode, setLiveMode] = useState(true); // assume live until we know, so the banner does not flash
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function loadAll() {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [jobsRes, runsRes] = await Promise.all([
        fetch('/api/marketing/photo-engine/jobs', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/marketing/photo-engine/runs', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const jobsData = await jobsRes.json();
      const runsData = await runsRes.json();
      if (jobsData.error) setError(jobsData.error);
      else {
        setJobs(jobsData.jobs || []);
        setLiveMode(jobsData.liveMode === true);
      }
      if (!runsData.error) setRuns(runsData.runs || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function setIncluded(jobId: string, included: boolean) {
    const token = getToken();
    if (!token) return;
    setBusyJob(jobId);
    setError(null);
    try {
      const r = await fetch('/api/marketing/photo-engine/select', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, included }),
      });
      const data = await r.json();
      if (data.error) setError(data.error);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyJob(null);
    }
  }

  async function queueJob(jobId: string) {
    const token = getToken();
    if (!token) return;
    setBusyJob(jobId);
    setError(null);
    try {
      const r = await fetch('/api/marketing/photo-engine/queue', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const data = await r.json();
      if (data.error) setError(data.error);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyJob(null);
    }
  }

  const selectedJobs = useMemo(() => jobs.filter((j) => j.included), [jobs]);
  const availableJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs
      .filter((j) => !j.included)
      .filter((j) =>
        !q ||
        (j.name || '').toLowerCase().includes(q) ||
        (j.number || '').toLowerCase().includes(q)
      );
  }, [jobs, search]);

  if (loading && jobs.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading marketing jobs...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Images className="w-5 h-5 text-blue-700" />
            Photo Engine
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Choose the jobs you want the engine to work. For each selected job, the Cowork task
            curates photos and videos, builds the project profile, and stages a folder for the web
            designer. The heavy media work runs outside the Hub.
          </p>
        </div>
        <button
          onClick={loadAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {!liveMode && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <div className="font-semibold">Draft mode</div>
            <p className="mt-0.5">
              Nothing is uploaded to the designer or emailed to Mike Roda until this engine is
              reviewed and turned on.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">Failed: {error}</div>
      )}

      {/* Selected jobs */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Selected jobs</h3>
        {selectedJobs.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-lg p-8 text-center">
            <Folder className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600">
              No jobs selected yet. Add a job from the list below to start building its marketing
              folder and profile.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {selectedJobs.map((j) => {
              const last = j.lastRun;
              const running = last?.status === 'queued' || last?.status === 'processing';
              return (
                <div key={j.id} className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900">{j.name || 'Unnamed job'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                        {j.number && <span>#{j.number}</span>}
                        <span className="inline-flex items-center gap-1.5">
                          <Folder className="w-3.5 h-3.5 text-gray-400" />
                          <code className="bg-gray-100 rounded px-1.5 py-0.5">{j.folderName}</code>
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => queueJob(j.id)}
                        disabled={busyJob === j.id || running}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busyJob === j.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        Queue for processing
                      </button>
                      <button
                        onClick={() => setIncluded(j.id, false)}
                        disabled={busyJob === j.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <X className="w-3.5 h-3.5" />
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-gray-600">
                    <StatusBadge status={last?.status || null} />
                    <span className="inline-flex items-center gap-1"><Camera className="w-3.5 h-3.5 text-gray-400" />{last?.photosAdded ?? 0} photos</span>
                    <span className="inline-flex items-center gap-1"><Film className="w-3.5 h-3.5 text-gray-400" />{last?.videosAdded ?? 0} videos</span>
                    {last?.profileUpdated ? (
                      <span className="inline-flex items-center gap-1 text-green-700"><FileText className="w-3.5 h-3.5" />Profile updated</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-gray-400"><FileText className="w-3.5 h-3.5" />Profile not built yet</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add a job */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-3">
          <h3 className="text-sm font-semibold text-gray-700">Add a job</h3>
          <div className="relative w-64 max-w-full">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search active jobs..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
        {availableJobs.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-lg p-6 text-center text-sm text-gray-500">
            {search.trim()
              ? 'No active jobs match your search.'
              : 'Every active job is already selected.'}
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {availableJobs.map((j) => (
              <div key={j.id} className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 text-sm">{j.name || 'Unnamed job'}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-400">
                    {j.number && <span>#{j.number}</span>}
                    <span className="inline-flex items-center gap-1">
                      <Folder className="w-3 h-3" />
                      {j.folderName}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setIncluded(j.id, true)}
                  disabled={busyJob === j.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-blue-700 text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                  {busyJob === j.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Include
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Recent activity</h3>
        {runs.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-300 rounded-lg p-6 text-center text-sm text-gray-500">
            No runs yet. Queue a selected job above to get started.
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {runs.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                <div className="mt-0.5">
                  {r.status === 'complete' ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                    : r.status === 'error' ? <XCircle className="w-4 h-4 text-red-600" />
                    : <Clock className="w-4 h-4 text-gray-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 text-sm">{r.job_name || r.job_id}</span>
                    <StatusBadge status={r.status} />
                    <EmailBadge status={r.email_status} />
                    <span className="text-xs text-gray-400">{r.trigger}</span>
                  </div>
                  {r.change_summary && (
                    <p className="text-sm text-gray-600 mt-1">{r.change_summary}</p>
                  )}
                  {r.error && (
                    <p className="text-xs text-red-600 mt-1">{r.error}</p>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    {r.created_at ? new Date(r.created_at).toLocaleString() : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

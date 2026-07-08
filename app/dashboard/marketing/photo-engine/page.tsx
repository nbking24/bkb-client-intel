// @ts-nocheck
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Images, RefreshCw, AlertTriangle, Folder, Camera, Film,
  FileText, Play, CheckCircle2, Clock, XCircle, Plus, X, Search,
  FolderOpen, ArrowLeft, ChevronRight, Upload, ExternalLink, File as FileIcon, Trash2,
} from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

function formatBytes(n: number): string {
  if (!n || n < 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
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
  const [showAdd, setShowAdd] = useState(false);

  // Project folders (designer FTP browser)
  const [ftpConfigured, setFtpConfigured] = useState<boolean | null>(null);
  const [ftpPath, setFtpPath] = useState('');
  const [ftpEntries, setFtpEntries] = useState<any[]>([]);
  const [ftpLoading, setFtpLoading] = useState(false);
  const [ftpError, setFtpError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  async function loadFtp(path = ftpPath) {
    const token = getToken();
    if (!token) return;
    setFtpLoading(true);
    setFtpError(null);
    try {
      const r = await fetch(
        '/api/marketing/photo-engine/ftp/list?path=' + encodeURIComponent(path),
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await r.json();
      setFtpConfigured(data.configured === true);
      if (data.configured === true) {
        setFtpEntries(data.entries || []);
        setFtpPath(data.path || path);
        if (data.error) setFtpError(data.error);
      }
    } catch (err: any) {
      setFtpError(err.message);
    } finally {
      setFtpLoading(false);
    }
  }

  useEffect(() => { loadFtp(''); }, []);

  function openFolder(name: string) {
    const next = ftpPath ? ftpPath + '/' + name : name;
    setFtpPath(next);
    loadFtp(next);
  }

  function goToCrumb(index: number) {
    const parts = ftpPath.split('/').filter(Boolean);
    const next = parts.slice(0, index + 1).join('/');
    setFtpPath(next);
    loadFtp(next);
  }

  function goRoot() {
    setFtpPath('');
    loadFtp('');
  }

  function goBack() {
    const parts = ftpPath.split('/').filter(Boolean);
    parts.pop();
    const next = parts.join('/');
    setFtpPath(next);
    loadFtp(next);
  }

  async function viewFile(name: string) {
    const token = getToken();
    if (!token) return;
    const full = ftpPath ? ftpPath + '/' + name : name;
    setViewingFile(name);
    setFtpError(null);
    try {
      const r = await fetch(
        '/api/marketing/photo-engine/ftp/file?path=' + encodeURIComponent(full),
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) {
        let msg = 'Could not open that file';
        try { const j = await r.json(); if (j.error) msg = j.error; } catch {}
        setFtpError(msg);
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Give the new tab time to load before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: any) {
      setFtpError(err.message);
    } finally {
      setViewingFile(null);
    }
  }

  async function deleteFile(name: string) {
    const token = getToken();
    if (!token) return;
    const ok = window.confirm(`Delete "${name}"? This removes it from the folder.`);
    if (!ok) return;
    const full = ftpPath ? ftpPath + '/' + name : name;
    setDeletingFile(name);
    setFtpError(null);
    try {
      const r = await fetch('/api/marketing/photo-engine/ftp/delete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: full }),
      });
      const data = await r.json();
      if (!data.ok) {
        setFtpError(data.error || 'Delete failed');
        return;
      }
      await loadFtp(ftpPath);
    } catch (err: any) {
      setFtpError(err.message);
    } finally {
      setDeletingFile(null);
    }
  }

  async function onUploadPick(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    const token = getToken();
    if (!token) return;
    setUploading(true);
    setFtpError(null);
    try {
      const fd = new FormData();
      fd.append('path', ftpPath);
      fd.append('file', file);
      const r = await fetch('/api/marketing/photo-engine/ftp/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await r.json();
      if (!data.ok) setFtpError(data.error || 'Upload failed');
      await loadFtp(ftpPath);
    } catch (err: any) {
      setFtpError(err.message);
    } finally {
      setUploading(false);
      if (input) input.value = '';
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
              Draft mode. Photos and profiles are staged for review only. Nothing is uploaded to the
              designer or emailed to Mike Roda until this is turned on.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">Failed: {error}</div>
      )}

      {/* Project folders (designer FTP browser) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-blue-700" />
            Project folders
          </h3>
          <div className="flex items-center gap-2">
            {ftpConfigured && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || ftpLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-blue-700 text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Upload file
                </button>
                <button
                  onClick={() => loadFtp(ftpPath)}
                  disabled={ftpLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${ftpLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onUploadPick}
        />

        {ftpConfigured === false && (
          <div className="bg-white border border-dashed border-gray-300 rounded-lg p-6 text-center">
            <FolderOpen className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              Folder browsing is not connected yet. Add the FTP details in the Hub environment
              settings to browse and upload here.
            </p>
          </div>
        )}

        {ftpConfigured && (
          <div className="bg-white border border-gray-200 rounded-lg">
            {/* Breadcrumb + back */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 text-sm">
              {ftpPath ? (
                <button
                  onClick={goBack}
                  className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-gray-300">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </span>
              )}
              <span className="text-gray-300">|</span>
              <div className="flex items-center gap-1 flex-wrap min-w-0">
                <button
                  onClick={goRoot}
                  className={`inline-flex items-center gap-1 ${ftpPath ? 'text-blue-700 hover:underline' : 'text-gray-700 font-medium'}`}
                >
                  <Folder className="w-3.5 h-3.5" />
                  BKB Review
                </button>
                {ftpPath.split('/').filter(Boolean).map((seg, i, arr) => (
                  <span key={i} className="inline-flex items-center gap-1 min-w-0">
                    <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
                    {i === arr.length - 1 ? (
                      <span className="text-gray-700 font-medium truncate">{seg}</span>
                    ) : (
                      <button onClick={() => goToCrumb(i)} className="text-blue-700 hover:underline truncate">
                        {seg}
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>

            {ftpError && (
              <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">
                {ftpError}
              </div>
            )}

            {ftpLoading ? (
              <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Loading folder...
              </div>
            ) : ftpEntries.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">
                This folder is empty.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {ftpEntries.map((entry) => (
                  <div key={entry.name} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    {entry.isDir ? (
                      <button
                        onClick={() => openFolder(entry.name)}
                        className="flex items-center gap-2 min-w-0 text-left group"
                      >
                        <Folder className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        <span className="text-sm text-gray-800 group-hover:text-blue-700 truncate">{entry.name}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => viewFile(entry.name)}
                        className="flex items-center gap-2 min-w-0 text-left group"
                      >
                        <FileIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="text-sm text-gray-800 group-hover:text-blue-700 truncate">{entry.name}</span>
                        {entry.size > 0 && (
                          <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(entry.size)}</span>
                        )}
                      </button>
                    )}
                    <div className="flex-shrink-0">
                      {entry.isDir ? (
                        <ChevronRight className="w-4 h-4 text-gray-300" />
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => viewFile(entry.name)}
                            disabled={viewingFile === entry.name || deletingFile === entry.name}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          >
                            {viewingFile === entry.name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                            View
                          </button>
                          <button
                            onClick={() => deleteFile(entry.name)}
                            disabled={deletingFile === entry.name || viewingFile === entry.name}
                            title="Delete file"
                            aria-label="Delete file"
                            className="inline-flex items-center justify-center p-1.5 text-xs rounded-md border border-gray-300 text-gray-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {deletingFile === entry.name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
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

      {/* Selected jobs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">Selected jobs</h3>
          <button
            onClick={() => { setSearch(''); setShowAdd(true); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-blue-700 text-white hover:bg-blue-800"
          >
            <Plus className="w-4 h-4" />
            Add a job
          </button>
        </div>
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
                      <div className="font-medium text-gray-900 flex items-center gap-2">{j.name || 'Unnamed job'}{!j.active && (<span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Completed</span>)}</div>
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

      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-800">Add a job</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 border-b border-gray-100">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search all JobTread jobs (active first, then completed)..."
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="overflow-y-auto">
              {availableJobs.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500">
                  {search.trim() ? 'No jobs match your search.' : 'Every job is already selected.'}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {availableJobs.map((j, idx) => {
                    const showDivider = idx > 0 && availableJobs[idx - 1].active && !j.active;
                    return (
                    <div key={j.id}>
                      {showDivider && (
                        <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-50">
                          Completed jobs
                        </div>
                      )}
                      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 text-sm truncate flex items-center gap-2">
                            <span className="truncate">{j.name || 'Unnamed job'}</span>
                            {!j.active && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">Completed</span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-400">
                            {j.number && <span>#{j.number}</span>}
                            <span className="inline-flex items-center gap-1"><Folder className="w-3 h-3" />{j.folderName}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setIncluded(j.id, true)}
                          disabled={busyJob === j.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-blue-700 text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                        >
                          {busyJob === j.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                          Add
                        </button>
                      </div>
                    </div>
                  );})}
                </div>
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-gray-200 text-right">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

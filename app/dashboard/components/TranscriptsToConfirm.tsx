// @ts-nocheck
'use client';

/**
 * "Transcripts to confirm" card.
 * Shows meeting transcripts the current user recorded that still need a job/lead
 * assignment. The Hub pre-guesses; the user confirms with one click or picks a
 * different job (or marks it an early lead with no job yet). Renders nothing
 * when the user has no pending transcripts, so it is safe to drop on any home page.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { FileText, Check, Loader2, Calendar, ChevronRight, Trash2, Clock } from 'lucide-react';

/**
 * Format a duration in seconds as a readable label.
 *   2700  -> "45 min"
 *   3720  -> "1h 02m"
 *   45    -> "<1 min"
 * Returns null when the duration is missing/zero so the caller can hide the
 * label entirely instead of rendering "0 min".
 */
function fmtDuration(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return '<1 min';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h ${String(rem).padStart(2, '0')}m`;
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

const GOLD = '#c88c00';
// Catch-all job for internal / multi-project meetings (BKB "Admin Project").
const ADMIN_PROJECT = { id: '22P6NCjBeR8d', name: 'Admin Project' };

export default function TranscriptsToConfirm({ scopeAll = false, reloadKey = 0 }: { scopeAll?: boolean; reloadKey?: number }) {
  const [items, setItems] = useState<any[]>([]);
  const [jobOptions, setJobOptions] = useState<any[]>([]);
  // Active jobs sorted alphabetically for an organized dropdown.
  const sortedJobs = useMemo(() => [...jobOptions].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))), [jobOptions]);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<Record<string, string>>({});   // id -> jobId | '__lead__'
  const [leadName, setLeadName] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/transcripts' + (scopeAll ? '?scope=all' : ''), { headers: { authorization: `Bearer ${getToken()}` } });
      if (!res.ok) { setLoaded(true); return; }
      const data = await res.json();
      setItems(data.transcripts || []);
      setJobOptions(data.jobOptions || []);
      const presets: Record<string, string> = {};
      for (const t of data.transcripts || []) {
        if (t.suggested_kind === 'job' && t.suggested_job_id) presets[t.id] = t.suggested_job_id;
        else if (t.suggested_kind === 'lead') presets[t.id] = '__lead__';
      }
      setSel((s) => ({ ...presets, ...s }));
      setLoaded(true);
    } catch { setLoaded(true); }
  }, [scopeAll]);

  useEffect(() => { load(); }, [load, reloadKey]);

  async function doConfirm(t: any, payload: any) {
    setBusy((b) => ({ ...b, [t.id]: true }));
    try {
      const res = await fetch(`/api/transcripts/${t.id}/confirm`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) setItems((prev) => prev.filter((x) => x.id !== t.id));
    } finally {
      setBusy((b) => ({ ...b, [t.id]: false }));
    }
  }

  function confirm(t: any) {
    const choice = sel[t.id];
    if (!choice) return;
    let payload: any;
    if (choice === '__lead__') {
      payload = { kind: 'lead', leadContactId: t.suggested_lead_contact_id || null, leadName: leadName[t.id] || t.suggested_lead_name || '' };
    } else {
      const job = jobOptions.find((j) => j.id === choice);
      payload = { kind: 'job', jobId: choice, jobName: job?.name || t.suggested_job_name || null };
    }
    return doConfirm(t, payload);
  }

  function confirmAdmin(t: any) {
    return doConfirm(t, { kind: 'job', jobId: ADMIN_PROJECT.id, jobName: ADMIN_PROJECT.name });
  }

  async function deleteTranscript(t: any) {
    setBusy((b) => ({ ...b, [t.id]: true }));
    try {
      const res = await fetch(`/api/transcripts/${t.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${getToken()}` } });
      if (res.ok) { setItems((prev) => prev.filter((x) => x.id !== t.id)); setConfirmDeleteId(null); }
    } finally {
      setBusy((b) => ({ ...b, [t.id]: false }));
    }
  }

  if (!loaded || items.length === 0) return null;

  return (
    <div style={{ marginBottom: 6, borderRadius: 8, border: '1px solid rgba(200,140,0,0.12)', overflow: 'hidden', background: '#ffffff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgba(200,140,0,0.08)' }}>
        <FileText size={14} style={{ color: GOLD }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: GOLD, letterSpacing: '0.04em' }}>
          TRANSCRIPTS TO CONFIRM ({items.length})
        </span>
      </div>
      <div style={{ padding: '6px 10px' }}>
        {items.map((t) => {
          const cal = t.matched_calendar_event;
          const conf = typeof t.match_confidence === 'number' ? Math.round(t.match_confidence * 100) : null;
          return (
            <div key={t.id} style={{ padding: '8px 6px', borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#2a2520', marginBottom: 2 }}>{t.title}</div>
              <div style={{ fontSize: 10, color: '#6a6058', marginBottom: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {t.recorded_at && <span>{new Date(t.recorded_at).toLocaleString()}</span>}
                {/* Duration helps distinguish similar-titled meetings during
                    categorization (a 5-min site check vs a 45-min design review
                    look identical otherwise). Hidden when duration_seconds is
                    missing or zero. */}
                {(() => {
                  const dur = fmtDuration(t.duration_seconds);
                  return dur ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Clock size={10} /> {dur}
                    </span>
                  ) : null;
                })()}
                {cal?.summary && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Calendar size={10} /> {cal.summary}</span>}
                {conf !== null && <span>guess: {conf}%</span>}
              </div>
              {t.match_reasoning && <div style={{ fontSize: 10, color: '#8a8078', marginBottom: 6, fontStyle: 'italic' }}>{t.match_reasoning}</div>}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={sel[t.id] || ''}
                  onChange={(e) => setSel((s) => ({ ...s, [t.id]: e.target.value }))}
                  style={{ flex: 1, minWidth: 180, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(200,140,0,0.2)', background: '#fff', color: '#2a2520' }}
                >
                  <option value="">Select job or lead...</option>
                  <optgroup label="Sales">
                    <option value="__lead__">Lead / no job yet (early sales call)</option>
                  </optgroup>
                  <optgroup label="Active jobs">
                    {sortedJobs.map((j) => (
                      <option key={j.id} value={j.id}>{j.name}{j.clientName && !String(j.name || '').toLowerCase().includes(String(j.clientName).toLowerCase()) ? ` (${j.clientName})` : ''}</option>
                    ))}
                  </optgroup>
                </select>
                {sel[t.id] === '__lead__' && (
                  <input
                    type="text"
                    placeholder="Client name"
                    value={leadName[t.id] ?? (t.suggested_lead_name || '')}
                    onChange={(e) => setLeadName((l) => ({ ...l, [t.id]: e.target.value }))}
                    style={{ flex: 1, minWidth: 140, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(200,140,0,0.2)', background: '#fff', color: '#2a2520' }}
                  />
                )}
                <button
                  onClick={() => confirm(t)}
                  disabled={!sel[t.id] || busy[t.id]}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6, border: 'none',
                    background: sel[t.id] ? GOLD : '#e8e5e0', color: '#fff', fontSize: 12, fontWeight: 600, cursor: sel[t.id] ? 'pointer' : 'default' }}
                >
                  {busy[t.id] ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Confirm
                </button>
                <button
                  onClick={() => confirmAdmin(t)}
                  disabled={busy[t.id]}
                  title="Internal or multi-project meeting — files to the Admin Project job"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(200,140,0,0.25)',
                    background: '#fff', color: GOLD, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  Internal / Multi-project
                </button>
                {confirmDeleteId === t.id ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <button onClick={() => deleteTranscript(t)} disabled={busy[t.id]}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      {busy[t.id] ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#6a6058', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDeleteId(t.id)} title="Delete this transcript"
                    style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', color: '#b0a89e', cursor: 'pointer' }}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

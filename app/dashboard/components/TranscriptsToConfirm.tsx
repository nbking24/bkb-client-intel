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
import { FileText, Check, Loader2, Calendar, ChevronRight, Trash2, Clock, Search } from 'lucide-react';
import { formatEasternDateTime } from '@/app/lib/eastern-time';

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
  // Active Loop leads (alphabetized by listActiveLeads on the server). Used
  // to populate the "pick a lead" dropdown when "Lead / no job yet" is the
  // assignment kind, so users don't have to free-type a client name and
  // accidentally lose the contact_id linkage.
  const [leadOptions, setLeadOptions] = useState<any[]>([]);
  // Active jobs sorted alphabetically for an organized dropdown.
  const sortedJobs = useMemo(() => [...jobOptions].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))), [jobOptions]);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<Record<string, string>>({});   // id -> jobId | '__lead__'
  // Per-transcript lead selection. Holds the Loop contactId of the chosen
  // lead. Empty string means "Other / type a name" (falls back to free text).
  const [leadContactId, setLeadContactId] = useState<Record<string, string>>({});
  const [leadName, setLeadName] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // "Search all jobs" state. The normal dropdown only carries OPEN jobs, so a
  // meeting recorded after a job closed (thank-you visit, warranty call,
  // post-mortem) has nothing to attach to. Picking the __search__ sentinel
  // opens a box that queries /api/transcripts/job-search, which searches open
  // AND closed jobs by name, number or client.
  const [searchOpen, setSearchOpen] = useState<Record<string, boolean>>({});
  const [searchText, setSearchText] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<Record<string, any[]>>({});
  const [searching, setSearching] = useState<Record<string, boolean>>({});
  // Jobs pulled in by search, so the <select> can display one that isn't in
  // jobOptions and confirm() can still resolve its name. id -> job
  const [foundJobs, setFoundJobs] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/transcripts' + (scopeAll ? '?scope=all' : ''), { headers: { authorization: `Bearer ${getToken()}` } });
      if (!res.ok) { setLoaded(true); return; }
      const data = await res.json();
      setItems(data.transcripts || []);
      setJobOptions(data.jobOptions || []);
      setLeadOptions(data.leadOptions || []);
      const presets: Record<string, string> = {};
      const leadPresets: Record<string, string> = {};
      for (const t of data.transcripts || []) {
        if (t.suggested_kind === 'job' && t.suggested_job_id) presets[t.id] = t.suggested_job_id;
        else if (t.suggested_kind === 'lead') presets[t.id] = '__lead__';
        // If the auto-matcher already guessed a specific Loop contact,
        // pre-select it in the lead dropdown so the user can one-click confirm.
        if (t.suggested_lead_contact_id) leadPresets[t.id] = t.suggested_lead_contact_id;
      }
      setSel((s) => ({ ...presets, ...s }));
      setLeadContactId((l) => ({ ...leadPresets, ...l }));
      setLoaded(true);
    } catch { setLoaded(true); }
  }, [scopeAll]);

  useEffect(() => { load(); }, [load, reloadKey]);

  // Debounce the "search all jobs" boxes. One timer per open box; 300ms is
  // long enough that typing a job name is a single JobTread call, short
  // enough that results feel immediate.
  useEffect(() => {
    const openIds = Object.keys(searchOpen).filter((id) => searchOpen[id]);
    if (openIds.length === 0) return;
    const timers = openIds.map((id) =>
      setTimeout(() => runJobSearch(id, searchText[id] || ''), 300),
    );
    return () => timers.forEach(clearTimeout);
  }, [searchOpen, searchText, runJobSearch]);

  /**
   * Look a job up across open AND closed jobs. Debounced by the caller's
   * effect; 2 characters is the server's floor too.
   */
  const runJobSearch = useCallback(async (transcriptId: string, q: string) => {
    const term = (q || '').trim();
    if (term.length < 2) {
      setSearchResults((r) => ({ ...r, [transcriptId]: [] }));
      return;
    }
    setSearching((b) => ({ ...b, [transcriptId]: true }));
    try {
      const res = await fetch(`/api/transcripts/job-search?q=${encodeURIComponent(term)}`, {
        headers: { authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setSearchResults((r) => ({ ...r, [transcriptId]: res.ok ? (data.jobs || []) : [] }));
    } catch {
      setSearchResults((r) => ({ ...r, [transcriptId]: [] }));
    } finally {
      setSearching((b) => ({ ...b, [transcriptId]: false }));
    }
  }, []);

  /** Pick a searched job: remember it so the select can render it, then select it. */
  function pickFoundJob(t: any, job: any) {
    setFoundJobs((f) => ({ ...f, [job.id]: job }));
    setSel((sl) => ({ ...sl, [t.id]: job.id }));
    setSearchOpen((o) => ({ ...o, [t.id]: false }));
  }

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
      // Prefer the dropdown selection: a Loop contactId means we can link the
      // PML event and any later daily-log backfill to a real Loop contact.
      // Falls back to the free-text name only when the user explicitly picked
      // "Other / type a name" (sentinel value: '__other__').
      const pickedContactId = leadContactId[t.id];
      const isOther = pickedContactId === '__other__';
      const matched = leadOptions.find((l: any) => l.contactId === pickedContactId);
      payload = {
        kind: 'lead',
        leadContactId: !isOther ? (pickedContactId || t.suggested_lead_contact_id || null) : null,
        leadName: matched?.contactName || leadName[t.id] || t.suggested_lead_name || '',
      };
    } else {
      const job = jobOptions.find((j) => j.id === choice) || foundJobs[choice];
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
                {t.recorded_at && <span>{formatEasternDateTime(t.recorded_at)}</span>}
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
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__search__') {
                      // Sentinel, not a real choice: open the search box and
                      // leave the previous selection alone.
                      setSearchOpen((o) => ({ ...o, [t.id]: true }));
                      return;
                    }
                    setSel((s) => ({ ...s, [t.id]: v }));
                  }}
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
                  {/* A job found by search that isn't in the open list (almost
                      always a closed one) needs its own option or the select
                      has nothing to display for the chosen id. */}
                  {sel[t.id] && foundJobs[sel[t.id]] && !sortedJobs.some((j) => j.id === sel[t.id]) && (
                    <optgroup label="Found by search">
                      <option value={sel[t.id]}>
                        {foundJobs[sel[t.id]].name}
                        {foundJobs[sel[t.id]].closedOn ? ` — closed ${foundJobs[sel[t.id]].closedOn}` : ''}
                      </option>
                    </optgroup>
                  )}
                  <optgroup label="Not listed?">
                    <option value="__search__">Search all jobs, including closed...</option>
                  </optgroup>
                </select>
                {searchOpen[t.id] && (
                  <div style={{ flexBasis: '100%', border: '1px solid rgba(200,140,0,0.25)', borderRadius: 6, padding: 8, background: '#fffdf8' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Search size={12} style={{ color: GOLD, flexShrink: 0 }} />
                      <input
                        autoFocus
                        type="text"
                        placeholder="Job name, number or client — closed jobs included"
                        value={searchText[t.id] || ''}
                        onChange={(e) => setSearchText((x) => ({ ...x, [t.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen((o) => ({ ...o, [t.id]: false })); }}
                        style={{ flex: 1, minWidth: 160, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(200,140,0,0.2)', background: '#fff', color: '#2a2520' }}
                      />
                      {searching[t.id] && <Loader2 size={12} className="animate-spin" style={{ color: GOLD }} />}
                      <button
                        onClick={() => setSearchOpen((o) => ({ ...o, [t.id]: false }))}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', color: '#6a6058', fontSize: 11, cursor: 'pointer' }}
                      >
                        Close
                      </button>
                    </div>
                    {(() => {
                      const term = (searchText[t.id] || '').trim();
                      const results = searchResults[t.id] || [];
                      if (term.length < 2) {
                        return <div style={{ fontSize: 11, color: '#8a8078', marginTop: 6 }}>Type at least 2 characters.</div>;
                      }
                      if (searching[t.id]) return null;
                      if (results.length === 0) {
                        return <div style={{ fontSize: 11, color: '#8a8078', marginTop: 6 }}>No job matches "{term}".</div>;
                      }
                      return (
                        <div style={{ marginTop: 6, maxHeight: 190, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {results.map((j: any) => (
                            <button
                              key={j.id}
                              onClick={() => pickFoundJob(t, j)}
                              style={{ textAlign: 'left', padding: '5px 8px', borderRadius: 5, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#2a2520', display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                              <span style={{ fontWeight: 600 }}>{j.number ? `${j.number} · ` : ''}{j.name}</span>
                              {j.clientName && !String(j.name || '').toLowerCase().includes(String(j.clientName).toLowerCase()) && (
                                <span style={{ color: '#8a8078' }}>({j.clientName})</span>
                              )}
                              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: j.closedOn ? '#f1efec' : 'rgba(200,140,0,0.12)', color: j.closedOn ? '#8a8078' : GOLD, whiteSpace: 'nowrap' }}>
                                {j.closedOn ? `CLOSED ${j.closedOn}` : 'OPEN'}
                              </span>
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}
                {sel[t.id] === '__lead__' && (
                  <>
                    {/* Lead picker: choose an existing Loop lead so the
                        transcript stays linked to the Loop contact. When the
                        lead later converts to a JT job, backfillLeadTranscript-
                        DailyLogs in leads-action automatically files the daily
                        log onto the new job. Picking "Other / type a name"
                        falls back to a free-text input for cases where the
                        contact isn't in Loop yet. */}
                    <select
                      value={leadContactId[t.id] || ''}
                      onChange={(e) => setLeadContactId((l) => ({ ...l, [t.id]: e.target.value }))}
                      style={{ flex: 1, minWidth: 160, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(200,140,0,0.2)', background: '#fff', color: '#2a2520' }}
                    >
                      <option value="">
                        {leadOptions.length === 0 ? '(no active leads loaded - pick Other)' : 'Pick a lead...'}
                      </option>
                      {leadOptions.map((l: any) => (
                        <option key={l.contactId} value={l.contactId}>
                          {l.contactName}{l.stage ? ` - ${l.stage}` : ''}
                        </option>
                      ))}
                      <option value="__other__">Other / type a name</option>
                    </select>
                    {leadContactId[t.id] === '__other__' && (
                      <input
                        type="text"
                        placeholder="Client name"
                        value={leadName[t.id] ?? (t.suggested_lead_name || '')}
                        onChange={(e) => setLeadName((l) => ({ ...l, [t.id]: e.target.value }))}
                        style={{ flex: 1, minWidth: 140, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(200,140,0,0.2)', background: '#fff', color: '#2a2520' }}
                      />
                    )}
                  </>
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

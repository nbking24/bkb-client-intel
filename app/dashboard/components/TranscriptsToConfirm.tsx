// @ts-nocheck
'use client';

/**
 * "Transcripts to confirm" card.
 * Shows meeting transcripts the current user recorded that still need a job/lead
 * assignment. The Hub pre-guesses; the user confirms with one click or picks a
 * different job (or marks it an early lead with no job yet). Renders nothing
 * when the user has no pending transcripts, so it is safe to drop on any home page.
 */
import { useEffect, useState, useCallback } from 'react';
import { FileText, Check, Loader2, Calendar, ChevronRight } from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

const GOLD = '#c88c00';

export default function TranscriptsToConfirm() {
  const [items, setItems] = useState<any[]>([]);
  const [jobOptions, setJobOptions] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<Record<string, string>>({});   // id -> jobId | '__lead__'
  const [leadName, setLeadName] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/transcripts', { headers: { authorization: `Bearer ${getToken()}` } });
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
  }, []);

  useEffect(() => { load(); }, [load]);

  async function confirm(t: any) {
    const choice = sel[t.id];
    if (!choice) return;
    setBusy((b) => ({ ...b, [t.id]: true }));
    let payload: any;
    if (choice === '__lead__') {
      payload = { kind: 'lead', leadContactId: t.suggested_lead_contact_id || null, leadName: leadName[t.id] || t.suggested_lead_name || '' };
    } else {
      const job = jobOptions.find((j) => j.id === choice);
      payload = { kind: 'job', jobId: choice, jobName: job?.name || t.suggested_job_name || null };
    }
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
                  <option value="__lead__">Lead / no job yet (early sales call)</option>
                  {jobOptions.map((j) => (
                    <option key={j.id} value={j.id}>{j.name}{j.clientName ? ` — ${j.clientName}` : ''}</option>
                  ))}
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

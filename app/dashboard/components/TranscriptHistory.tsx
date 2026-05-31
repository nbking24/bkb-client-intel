// @ts-nocheck
'use client';

/**
 * "Past Transcripts" — searchable archive of the user's confirmed/processed
 * meeting transcripts. Shows title, assigned job/lead, and date. Search filters
 * the list; clicking a transcript loads the full text with in-transcript find.
 * Renders nothing when the user has no past transcripts, so it is safe to drop
 * on any home page. Scoped per-user server-side (ready for Allison + Terri).
 */
import { useEffect, useState, useCallback } from 'react';
import { Archive, Search, Loader2, ChevronDown, ChevronRight, FileText, ExternalLink } from 'lucide-react';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}
const GOLD = '#c88c00';

function assignedLabel(t: any): string {
  if (t.assigned_kind === 'job') return t.assigned_job_name || 'Job';
  if (t.assigned_kind === 'lead') return (t.assigned_lead_name || 'Lead') + ' (lead)';
  return 'Unassigned';
}
function fmtDate(s: string | null): string {
  if (!s) return '';
  try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return s; }
}

// Build React nodes with case-insensitive highlight of `q` in `text`.
function highlight(text: string, q: string) {
  if (!q) return text;
  const parts: any[] = [];
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0, k = 0;
  while (true) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) { parts.push(text.slice(i)); break; }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={k++} style={{ background: 'rgba(200,140,0,0.35)', padding: 0 }}>{text.slice(idx, idx + q.length)}</mark>);
    i = idx + q.length;
  }
  return parts;
}

export default function TranscriptHistory() {
  const [items, setItems] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, any>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [findQuery, setFindQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/transcripts/history', { headers: { authorization: `Bearer ${getToken()}` } });
      if (res.ok) { const d = await res.json(); setItems(d.transcripts || []); }
    } finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function openTranscript(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id); setFindQuery('');
    if (!detail[id]) {
      setLoadingDetail(id);
      try {
        const res = await fetch(`/api/transcripts/${id}`, { headers: { authorization: `Bearer ${getToken()}` } });
        if (res.ok) { const d = await res.json(); setDetail((m) => ({ ...m, [id]: d.transcript })); }
      } finally { setLoadingDetail(null); }
    }
  }

  if (!loaded || items.length === 0) return null;

  const q = listQuery.trim().toLowerCase();
  const filtered = q
    ? items.filter((t) => `${t.title || ''} ${assignedLabel(t)} ${fmtDate(t.recorded_at)}`.toLowerCase().includes(q))
    : items;

  return (
    <div style={{ marginBottom: 6, borderRadius: 8, border: '1px solid rgba(200,140,0,0.12)', overflow: 'hidden', background: '#ffffff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgba(200,140,0,0.08)' }}>
        <Archive size={14} style={{ color: GOLD }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: GOLD, letterSpacing: '0.04em' }}>PAST TRANSCRIPTS ({items.length})</span>
      </div>

      <div style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, border: '1px solid rgba(200,140,0,0.2)', borderRadius: 6, padding: '5px 8px' }}>
          <Search size={13} style={{ color: '#8a8078' }} />
          <input
            type="text" placeholder="Search by title, job, or date..." value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, color: '#2a2520', background: 'transparent' }}
          />
        </div>

        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {filtered.map((t) => {
            const isOpen = openId === t.id;
            const d = detail[t.id];
            return (
              <div key={t.id} style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                <div onClick={() => openTranscript(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', cursor: 'pointer' }}>
                  {isOpen ? <ChevronDown size={14} style={{ color: GOLD, flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: '#8a8078', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#2a2520', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title || 'Untitled meeting'}</div>
                    <div style={{ fontSize: 10, color: '#6a6058', display: 'flex', gap: 10, marginTop: 1 }}>
                      <span style={{ color: GOLD, fontWeight: 600 }}>{assignedLabel(t)}</span>
                      <span>{fmtDate(t.recorded_at)}</span>
                      {t.status === 'failed' && <span style={{ color: '#ef4444' }}>needs retry</span>}
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ padding: '4px 4px 12px 26px' }}>
                    {loadingDetail === t.id && <div style={{ fontSize: 12, color: '#6a6058', display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={12} className="animate-spin" /> Loading transcript...</div>}
                    {d && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, border: '1px solid rgba(200,140,0,0.2)', borderRadius: 6, padding: '4px 8px' }}>
                          <Search size={12} style={{ color: '#8a8078' }} />
                          <input
                            type="text" placeholder="Find in this transcript..." value={findQuery}
                            onChange={(e) => setFindQuery(e.target.value)}
                            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, color: '#2a2520', background: 'transparent' }}
                          />
                        </div>
                        <div style={{ maxHeight: '40vh', overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, color: '#3a352f', background: '#faf8f5', borderRadius: 6, padding: '8px 10px' }}>
                          {highlight(d.raw_transcript || '(transcript text unavailable)', findQuery.trim())}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div style={{ fontSize: 12, color: '#8a8078', padding: '8px 4px' }}>No transcripts match "{listQuery}".</div>}
        </div>
      </div>
    </div>
  );
}

// @ts-nocheck
'use client';

/**
 * Transcripts dashboard — team-wide archive of meeting transcripts, organized by
 * job, with filters, full-text view + in-transcript find, and AI search over the
 * filtered scope. The unassigned "needs categorizing" queue lives at the top.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Mic, Search, Loader2, ChevronDown, ChevronRight, Sparkles, Briefcase, RefreshCw, Filter } from 'lucide-react';
import TranscriptsToConfirm from '@/app/dashboard/components/TranscriptsToConfirm';

function getToken() { return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : ''; }
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
function highlight(text: string, q: string) {
  if (!q) return text;
  const parts: any[] = []; const lower = text.toLowerCase(); const ql = q.toLowerCase();
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

export default function TranscriptsDashboardPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [jobFilter, setJobFilter] = useState('all');
  const [recorderFilter, setRecorderFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, any>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [findQuery, setFindQuery] = useState('');
  // AI search
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiSources, setAiSources] = useState<any[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const refreshAll = useCallback(() => { setReloadKey((k) => k + 1); }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/transcripts/history?scope=all', { headers: { authorization: `Bearer ${getToken()}` } });
      if (res.ok) { const d = await res.json(); setItems(d.transcripts || []); }
    } finally { setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Auto-check for newly delivered transcripts every 60s while the tab is open.
  useEffect(() => {
    const iv = setInterval(() => { load(); setReloadKey((k) => k + 1); }, 60000);
    return () => clearInterval(iv);
  }, [load]);

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

  // Distinct jobs + recorders for the filter dropdowns.
  const jobOptions = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((t) => { const label = assignedLabel(t); const key = t.assigned_kind === 'job' && t.assigned_job_id ? t.assigned_job_id : label; m.set(key, label); });
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);
  const recorderOptions = useMemo(() => Array.from(new Set(items.map((t) => t.recorded_by_user).filter(Boolean))).sort(), [items]);

  const filtered = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return items.filter((t) => {
      if (jobFilter !== 'all') {
        const key = t.assigned_kind === 'job' && t.assigned_job_id ? t.assigned_job_id : assignedLabel(t);
        if (key !== jobFilter) return false;
      }
      if (recorderFilter !== 'all' && t.recorded_by_user !== recorderFilter) return false;
      if (dateFrom || dateTo) {
        if (!t.recorded_at) return false;
        const d = new Date(t.recorded_at).getTime();
        if (dateFrom && d < new Date(dateFrom + 'T00:00:00').getTime()) return false;
        if (dateTo && d > new Date(dateTo + 'T23:59:59').getTime()) return false;
      }
      if (q && !`${t.title || ''} ${assignedLabel(t)} ${fmtDate(t.recorded_at)} ${t.recorded_by_user || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, listQuery, jobFilter, recorderFilter, dateFrom, dateTo]);

  const activeFilters = jobFilter !== 'all' || recorderFilter !== 'all' || !!dateFrom || !!dateTo || !!listQuery.trim();
  function clearFilters() { setListQuery(''); setJobFilter('all'); setRecorderFilter('all'); setDateFrom(''); setDateTo(''); }

  // Group filtered transcripts by job label.
  const groups = useMemo(() => {
    const g = new Map<string, any[]>();
    filtered.forEach((t) => { const label = assignedLabel(t); if (!g.has(label)) g.set(label, []); g.get(label).push(t); });
    return Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  async function runAiSearch() {
    const question = aiQuestion.trim();
    if (!question) return;
    setAiLoading(true); setAiAnswer(''); setAiSources([]);
    const payload: any = { question };
    if (jobFilter !== 'all' && jobFilter.length > 1 && items.some((t) => t.assigned_job_id === jobFilter)) payload.jobId = jobFilter;
    else payload.transcriptIds = filtered.map((t) => t.id);
    try {
      const res = await fetch('/api/transcripts/query', { method: 'POST', headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await res.json();
      setAiAnswer(d.answer || d.error || 'No answer.'); setAiSources(d.sources || []);
    } catch (e: any) { setAiAnswer('Search failed: ' + (e?.message || 'unknown')); }
    finally { setAiLoading(false); }
  }

  const inputStyle = { fontSize: 13, padding: '7px 9px', borderRadius: 6, border: '1px solid rgba(200,140,0,0.2)', background: '#fff', color: '#2a2520', outline: 'none' } as const;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '4px 4px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Mic size={20} style={{ color: GOLD }} />
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#2a2520', margin: 0 }}>Transcripts</h1>
        <button onClick={() => { load(); refreshAll(); }} title="Check for new transcripts" style={{ marginLeft: 'auto', padding: 6, borderRadius: 6, background: 'rgba(200,140,0,0.08)', border: 'none', cursor: 'pointer', lineHeight: 0 }}><RefreshCw size={14} style={{ color: GOLD }} /></button>
      </div>
      <p style={{ fontSize: 12, color: '#6a6058', marginTop: 0, marginBottom: 12 }}>Every meeting transcript, organized by job. New transcripts appear automatically (checked every minute) or hit refresh. Filter to find a conversation, then read it or ask the AI about it.</p>

      {/* Needs categorizing */}
      <TranscriptsToConfirm scopeAll reloadKey={reloadKey} />

      {/* AI search */}
      <div style={{ marginBottom: 12, borderRadius: 8, border: '1px solid rgba(200,140,0,0.2)', background: '#fffdf8', padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Sparkles size={14} style={{ color: GOLD }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: GOLD, letterSpacing: '0.04em' }}>AI SEARCH</span>
          <span style={{ fontSize: 10, color: '#8a8078' }}>{jobFilter === 'all' ? `across ${filtered.length} filtered transcript(s)` : `within ${jobOptions.find(([k]) => k === jobFilter)?.[1] || 'selection'}`}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input type="text" value={aiQuestion} onChange={(e) => setAiQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runAiSearch(); }}
            placeholder="Ask a question, e.g. what did the client decide about the kitchen island?"
            style={{ ...inputStyle, flex: 1 }} />
          <button onClick={runAiSearch} disabled={aiLoading || !aiQuestion.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 6, border: 'none', background: aiQuestion.trim() ? GOLD : '#e8e5e0', color: '#fff', fontSize: 13, fontWeight: 600, cursor: aiQuestion.trim() ? 'pointer' : 'default' }}>
            {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Ask
          </button>
        </div>
        {(aiAnswer || aiLoading) && (
          <div style={{ marginTop: 8, fontSize: 13, color: '#2a2520', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {aiLoading ? <span style={{ color: '#6a6058' }}>Searching transcripts...</span> : aiAnswer}
            {aiSources.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#6a6058' }}>
                Sources: {aiSources.map((s) => `${s.title} (${s.date})`).join('; ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 10, borderRadius: 8, border: '1px solid rgba(200,140,0,0.12)', background: '#fff', padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Filter size={13} style={{ color: GOLD }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: GOLD, letterSpacing: '0.04em' }}>FILTERS</span>
          <span style={{ fontSize: 10, color: '#8a8078' }}>showing {filtered.length} of {items.length}</span>
          {activeFilters && <button onClick={clearFilters} style={{ marginLeft: 'auto', fontSize: 11, color: GOLD, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Clear all</button>}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 200 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#6a6058' }}>SEARCH</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(200,140,0,0.2)', borderRadius: 6, padding: '6px 8px' }}>
              <Search size={13} style={{ color: '#8a8078' }} />
              <input type="text" placeholder="Title, keyword..." value={listQuery} onChange={(e) => setListQuery(e.target.value)} style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, background: 'transparent', color: '#2a2520' }} />
            </div>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 150 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#6a6058' }}>JOB</span>
            <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} style={inputStyle}>
              <option value="all">All jobs</option>
              {jobOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 130 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#6a6058' }}>RECORDED BY</span>
            <select value={recorderFilter} onChange={(e) => setRecorderFilter(e.target.value)} style={inputStyle}>
              <option value="all">Everyone</option>
              {recorderOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#6a6058' }}>FROM</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#6a6058' }}>TO</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
          </label>
        </div>
      </div>

      {/* Grouped archive */}
      {!loaded && <div style={{ fontSize: 13, color: '#6a6058', display: 'flex', alignItems: 'center', gap: 6 }}><Loader2 size={14} className="animate-spin" /> Loading transcripts...</div>}
      {loaded && filtered.length === 0 && <div style={{ fontSize: 13, color: '#8a8078', padding: '12px 0' }}>No transcripts found. Confirmed transcripts will appear here grouped by job.</div>}

      {groups.map(([jobLabel, rows]) => (
        <div key={jobLabel} style={{ marginBottom: 10, borderRadius: 8, border: '1px solid rgba(200,140,0,0.12)', overflow: 'hidden', background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(200,140,0,0.05)', borderBottom: '1px solid rgba(200,140,0,0.08)' }}>
            <Briefcase size={13} style={{ color: GOLD }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#2a2520' }}>{jobLabel}</span>
            <span style={{ fontSize: 11, color: '#8a8078' }}>({rows.length})</span>
          </div>
          <div style={{ padding: '4px 10px' }}>
            {rows.map((t) => {
              const isOpen = openId === t.id; const d = detail[t.id];
              return (
                <div key={t.id} style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                  <div onClick={() => openTranscript(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', cursor: 'pointer' }}>
                    {isOpen ? <ChevronDown size={14} style={{ color: GOLD, flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: '#8a8078', flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#2a2520', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title || 'Untitled meeting'}</div>
                      <div style={{ fontSize: 10, color: '#6a6058', display: 'flex', gap: 10, marginTop: 1 }}>
                        <span>{fmtDate(t.recorded_at)}</span>
                        {t.recorded_by_user && <span>by {t.recorded_by_user}</span>}
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
                            <input type="text" placeholder="Find in this transcript..." value={findQuery} onChange={(e) => setFindQuery(e.target.value)} style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, color: '#2a2520', background: 'transparent' }} />
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
          </div>
        </div>
      ))}
    </div>
  );
}

// @ts-nocheck
'use client';

/**
 * Transcripts dashboard — team-wide archive of meeting transcripts, organized by
 * job, with filters, full-text view + in-transcript find, and AI search over the
 * filtered scope. The unassigned "needs categorizing" queue lives at the top.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Mic, Search, Loader2, ChevronDown, ChevronRight, Sparkles, Briefcase, RefreshCw, Filter, AlertTriangle, Repeat } from 'lucide-react';
import TranscriptsToConfirm from '@/app/dashboard/components/TranscriptsToConfirm';
import { formatContent } from '@/app/hooks/useAskAgent';

/**
 * Render an AI-generated answer as proper HTML elements instead of leaking
 * raw markdown (`**bold**`, `## headings`, `- bullets`). Reuses the
 * formatContent helper that the Ask Agent uses so styling stays consistent.
 *
 * Falls back to plain text for anything we don't recognize.
 */
function RenderAnswer({ content }: { content: string }) {
  const elements = formatContent(content);
  return (
    <div style={{ fontSize: 13, color: '#2a2520', lineHeight: 1.55 }}>
      {elements.map((el: any) => {
        if (el.type === 'code') {
          return (
            <pre
              key={el.key}
              style={{
                margin: '6px 0', padding: '8px 10px', borderRadius: 6,
                background: '#faf8f5', border: '1px solid rgba(200,140,0,0.15)',
                fontSize: 12, lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre-wrap',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: '#3a352f',
              }}
            >{el.content}</pre>
          );
        }
        if (el.type === 'h2') {
          return (
            <div key={el.key} style={{ fontSize: 14, fontWeight: 700, color: '#c88c00', marginTop: 10, marginBottom: 4 }}
              dangerouslySetInnerHTML={{ __html: el.html }} />
          );
        }
        if (el.type === 'h3') {
          return (
            <div key={el.key} style={{ fontSize: 13, fontWeight: 600, color: '#2a2520', marginTop: 8, marginBottom: 2 }}
              dangerouslySetInnerHTML={{ __html: el.html }} />
          );
        }
        if (el.type === 'bullet') {
          return (
            <div key={el.key} style={{ marginLeft: 14, marginBottom: 2 }}
              dangerouslySetInnerHTML={{ __html: '&bull;&nbsp;' + el.html }} />
          );
        }
        if (el.type === 'numbered') {
          return (
            <div key={el.key} style={{ marginLeft: 14, marginBottom: 2 }}
              dangerouslySetInnerHTML={{ __html: el.html }} />
          );
        }
        if (el.type === 'hr') {
          return <hr key={el.key} style={{ margin: '8px 0', borderColor: 'rgba(200,140,0,0.15)' }} />;
        }
        if (el.type === 'spacer') {
          return <div key={el.key} style={{ height: 4 }} />;
        }
        return (
          <div key={el.key} style={{ marginBottom: 2 }} dangerouslySetInnerHTML={{ __html: el.html }} />
        );
      })}
    </div>
  );
}

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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
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
  // Per-row retry state. Tracks the in-flight transcript id and any error
  // returned by the retry endpoint so we can show it inline on the row.
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<Record<string, string>>({});

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

  /**
   * Trigger the daily-log generation for a transcript.
   * - mode='retry'  retries a failed transcript (current behavior)
   * - mode='regenerate'  deletes the existing JT daily log and creates a fresh
   *   one from scratch with the latest summary cap + prompt. Used when a prior
   *   summary was truncated (the 8000-char cap was below JT's real 10K limit).
   *   Asks for confirmation since it does mutate JT (deletes the old log).
   */
  async function retryTranscript(id: string, mode: 'retry' | 'regenerate' = 'retry') {
    if (mode === 'regenerate') {
      const ok = window.confirm(
        'Regenerate this daily log? This will delete the existing JT daily log and create a new one with the latest summary. Continue?',
      );
      if (!ok) return;
    }
    setRetryingId(id);
    setRetryError((m) => { const next = { ...m }; delete next[id]; return next; });
    try {
      const qs = mode === 'regenerate' ? '?force=1' : '';
      const res = await fetch(`/api/transcripts/${id}/retry${qs}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}` },
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setRetryError((m) => ({ ...m, [id]: json?.error || `Failed (HTTP ${res.status})` }));
      } else {
        await load();
      }
    } catch (err: any) {
      setRetryError((m) => ({ ...m, [id]: `Network error: ${err?.message || 'unknown'}` }));
    } finally {
      setRetryingId(null);
    }
  }

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
  // Groups are collapsed by default; an active text search auto-expands them.
  const groupOpen = (label: string) => !!openGroups[label] || !!listQuery.trim();

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
          {(() => {
            // Show how many transcripts the AI will actually look at, not just
            // how many are visible. A transcript is only searchable if it has
            // raw_transcript text (the server enforces this too).
            const searchable = filtered.filter((t) => t.status !== 'pending' && t.status !== 'unassigned');
            const where = jobFilter === 'all'
              ? `${searchable.length} of ${filtered.length} filtered`
              : `within ${jobOptions.find(([k]) => k === jobFilter)?.[1] || 'selection'} (${searchable.length} ready)`;
            return <span style={{ fontSize: 10, color: '#8a8078' }}>{where}</span>;
          })()}
        </div>
        {/* Multi-line input so long prompts stay visible while the user types.
            Enter inserts a newline (natural for a textarea); Cmd/Ctrl+Enter
            submits the question. The Ask button is always available too. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            value={aiQuestion}
            onChange={(e) => setAiQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                runAiSearch();
              }
            }}
            rows={3}
            placeholder="Ask a question, e.g. what did the client decide about the kitchen island? (Cmd/Ctrl + Enter to submit, Enter for newline)"
            style={{
              ...inputStyle,
              flex: 1,
              minHeight: 64,
              resize: 'vertical',
              fontFamily: 'inherit',
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
            }}
          />
          <button
            onClick={runAiSearch}
            disabled={aiLoading || !aiQuestion.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 6, border: 'none', background: aiQuestion.trim() ? GOLD : '#e8e5e0', color: '#fff', fontSize: 13, fontWeight: 600, cursor: aiQuestion.trim() ? 'pointer' : 'default' }}
          >
            {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Ask
          </button>
        </div>
        {(aiAnswer || aiLoading) && (
          <div style={{ marginTop: 8 }}>
            {aiLoading ? (
              <div style={{ fontSize: 13, color: '#6a6058', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={13} className="animate-spin" /> Searching transcripts...
              </div>
            ) : (
              <RenderAnswer content={aiAnswer} />
            )}
            {!aiLoading && aiSources.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(200,140,0,0.12)', fontSize: 11, color: '#6a6058' }}>
                <span style={{ fontWeight: 600, color: '#8a8078' }}>Sources:</span> {aiSources.map((s) => `${s.title} (${s.date})`).join('; ')}
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
          <div onClick={() => setOpenGroups((g) => ({ ...g, [jobLabel]: !groupOpen(jobLabel) }))} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(200,140,0,0.05)', borderBottom: groupOpen(jobLabel) ? '1px solid rgba(200,140,0,0.08)' : 'none', cursor: 'pointer' }}>
            {groupOpen(jobLabel) ? <ChevronDown size={14} style={{ color: GOLD }} /> : <ChevronRight size={14} style={{ color: '#8a8078' }} />}
            <Briefcase size={13} style={{ color: GOLD }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#2a2520' }}>{jobLabel}</span>
            <span style={{ fontSize: 11, color: '#8a8078' }}>({rows.length})</span>
          </div>
          {groupOpen(jobLabel) && (
          <div style={{ padding: '4px 10px' }}>
            {rows.map((t) => {
              const isOpen = openId === t.id; const d = detail[t.id];
              return (
                <div key={t.id} style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px' }}>
                    <div onClick={() => openTranscript(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, cursor: 'pointer' }}>
                      {isOpen ? <ChevronDown size={14} style={{ color: GOLD, flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: '#8a8078', flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#2a2520', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title || 'Untitled meeting'}</div>
                        <div style={{ fontSize: 10, color: '#6a6058', display: 'flex', gap: 10, marginTop: 1 }}>
                          <span>{fmtDate(t.recorded_at)}</span>
                          {t.recorded_by_user && <span>by {t.recorded_by_user}</span>}
                          {t.status === 'failed' && <span style={{ color: '#ef4444' }}>needs retry</span>}
                          {t.status === 'processing' && <span style={{ color: '#c88c00' }}>processing</span>}
                          {t.assigned_kind === 'job' && t.jt_daily_log_id && (
                            <span style={{ color: '#1e6b35' }}>daily log created</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Retry button: only on job-assigned failed rows. */}
                    {t.status === 'failed' && t.assigned_kind === 'job' && t.assigned_job_id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); retryTranscript(t.id); }}
                        disabled={retryingId === t.id}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 8px', borderRadius: 5,
                          border: '1px solid rgba(200,140,0,0.4)',
                          background: '#fffdf8', color: '#8a4f00',
                          fontSize: 11, fontWeight: 600, cursor: retryingId === t.id ? 'default' : 'pointer',
                          opacity: retryingId === t.id ? 0.5 : 1, flexShrink: 0,
                        }}
                        title="Re-run the daily-log creation step for this meeting."
                      >
                        {retryingId === t.id ? <Loader2 size={11} className="animate-spin" /> : <Repeat size={11} />}
                        {retryingId === t.id ? 'Retrying...' : 'Retry'}
                      </button>
                    )}
                    {/* Regenerate button: for processed rows that already have
                        a JT daily log. Deletes the old log and creates a new
                        one with the latest summary cap + prompt. */}
                    {t.status === 'processed' && t.assigned_kind === 'job' && t.assigned_job_id && t.jt_daily_log_id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); retryTranscript(t.id, 'regenerate'); }}
                        disabled={retryingId === t.id}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 8px', borderRadius: 5,
                          border: '1px solid rgba(80,80,80,0.25)',
                          background: '#ffffff', color: '#5a5550',
                          fontSize: 11, fontWeight: 600, cursor: retryingId === t.id ? 'default' : 'pointer',
                          opacity: retryingId === t.id ? 0.5 : 1, flexShrink: 0,
                        }}
                        title="Delete the existing JT daily log and regenerate with the latest summary settings."
                      >
                        {retryingId === t.id ? <Loader2 size={11} className="animate-spin" /> : <Repeat size={11} />}
                        {retryingId === t.id ? 'Working...' : 'Regenerate'}
                      </button>
                    )}
                  </div>
                  {retryError[t.id] && (
                    <div
                      role="alert"
                      style={{
                        margin: '0 4px 8px 26px', padding: '6px 8px', borderRadius: 5,
                        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                        color: '#b91c1c', fontSize: 11, display: 'flex', alignItems: 'flex-start', gap: 6,
                      }}
                    >
                      <AlertTriangle size={11} style={{ marginTop: 1, flexShrink: 0 }} />
                      <span style={{ flex: 1 }}>{retryError[t.id]}</span>
                      <button
                        onClick={() => setRetryError((m) => { const n = { ...m }; delete n[t.id]; return n; })}
                        aria-label="Dismiss"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 12, padding: 0 }}
                      >×</button>
                    </div>
                  )}
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
          )}
        </div>
      ))}
    </div>
  );
}

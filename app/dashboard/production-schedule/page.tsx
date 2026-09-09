// @ts-nocheck
'use client';

/**
 * Production Schedule — cross-job milestone projection.
 *
 * Reads /api/dashboard/production-schedule (the Claude-managed
 * "🤖 PRODUCTION MILESTONES" group in every open job) and lays the
 * milestones out two ways:
 *
 *   • Gantt   — one lane-stacked row per job across a zoomable timeline,
 *               with a per-week workload strip underneath (how many jobs
 *               are active that week vs. a capacity target).
 *   • Month   — a month-grid calendar with each job's milestones drawn as
 *               colored bands across the days, Google-Calendar style.
 *
 * Baseline (JobTread Schedule Settings > Baseline) renders as a ghost bar
 * beneath the current bar where it exists, so slip is visible at a glance.
 *
 * Job selection and the capacity target persist per browser in localStorage.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, RefreshCw, ExternalLink, CalendarDays, GanttChartSquare, ChevronLeft, ChevronRight,
  AlertTriangle, X, Crosshair, Maximize2, Lock, LockOpen, Eraser, Check, CalendarClock, Link2, Link2Off,
} from 'lucide-react';
import { useAccess } from '../../hooks/useAccess';

// ============================================================
// Types
// ============================================================

type Milestone = {
  id: string; name: string; description: string | null;
  start: string | null; end: string | null;
  baselineStart: string | null; baselineEnd: string | null;
  progress: number; taskType: string | null;
};
type Job = {
  id: string; number: string; name: string; clientName: string; status: string | null;
  projectManager: string | null; contractValue: number; color: string; jtUrl: string;
  start: string | null; end: string | null; baselineStart: string | null; baselineEnd: string | null;
  hasBaseline: boolean; slipDays: number | null; tentative: boolean; anchorDate: string | null;
  linkedCount: number; linkableCount: number; fullyLinked: boolean;
  milestoneCount: number; completedMilestones: number; milestones: Milestone[];
};
type Payload = {
  generatedAt: string; groupName: string; jobCount: number; milestoneCount: number;
  range: { start: string | null; end: string | null }; warnings: string[]; jobs: Job[];
};

// ============================================================
// Date helpers (all in whole UTC days so DST never shifts a bar)
// ============================================================

const DAY_MS = 86400000;
function dayIdx(s: string | null | undefined): number | null {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}
function idxToDate(i: number): Date { return new Date(i * DAY_MS); }
function todayIdx(): number {
  const n = new Date();
  return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY_MS);
}
function fmtShort(s: string | null): string {
  const i = dayIdx(s); if (i === null) return '—';
  return idxToDate(i).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function fmtLong(s: string | null): string {
  const i = dayIdx(s); if (i === null) return '—';
  return idxToDate(i).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function fmtMonthYear(i: number): string {
  return idxToDate(i).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function dow(i: number): number { return idxToDate(i).getUTCDay(); } // 0 = Sun
function mondayOf(i: number): number { const d = dow(i); return i - ((d + 6) % 7); }
function money(n: number): string {
  if (!n) return '—';
  return n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;
}
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Assign overlapping intervals to lanes (greedy, by start).
function assignLanes<T extends { s: number; e: number }>(items: T[]): { item: T; lane: number }[] {
  const sorted = [...items].sort((a, b) => a.s - b.s || a.e - b.e);
  const laneEnds: number[] = [];
  return sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end < item.s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.e); } else laneEnds[lane] = item.e;
    return { item, lane };
  });
}

function getAuthToken() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
  return `Bearer ${token}`;
}
function lsGet<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(k: string, v: any) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ============================================================
// Constants
// ============================================================

const MAROON = '#68050a', GOLD = '#c88c00', BG = '#faf8f5', INK = '#1f1a17', MUTED = '#7a716b', LINE = '#e8e2da';
const ZOOMS = { day: { px: 22, label: 'Day' }, week: { px: 9, label: 'Week' }, month: { px: 3.2, label: 'Month' } } as const;
type Zoom = keyof typeof ZOOMS;
const NAME_COL = 230;
const LANE_PX = 18, LANE_GAP = 3, ROW_PAD = 8, MIN_ROW = 52;
const LS_JOBS = 'bkb-prodsched-jobs', LS_CAP = 'bkb-prodsched-capacity', LS_VIEW = 'bkb-prodsched-view', LS_ZOOM = 'bkb-prodsched-zoom';

// ============================================================
// Page
// ============================================================

export default function ProductionSchedulePage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null); // null = all
  const [view, setView] = useState<'gantt' | 'month'>('gantt');
  const [zoom, setZoom] = useState<Zoom>('week');
  const [capacity, setCapacity] = useState<number>(3);
  const [showBaseline, setShowBaseline] = useState(true);
  const [popup, setPopup] = useState<{ job: Job; m: Milestone } | null>(null);
  const [baselineJob, setBaselineJob] = useState<Job | null>(null);
  const { access } = useAccess();
  const canWrite = !!access && (access.role === 'owner' || (access.features || []).includes('jt_write'));
  const [monthCursor, setMonthCursor] = useState<number>(() => { const t = todayIdx(); const d = idxToDate(t); return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY_MS); });

  useEffect(() => {
    const savedJobs = lsGet<string[] | null>(LS_JOBS, null);
    if (savedJobs) setSelected(new Set(savedJobs));
    setCapacity(lsGet<number>(LS_CAP, 3));
    setView(lsGet<'gantt' | 'month'>(LS_VIEW, 'gantt'));
    setZoom(lsGet<Zoom>(LS_ZOOM, 'week'));
    load();
  }, []);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/production-schedule', { headers: { Authorization: getAuthToken() }, cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e: any) { setError(e.message || 'Failed to load'); }
    finally { setLoading(false); setRefreshing(false); }
  }

  const jobs = data?.jobs || [];
  const isSelected = (id: string) => selected === null || selected.has(id);
  const shown = useMemo(() => jobs.filter((j) => isSelected(j.id)), [jobs, selected]);

  function toggleJob(id: string) {
    const next = new Set(selected === null ? jobs.map((j) => j.id) : selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    const all = next.size === jobs.length;
    setSelected(all ? null : next);
    lsSet(LS_JOBS, all ? null : [...next]);
  }
  function selectAll() { setSelected(null); lsSet(LS_JOBS, null); }
  function selectNone() { setSelected(new Set()); lsSet(LS_JOBS, []); }
  function onlyJob(id: string) { setSelected(new Set([id])); lsSet(LS_JOBS, [id]); }

  const setViewP = (v: 'gantt' | 'month') => { setView(v); lsSet(LS_VIEW, v); };
  const setZoomP = (z: Zoom) => { setZoom(z); lsSet(LS_ZOOM, z); };
  const setCapP = (n: number) => { const v = Math.max(1, Math.min(20, n || 1)); setCapacity(v); lsSet(LS_CAP, v); };

  // ---------- header ----------
  const withBaseline = shown.filter((j) => j.hasBaseline).length;
  const totalValue = shown.reduce((s, j) => s + (j.contractValue || 0), 0);

  return (
    <div style={{ padding: '20px 24px', background: BG, minHeight: '100vh', color: INK, fontFamily: 'inherit' }}>
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: MAROON }}>Production Schedule</h1>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
            Projected milestones from the Claude-managed <b>🤖 PRODUCTION MILESTONES</b> group in each job. Solid = current dates, ghost = baseline.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Seg options={[{ v: 'gantt', label: 'Timeline', icon: GanttChartSquare }, { v: 'month', label: 'Month', icon: CalendarDays }]} value={view} onChange={setViewP} />
          <button onClick={() => load(true)} disabled={refreshing} title="Refresh from JobTread" style={btn()}>
            <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : undefined }} /> Refresh
          </button>
        </div>
      </div>

      {error && <div style={{ background: '#fdecec', border: '1px solid #f3b4b4', color: '#8a1c1c', padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {data?.warnings?.length ? (
        <div style={{ background: '#fff7e6', border: `1px solid ${hexA(GOLD, 0.5)}`, padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#6b4a00', display: 'flex', gap: 8 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>{data.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: MUTED, padding: 40, justifyContent: 'center' }}><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Loading milestones from JobTread…</div>
      ) : jobs.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTED }}>No open jobs carry a 🤖 PRODUCTION MILESTONES group yet. Run the production-schedule task on a job and it will appear here.</div>
      ) : (
        <>
          {/* Job picker */}
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 }}>Jobs</span>
              <button onClick={selectAll} style={chip(selected === null, MAROON)}>All ({jobs.length})</button>
              <button onClick={selectNone} style={chip(selected !== null && selected.size === 0, MUTED)}>None</button>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: MUTED }}>
                Showing <b style={{ color: INK }}>{shown.length}</b> job{shown.length === 1 ? '' : 's'} · {shown.reduce((s, j) => s + j.milestoneCount, 0)} milestones · {withBaseline} with baseline · {money(totalValue)} contract value
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {jobs.map((j) => {
                const on = isSelected(j.id);
                return (
                  <button key={j.id} onClick={() => toggleJob(j.id)} onDoubleClick={() => onlyJob(j.id)} title={`${j.clientName}\n${fmtShort(j.start)} → ${fmtShort(j.end)}${j.projectManager ? `\nPM: ${j.projectManager}` : ''}\nDouble-click to show only this job`}
                    style={{ ...chip(on, j.color), display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: on ? '#fff' : j.color, opacity: on ? 0.9 : 1, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600 }}>{j.number}</span>
                    <span>{j.name}</span>
                    <span style={{ opacity: 0.75, fontSize: 11 }}>{fmtShort(j.start)}–{fmtShort(j.end)}</span>
                    {j.slipDays !== null && j.slipDays !== 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: on ? 'rgba(255,255,255,0.25)' : j.slipDays > 0 ? '#fdecec' : '#e7f6ec', color: on ? '#fff' : j.slipDays > 0 ? '#a11' : '#176b3a' }}>
                        {j.slipDays > 0 ? `+${j.slipDays}d` : `${j.slipDays}d`}
                      </span>
                    )}
                    {canWrite && (
                      <span role="button" onClick={(e) => { e.stopPropagation(); setBaselineJob(j); }} title={j.hasBaseline ? 'Baseline locked — click to re-baseline or clear' : 'No baseline — click to lock one in'}
                        style={{ display: 'inline-flex', alignItems: 'center', opacity: j.hasBaseline ? 0.95 : 0.55, marginLeft: 2 }}>
                        {j.hasBaseline ? <Lock size={11} /> : <LockOpen size={11} />}
                        {!j.fullyLinked && j.linkableCount > 0 && <Link2Off size={11} style={{ marginLeft: 3 }} title="Milestones not linked" />}
                      </span>
                    )}
                    {j.tentative && <span title={`Start anchor ${j.anchorDate ? fmtShort(j.anchorDate) : ''} is tentative`} style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: on ? 'rgba(255,255,255,0.25)' : '#f3efe8', color: on ? '#fff' : MUTED, letterSpacing: 0.3 }}>TENTATIVE</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {view === 'gantt' ? (
            <Gantt jobs={shown} zoom={zoom} setZoom={setZoomP} capacity={capacity} setCapacity={setCapP} showBaseline={showBaseline} setShowBaseline={setShowBaseline} onPick={(job, m) => setPopup({ job, m })} onBaseline={canWrite ? (job) => setBaselineJob(job) : null} />
          ) : (
            <MonthGrid jobs={shown} cursor={monthCursor} setCursor={setMonthCursor} capacity={capacity} onPick={(job, m) => setPopup({ job, m })} />
          )}

          <div style={{ fontSize: 11, color: MUTED, marginTop: 10 }}>
            Updated {data ? new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''} · Milestones are managed by the Claude production-schedule task; edit dates in JobTread on the anchor task and the chain cascades.
          </div>
        </>
      )}

      {popup && <MilestonePopup job={popup.job} m={popup.m} onClose={() => setPopup(null)} onBaseline={canWrite ? () => { const j = popup.job; setPopup(null); setBaselineJob(j); } : null} />}
      {baselineJob && <BaselineModal job={baselineJob} onClose={() => setBaselineJob(null)} onDone={() => { setBaselineJob(null); load(true); }} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ============================================================
// Gantt
// ============================================================

function Gantt({ jobs, zoom, setZoom, capacity, setCapacity, showBaseline, setShowBaseline, onPick, onBaseline }: any) {
  const px = ZOOMS[zoom as Zoom].px;
  const today = todayIdx();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Window: 2 weeks before earliest start → 3 weeks after latest end, always including today.
  const { start, end } = useMemo(() => {
    const idxs = jobs.flatMap((j: Job) => j.milestones.flatMap((m) => [dayIdx(m.start), dayIdx(m.end), dayIdx(m.baselineStart), dayIdx(m.baselineEnd)])).filter((x) => x !== null) as number[];
    const lo = Math.min(today, ...(idxs.length ? idxs : [today]));
    const hi = Math.max(today, ...(idxs.length ? idxs : [today]));
    return { start: mondayOf(lo - 14), end: mondayOf(hi + 21) + 6 };
  }, [jobs, today]);
  const days = end - start + 1;
  const width = days * px;
  const x = (i: number) => (i - start) * px;

  // Month bands + week ticks
  const months = useMemo(() => {
    const out: { s: number; e: number; label: string }[] = [];
    let i = start;
    while (i <= end) {
      const d = idxToDate(i);
      const nextMonth = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS);
      out.push({ s: i, e: Math.min(end, nextMonth - 1), label: d.toLocaleDateString('en-US', { month: zoom === 'month' ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' }) });
      i = nextMonth;
    }
    return out;
  }, [start, end, zoom]);
  const weeks = useMemo(() => { const out: number[] = []; for (let i = mondayOf(start); i <= end; i += 7) out.push(i); return out; }, [start, end]);

  // Workload per week: count jobs with any milestone intersecting the week; sum contract value.
  const workload = useMemo(() => weeks.map((ws) => {
    const we = ws + 6;
    const active = jobs.filter((j: Job) => j.milestones.some((m) => { const s = dayIdx(m.start), e = dayIdx(m.end); return s !== null && e !== null && s <= we && e >= ws; }));
    return { ws, count: active.length, value: active.reduce((s: number, j: Job) => s + (j.contractValue || 0), 0), names: active.map((j: Job) => `${j.number} ${j.name}`) };
  }), [weeks, jobs]);
  const peak = Math.max(1, ...workload.map((w) => w.count));

  // Rows: per job, milestones lane-packed.
  const rows = useMemo(() => jobs.map((j: Job) => {
    const items = j.milestones.map((m) => ({ m, s: dayIdx(m.start) ?? 0, e: dayIdx(m.end) ?? dayIdx(m.start) ?? 0 })).filter((it) => it.s);
    const laned = assignLanes(items);
    const lanes = Math.max(1, ...laned.map((l) => l.lane + 1));
    return { job: j, laned, lanes, height: Math.max(MIN_ROW, lanes * (LANE_PX + LANE_GAP) - LANE_GAP + ROW_PAD * 2 + (showBaseline && j.hasBaseline ? 6 : 0)) };
  }), [jobs, showBaseline]);

  const scrollToToday = () => { const el = scrollRef.current; if (el) el.scrollLeft = Math.max(0, x(today) - el.clientWidth * 0.3); };
  useEffect(() => { scrollToToday(); }, [zoom, jobs.length]);

  const HEAD_H = 26 + 22;
  const showDays = zoom === 'day';

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${LINE}`, flexWrap: 'wrap' }}>
        <Seg options={(Object.keys(ZOOMS) as Zoom[]).map((z) => ({ v: z, label: ZOOMS[z].label }))} value={zoom} onChange={setZoom} small />
        <button onClick={scrollToToday} style={btn(true)}><Crosshair size={13} /> Today</button>
        <button onClick={() => { const el = scrollRef.current; if (el) el.scrollLeft = 0; }} style={btn(true)}><Maximize2 size={13} /> Start</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED, cursor: 'pointer' }}>
          <input type="checkbox" checked={showBaseline} onChange={(e) => setShowBaseline(e.target.checked)} /> Show baseline
        </label>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED }}>
          Capacity target
          <input type="number" min={1} max={20} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} style={{ width: 48, padding: '3px 6px', border: `1px solid ${LINE}`, borderRadius: 6, fontSize: 12 }} />
          concurrent jobs
        </label>
      </div>

      <div ref={scrollRef} style={{ overflowX: 'auto', overflowY: 'hidden', position: 'relative' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `${NAME_COL}px ${width}px`, minWidth: NAME_COL + width }}>
          {/* header left */}
          <div style={{ position: 'sticky', left: 0, zIndex: 3, background: '#fff', borderRight: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, height: HEAD_H, display: 'flex', alignItems: 'flex-end', padding: '0 12px 6px', fontSize: 11, color: MUTED, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Job</div>
          {/* header right */}
          <div style={{ position: 'relative', height: HEAD_H, borderBottom: `1px solid ${LINE}` }}>
            {months.map((mo) => (
              <div key={mo.s} style={{ position: 'absolute', left: x(mo.s), width: (mo.e - mo.s + 1) * px, top: 0, height: 26, borderLeft: `1px solid ${LINE}`, fontSize: 12, fontWeight: 700, color: MAROON, padding: '5px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', boxSizing: 'border-box' }}>{mo.label}</div>
            ))}
            {weeks.map((w) => (
              <div key={w} style={{ position: 'absolute', left: x(w), width: 7 * px, top: 26, height: 22, borderLeft: `1px solid ${LINE}`, fontSize: 10, color: MUTED, padding: '4px 4px', whiteSpace: 'nowrap', overflow: 'hidden', boxSizing: 'border-box' }}>
                {zoom !== 'month' ? idxToDate(w).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }) : (dow(w) === 1 && idxToDate(w).getUTCDate() <= 7 ? '' : '')}
              </div>
            ))}
            {showDays && Array.from({ length: days }).map((_, k) => { const i = start + k; const wk = dow(i) === 0 || dow(i) === 6; return wk ? <div key={i} style={{ position: 'absolute', left: x(i), width: px, top: 26, height: 22, background: 'rgba(0,0,0,0.03)' }} /> : null; })}
          </div>

          {/* rows */}
          {rows.map(({ job, laned, height }) => (
            <RowPair key={job.id} job={job} height={height} left={
              <div style={{ padding: `${ROW_PAD}px 12px`, display: 'flex', flexDirection: 'column', gap: 2, height, boxSizing: 'border-box', justifyContent: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: job.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.number} · {job.name}</span>
                  <a href={job.jtUrl} target="_blank" rel="noopener noreferrer" title="Open schedule in JobTread" style={{ color: MUTED, lineHeight: 0, flexShrink: 0 }}><ExternalLink size={12} /></a>
                  {onBaseline && (
                    <button onClick={() => onBaseline(job)} title="Set start date · link milestones · baseline" style={{ marginLeft: 'auto', border: `1px solid ${LINE}`, background: job.hasBaseline ? '#f3efe8' : '#fff', color: job.hasBaseline ? INK : MUTED, borderRadius: 6, padding: '1px 5px', fontSize: 10, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                      <CalendarClock size={10} /> Schedule{job.hasBaseline ? <Lock size={9} /> : <LockOpen size={9} />}{!job.fullyLinked && job.linkableCount > 0 ? <Link2Off size={9} /> : null}
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {fmtShort(job.start)} → {fmtShort(job.end)} · {job.milestoneCount} ms{job.projectManager ? ` · ${job.projectManager}` : ''}
                  {job.slipDays !== null && job.slipDays !== 0 && <span style={{ color: job.slipDays > 0 ? '#a11' : '#176b3a', fontWeight: 700 }}> · {job.slipDays > 0 ? `+${job.slipDays}d late` : `${-job.slipDays}d early`}</span>}
                </div>
              </div>
            }>
              {/* grid lines */}
              {weeks.map((w) => <div key={w} style={{ position: 'absolute', left: x(w), top: 0, bottom: 0, borderLeft: `1px solid ${LINE}`, opacity: 0.7 }} />)}
              {showDays && Array.from({ length: days }).map((_, k) => { const i = start + k; return (dow(i) === 0 || dow(i) === 6) ? <div key={i} style={{ position: 'absolute', left: x(i), width: px, top: 0, bottom: 0, background: 'rgba(0,0,0,0.025)' }} /> : null; })}
              {/* baseline ghosts */}
              {showBaseline && laned.map(({ item, lane }) => {
                const bs = dayIdx(item.m.baselineStart), be = dayIdx(item.m.baselineEnd);
                if (bs === null || be === null) return null;
                const top = ROW_PAD + lane * (LANE_PX + LANE_GAP);
                return <div key={`b-${item.m.id}`} title={`Baseline: ${fmtShort(item.m.baselineStart)} → ${fmtShort(item.m.baselineEnd)}`} style={{ position: 'absolute', left: x(bs), width: Math.max(2, (be - bs + 1) * px), top: top + LANE_PX - 2, height: 6, borderRadius: 3, border: `1px dashed ${hexA(job.color, 0.8)}`, background: hexA(job.color, 0.12), boxSizing: 'border-box' }} />;
              })}
              {/* current bars */}
              {laned.map(({ item, lane }) => {
                const w = Math.max(3, (item.e - item.s + 1) * px);
                const top = ROW_PAD + lane * (LANE_PX + LANE_GAP);
                const done = item.m.progress >= 1;
                const late = !done && item.e < today;
                const slip = (dayIdx(item.m.end) ?? 0) - (dayIdx(item.m.baselineEnd) ?? dayIdx(item.m.end) ?? 0);
                return (
                  <div key={item.m.id} onClick={() => onPick(job, item.m)} title={`${item.m.name}\n${fmtShort(item.m.start)} → ${fmtShort(item.m.end)}${item.m.baselineEnd ? `\nBaseline end ${fmtShort(item.m.baselineEnd)} (${slip > 0 ? '+' : ''}${slip}d)` : ''}`}
                    style={{ position: 'absolute', left: x(item.s), width: w, top, height: LANE_PX, borderRadius: 4, background: done ? hexA(job.color, 0.45) : job.color, color: '#fff', fontSize: 11, lineHeight: `${LANE_PX}px`, padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', boxSizing: 'border-box', boxShadow: late ? 'inset 0 0 0 2px #ff5a5a' : undefined, opacity: item.e < today && !done ? 0.9 : 1 }}>
                    {item.m.progress > 0 && item.m.progress < 1 && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(item.m.progress * 100)}%`, background: 'rgba(255,255,255,0.28)' }} />}
                    {w > 40 ? item.m.name : ''}
                  </div>
                );
              })}
              {/* today */}
              {today >= start && today <= end && <div style={{ position: 'absolute', left: x(today) + px / 2, top: 0, bottom: 0, borderLeft: `2px solid ${GOLD}`, zIndex: 1, pointerEvents: 'none' }} />}
            </RowPair>
          ))}

          {/* workload strip */}
          <div style={{ position: 'sticky', left: 0, zIndex: 3, background: '#fff', borderRight: `1px solid ${LINE}`, borderTop: `2px solid ${LINE}`, padding: '8px 12px', fontSize: 12, boxSizing: 'border-box' }}>
            <div style={{ fontWeight: 700, color: MAROON }}>Workload</div>
            <div style={{ color: MUTED, fontSize: 11 }}>Jobs active per week · peak {peak} · target {capacity}</div>
          </div>
          <div style={{ position: 'relative', height: 58, borderTop: `2px solid ${LINE}` }}>
            {workload.map((w) => {
              const over = w.count > capacity;
              const h = Math.max(3, Math.round((w.count / Math.max(peak, capacity)) * 36));
              const bg = w.count === 0 ? 'transparent' : over ? '#d33' : w.count === capacity ? GOLD : hexA(MAROON, 0.35 + 0.5 * (w.count / Math.max(peak, capacity)));
              return (
                <div key={w.ws} title={`Week of ${fmtShort(idxToDate(w.ws).toISOString())}: ${w.count} active job${w.count === 1 ? '' : 's'} (${money(w.value)})\n${w.names.join('\n')}`}
                  style={{ position: 'absolute', left: x(w.ws) + 1, width: 7 * px - 2, bottom: 16, height: h, background: bg, borderRadius: 2 }}>
                  {w.count > 0 && 7 * px > 18 && <span style={{ position: 'absolute', top: -14, left: 0, right: 0, textAlign: 'center', fontSize: 10, fontWeight: 700, color: over ? '#d33' : INK }}>{w.count}</span>}
                </div>
              );
            })}
            {/* capacity line */}
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 16 + Math.round((capacity / Math.max(peak, capacity)) * 36), borderTop: `1px dashed ${hexA(GOLD, 0.9)}`, pointerEvents: 'none' }} />
            {today >= start && today <= end && <div style={{ position: 'absolute', left: x(today) + px / 2, top: 0, bottom: 0, borderLeft: `2px solid ${GOLD}`, pointerEvents: 'none' }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowPair({ job, height, left, children }: any) {
  return (
    <>
      <div style={{ position: 'sticky', left: 0, zIndex: 2, background: '#fff', borderRight: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, height, boxSizing: 'border-box' }}>{left}</div>
      <div style={{ position: 'relative', height, borderBottom: `1px solid ${LINE}`, boxSizing: 'border-box' }}>{children}</div>
    </>
  );
}

// ============================================================
// Month grid
// ============================================================

function MonthGrid({ jobs, cursor, setCursor, capacity, onPick }: any) {
  const today = todayIdx();
  const first = cursor; // 1st of month
  const d = idxToDate(first);
  const nextMonth = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS);
  const gridStart = mondayOf(first);
  const gridEnd = mondayOf(nextMonth - 1) + 6;
  const weeks: number[] = []; for (let w = gridStart; w <= gridEnd; w += 7) weeks.push(w);

  // Per week, per job: segments of milestones intersecting the week; lanes shared across jobs so bands don't collide.
  function weekBands(ws: number) {
    const we = ws + 6;
    const segs: { s: number; e: number; job: Job; m: Milestone; startsHere: boolean; endsHere: boolean }[] = [];
    for (const j of jobs as Job[]) for (const m of j.milestones) {
      const s = dayIdx(m.start), e = dayIdx(m.end); if (s === null || e === null) continue;
      if (s > we || e < ws) continue;
      segs.push({ s: Math.max(s, ws), e: Math.min(e, we), job: j, m, startsHere: s >= ws, endsHere: e <= we });
    }
    // Keep lanes stable per job: sort by job order then start.
    const order = new Map((jobs as Job[]).map((j, i) => [j.id, i]));
    segs.sort((a, b) => (order.get(a.job.id)! - order.get(b.job.id)!) || a.s - b.s);
    return assignLanes(segs);
  }
  const weekActive = (ws: number) => (jobs as Job[]).filter((j) => j.milestones.some((m) => { const s = dayIdx(m.start), e = dayIdx(m.end); return s !== null && e !== null && s <= ws + 6 && e >= ws; })).length;

  const BAND = 17, BAND_GAP = 2, DAY_HEAD = 22;
  const shift = (n: number) => { const dd = idxToDate(cursor); setCursor(Math.floor(Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth() + n, 1) / DAY_MS)); };
  const goToday = () => { const t = idxToDate(today); setCursor(Math.floor(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) / DAY_MS)); };

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${LINE}` }}>
        <button onClick={() => shift(-1)} style={btn(true)}><ChevronLeft size={14} /></button>
        <button onClick={goToday} style={btn(true)}>Today</button>
        <button onClick={() => shift(1)} style={btn(true)}><ChevronRight size={14} /></button>
        <div style={{ fontSize: 16, fontWeight: 700, color: MAROON, marginLeft: 6 }}>{fmtMonthYear(first)}</div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: MUTED }}>Bands = milestones · number on the left of each week = jobs active that week (red when over {capacity})</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 900 }}>
          <div style={{ display: 'grid', gridTemplateColumns: `36px repeat(7, 1fr)`, borderBottom: `1px solid ${LINE}` }}>
            <div />
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => <div key={n} style={{ padding: '6px 8px', fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 }}>{n}</div>)}
          </div>
          {weeks.map((ws) => {
            const bands = weekBands(ws);
            const lanes = Math.max(1, ...bands.map((b) => b.lane + 1));
            const h = DAY_HEAD + lanes * (BAND + BAND_GAP) + 8;
            const active = weekActive(ws);
            return (
              <div key={ws} style={{ display: 'grid', gridTemplateColumns: `36px 1fr`, borderBottom: `1px solid ${LINE}` }}>
                <div title={`${active} job${active === 1 ? '' : 's'} active this week`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: active > capacity ? '#d33' : active === capacity ? GOLD : MUTED, background: active > capacity ? '#fdecec' : 'transparent', borderRight: `1px solid ${LINE}` }}>{active || ''}</div>
                <div style={{ position: 'relative', height: h }}>
                  {/* day cells */}
                  <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                    {Array.from({ length: 7 }).map((_, k) => {
                      const i = ws + k; const inMonth = i >= first && i < nextMonth; const isToday = i === today; const wk = k >= 5;
                      return (
                        <div key={i} style={{ borderLeft: k ? `1px solid ${LINE}` : undefined, background: isToday ? hexA(GOLD, 0.08) : wk ? 'rgba(0,0,0,0.02)' : 'transparent', opacity: inMonth ? 1 : 0.45 }}>
                          <div style={{ fontSize: 12, padding: '4px 8px', fontWeight: isToday ? 800 : 500, color: isToday ? GOLD : inMonth ? INK : MUTED }}>{idxToDate(i).getUTCDate()}{(idxToDate(i).getUTCDate() === 1) ? ` ${idxToDate(i).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}` : ''}</div>
                        </div>
                      );
                    })}
                  </div>
                  {/* bands */}
                  {bands.map(({ item, lane }) => {
                    const leftPct = ((item.s - ws) / 7) * 100, widthPct = ((item.e - item.s + 1) / 7) * 100;
                    const done = item.m.progress >= 1;
                    return (
                      <div key={`${item.m.id}-${ws}`} onClick={() => onPick(item.job, item.m)} title={`${item.job.number} ${item.job.name}\n${item.m.name}\n${fmtShort(item.m.start)} → ${fmtShort(item.m.end)}`}
                        style={{ position: 'absolute', left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, top: DAY_HEAD + lane * (BAND + BAND_GAP), height: BAND, background: done ? hexA(item.job.color, 0.45) : item.job.color, color: '#fff', borderRadius: item.startsHere && item.endsHere ? 4 : item.startsHere ? '4px 0 0 4px' : item.endsHere ? '0 4px 4px 0' : 0, fontSize: 11, lineHeight: `${BAND}px`, padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', boxSizing: 'border-box' }}>
                        <b>{item.job.number}</b> {item.m.name}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Popup
// ============================================================

function MilestonePopup({ job, m, onClose, onBaseline }: { job: Job; m: Milestone; onClose: () => void; onBaseline?: (() => void) | null }) {
  const s = dayIdx(m.start), e = dayIdx(m.end);
  const dur = s !== null && e !== null ? e - s + 1 : null;
  const slipEnd = m.baselineEnd && m.end ? (dayIdx(m.end)! - dayIdx(m.baselineEnd)!) : null;
  const slipStart = m.baselineStart && m.start ? (dayIdx(m.start)! - dayIdx(m.baselineStart)!) : null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(ev) => ev.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 'min(520px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <div style={{ background: job.color, color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, opacity: 0.85 }}>{job.number} · {job.name}{job.projectManager ? ` · ${job.projectManager}` : ''}</div>
            <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.2)', border: 0, color: '#fff', borderRadius: 6, padding: 4, cursor: 'pointer', lineHeight: 0 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, fontSize: 13, display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 8, columnGap: 12 }}>
          <div style={{ color: MUTED }}>Current</div><div>{fmtLong(m.start)} → {fmtLong(m.end)}{dur ? <span style={{ color: MUTED }}> · {dur}d</span> : null}</div>
          <div style={{ color: MUTED }}>Baseline</div>
          <div>{m.baselineStart ? <>{fmtLong(m.baselineStart)} → {fmtLong(m.baselineEnd)}</> : <span style={{ color: MUTED }}>Not captured</span>}</div>
          {slipEnd !== null && (<><div style={{ color: MUTED }}>Slip</div><div style={{ fontWeight: 700, color: slipEnd > 0 ? '#a11' : slipEnd < 0 ? '#176b3a' : INK }}>{slipEnd === 0 && slipStart === 0 ? 'On baseline' : `Start ${slipStart! > 0 ? '+' : ''}${slipStart}d · Finish ${slipEnd > 0 ? '+' : ''}${slipEnd}d`}</div></>)}
          <div style={{ color: MUTED }}>Progress</div><div>{Math.round((m.progress || 0) * 100)}%{m.taskType ? <span style={{ color: MUTED }}> · {m.taskType}</span> : null}</div>
          {m.description && (<><div style={{ color: MUTED }}>Notes</div><div style={{ whiteSpace: 'pre-wrap' }}>{m.description}</div></>)}
          <div style={{ color: MUTED }}>Job window</div><div>{fmtShort(job.start)} → {fmtShort(job.end)}{job.tentative ? <span style={{ color: MUTED }}> · start tentative</span> : ''} · {job.completedMilestones}/{job.milestoneCount} milestones done{job.contractValue ? ` · ${money(job.contractValue)}` : ''}</div>
        </div>
        <div style={{ padding: '0 16px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {onBaseline && <button onClick={onBaseline} style={btn()}><CalendarClock size={13} /> Schedule controls…</button>}
          <a href={job.jtUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn(), textDecoration: 'none', color: INK }}><ExternalLink size={13} /> Open in JobTread</a>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Schedule controls modal — start date (cascade), links, baseline
// ============================================================

function BaselineModal({ job, onClose, onDone }: { job: Job; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [newStart, setNewStart] = useState<string>(job.start || '');
  const [firm, setFirm] = useState<boolean>(!job.tentative);
  const [confirmMove, setConfirmMove] = useState(false);

  const delta = job.start && newStart ? (dayIdx(newStart)! - dayIdx(job.start)!) : 0;
  const newEnd = job.end && newStart ? idxToDate(dayIdx(job.end)! + delta).toISOString().slice(0, 10) : null;
  const startDow = newStart ? dow(dayIdx(newStart)!) : 1;
  const weekend = startDow === 0 || startDow === 6;
  const needsLink = job.linkableCount > 0 && !job.fullyLinked;

  async function call(path: string, body: any, okText: (json: any) => string, key: string) {
    setBusy(key); setResult(null);
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: getAuthToken() }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult({ ok: true, text: okText(json) });
      setTimeout(onDone, 1100);
    } catch (e: any) { setResult({ ok: false, text: e.message || 'Failed' }); }
    finally { setBusy(null); }
  }
  const BASE = '/api/dashboard/production-schedule';
  const runBaseline = (action: 'capture' | 'clear') => call(`${BASE}/baseline`, { jobId: job.id, action }, (j) => action === 'capture'
    ? `Baseline locked on ${j.milestones} milestone${j.milestones === 1 ? '' : 's'} (${j.stamp}).${j.skipped?.length ? ` Skipped undated: ${j.skipped.join(', ')}.` : ''}`
    : `Baseline cleared (${j.stamp}).`, action);
  const runLink = () => call(`${BASE}/reschedule`, { jobId: job.id, action: 'link' }, (j) => j.linked ? `Linked ${j.linked} milestone${j.linked === 1 ? '' : 's'} — moving the start now cascades the chain.` : 'Milestones were already linked.', 'link');
  const runMove = () => call(`${BASE}/reschedule`, { jobId: job.id, action: 'move', newStart, firm }, (j) => `Start moved ${fmtShort(j.oldStart)} → ${fmtShort(j.newStart)} (${j.firm ? 'FIRM' : 'TENTATIVE'}); projected completion now ${fmtShort(j.newEnd)}.${j.linked ? ` Linked ${j.linked} milestones first.` : ''}`, 'move');

  const slipTxt = job.slipDays === null ? null : job.slipDays === 0 ? 'on baseline' : job.slipDays > 0 ? `${job.slipDays}d behind baseline` : `${-job.slipDays}d ahead of baseline`;
  const H = ({ children }: any) => <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{children}</div>;
  const Card = ({ children }: any) => <div style={{ border: `1px solid ${LINE}`, borderRadius: 9, padding: 12 }}>{children}</div>;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(ev) => ev.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 'min(560px, 100%)', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ background: job.color, color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, opacity: 0.85 }}>Production schedule controls</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{job.number} · {job.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.2)', border: 0, color: '#fff', borderRadius: 6, padding: 4, cursor: 'pointer', lineHeight: 0 }}><X size={16} /></button>
        </div>
        <div style={{ padding: 16, fontSize: 13, display: 'grid', gap: 12 }}>

          {/* START DATE */}
          <Card>
            <H><CalendarClock size={11} style={{ verticalAlign: -1 }} /> Start date</H>
            <div style={{ color: MUTED, marginBottom: 8 }}>Currently {fmtLong(job.start)} → {fmtLong(job.end)} ({job.tentative ? 'tentative' : 'firm'}). Moving the start shifts every milestone by the same number of days through JobTread dependencies; baseline stays put so slip shows.</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={newStart} onChange={(e) => { setNewStart(e.target.value); setConfirmMove(false); }} style={{ padding: '6px 8px', border: `1px solid ${LINE}`, borderRadius: 7, fontSize: 13 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><input type="radio" checked={!firm} onChange={() => setFirm(false)} /> Tentative</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}><input type="radio" checked={firm} onChange={() => setFirm(true)} /> Firm</label>
              <span style={{ flex: 1 }} />
              {!confirmMove ? (
                <button disabled={!!busy || !newStart} onClick={() => setConfirmMove(true)} style={{ ...btn(), borderColor: MAROON, fontWeight: 700 }}><CalendarClock size={13} /> {delta === 0 ? 'Update anchor' : 'Move schedule'}</button>
              ) : (
                <button disabled={!!busy} onClick={runMove} style={{ ...btn(), background: MAROON, color: '#fff', borderColor: MAROON, fontWeight: 700 }}>{busy === 'move' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />} Confirm</button>
              )}
            </div>
            {newStart && (
              <div style={{ marginTop: 8, fontSize: 12, color: delta === 0 ? MUTED : INK }}>
                {delta === 0 ? 'Same start date — only the tentative/firm flag and note will update.' : <>Shifts <b>{Math.abs(delta)} day{Math.abs(delta) === 1 ? '' : 's'} {delta > 0 ? 'later' : 'earlier'}</b> · new completion <b>{fmtLong(newEnd)}</b></>}
                {weekend && <span style={{ color: '#a11' }}> · that start is a weekend</span>}
                {needsLink && delta !== 0 && <span style={{ color: MUTED }}> · milestones will be linked first</span>}
              </div>
            )}
          </Card>

          {/* LINKS */}
          <Card>
            <H>{needsLink ? <Link2Off size={11} style={{ verticalAlign: -1 }} /> : <Link2 size={11} style={{ verticalAlign: -1 }} />} Dependencies</H>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, color: MUTED }}>
                {job.linkableCount === 0 ? 'Not enough dated milestones to link.' : needsLink
                  ? <><b style={{ color: INK }}>{job.linkedCount}/{job.linkableCount}</b> milestones linked. Linking chains each milestone finish→start to the one that finishes just before it (offsets locked), so a date change in JobTread cascades. Parallel work keeps its layout.</>
                  : <><b style={{ color: INK }}>All {job.linkableCount} linked.</b> Date changes to the first milestone cascade through the chain in JobTread.</>}
              </div>
              {needsLink && <button disabled={!!busy} onClick={runLink} style={btn()}>{busy === 'link' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Link2 size={13} />} Link now</button>}
            </div>
          </Card>

          {/* BASELINE */}
          <Card>
            <H>{job.hasBaseline ? <Lock size={11} style={{ verticalAlign: -1 }} /> : <LockOpen size={11} style={{ verticalAlign: -1 }} />} Baseline</H>
            <div style={{ color: MUTED, marginBottom: 8 }}>
              {job.hasBaseline
                ? <>Locked {fmtShort(job.baselineStart)} → {fmtShort(job.baselineEnd)}{slipTxt ? `, ${slipTxt}` : ''}.</>
                : <>No baseline captured yet.</>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button disabled={!!busy} onClick={() => runBaseline('capture')} style={btn()}>
                {busy === 'capture' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Lock size={13} />} {job.hasBaseline ? 'Re-baseline to current dates' : 'Lock in baseline'}
              </button>
              {job.hasBaseline && !confirmClear && <button disabled={!!busy} onClick={() => setConfirmClear(true)} style={btn()}><Eraser size={13} /> Clear baseline</button>}
              {confirmClear && (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '4px 8px', background: '#fdecec', border: '1px solid #f3b4b4', borderRadius: 7, fontSize: 12, color: '#8a1c1c' }}>
                  Clear on {job.milestoneCount} milestones?
                  <button disabled={!!busy} onClick={() => runBaseline('clear')} style={{ ...btn(true), background: '#a11', color: '#fff', borderColor: '#a11' }}>{busy === 'clear' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={12} />} Yes</button>
                  <button disabled={!!busy} onClick={() => setConfirmClear(false)} style={btn(true)}>No</button>
                </span>
              )}
            </div>
            {job.hasBaseline && <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>Re-baselining replaces the existing baseline — prior slip history is lost.</div>}
          </Card>

          {result && <div style={{ padding: '8px 10px', borderRadius: 7, fontSize: 12, background: result.ok ? '#e7f6ec' : '#fdecec', color: result.ok ? '#176b3a' : '#8a1c1c' }}>{result.text}</div>}
          <div style={{ fontSize: 11, color: MUTED }}>All actions write straight to JobTread and leave a job comment. Only the 🤖 milestone group is touched.</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Small UI bits
// ============================================================

function btn(small = false): any {
  return { display: 'inline-flex', alignItems: 'center', gap: 6, padding: small ? '4px 8px' : '6px 10px', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 7, fontSize: small ? 12 : 13, cursor: 'pointer', color: INK };
}
function chip(on: boolean, color: string): any {
  return { padding: '4px 10px', borderRadius: 999, border: `1px solid ${on ? color : LINE}`, background: on ? color : '#fff', color: on ? '#fff' : INK, fontSize: 12, cursor: 'pointer', lineHeight: 1.3 };
}
function Seg({ options, value, onChange, small }: any) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
      {options.map((o: any) => {
        const Icon = o.icon; const on = o.v === value;
        return (
          <button key={o.v} onClick={() => onChange(o.v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: small ? '4px 10px' : '6px 12px', border: 0, background: on ? MAROON : '#fff', color: on ? '#fff' : INK, fontSize: small ? 12 : 13, cursor: 'pointer', fontWeight: on ? 700 : 500 }}>
            {Icon ? <Icon size={14} /> : null}{o.label}
          </button>
        );
      })}
    </div>
  );
}

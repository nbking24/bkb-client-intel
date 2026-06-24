// @ts-nocheck
'use client';

/**
 * SchedulesCalendar (Gantt view)
 *
 * Pre-Construction dashboard's master schedule view: every In-Design
 * job's tasks rendered as a Gantt timeline so Nathan / Allison can
 * see overlapping work across clients on a single canvas.
 *
 * Each task = one row with a colored bar spanning its start->end
 * dates. Rows group by job, color follows job. Above the chart sits
 * a client multi-select (All Clients toggle + per-job chips) so the
 * operator can isolate two clients to study their overlap, or pull
 * everything in for a portfolio view.
 *
 * The component still owns:
 *   - The Refresh + Analyze flow (fetch + AI staleness check)
 *   - The flagged-jobs panel above the chart
 *   - A color legend below the chart
 *   - An "Undated tasks" disclosure (tasks with no start/end dates)
 *
 * Filename kept as SchedulesCalendar even though the view is now a
 * Gantt; the precon page imports under that name and I'm avoiding
 * an import churn just for naming.
 */

import { useEffect, useMemo, useState, useRef } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

interface ScheduleTask {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  progress: number;
  status: 'active' | 'upcoming' | 'completed' | 'undated';
}

interface JobSchedule {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  customStatus: string | null;
  color: string;
  tasks: ScheduleTask[];
  activeTaskCount: number;
  upcomingTaskCount: number;
  completedTaskCount: number;
  undatedTaskCount: number;
  hasNoActiveWork: boolean;
}

interface ScheduleTotals {
  jobCount: number;
  activeTaskCount: number;
  upcomingTaskCount: number;
  completedTaskCount: number;
  undatedTaskCount: number;
  jobsWithNoActiveWork: number;
}

interface ScheduleResponse {
  computedAt: string;
  totals: ScheduleTotals;
  jobs: JobSchedule[];
}

interface AnalysisResult {
  jobId: string;
  needsUpdate: boolean;
  verdict: string;
  suggestedNext: string;
}

// ============================================================
// Date helpers - local-midnight semantics so day boundaries match
// the operator's wall clock instead of UTC.
// ============================================================

function parseLocalDate(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function todayLocal(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date): number {
  // Integer count of midnight boundaries crossed from a -> b.
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(d.getDate() + n);
  return out;
}

function fmtShortDate(d: Date): string {
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

function fmtMonthYear(d: Date): string {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// ============================================================
// Layout constants
// ============================================================

// Pixel width of one day on the Gantt timeline. Tuned so a 3-month
// window fits comfortably without horizontal scroll on a 1280-wide
// monitor (~24px/day * 90 days = ~2160px - so we DO get horizontal
// scroll, intentional - the chart scrolls inside its container).
const DAY_PX = 22;
// Width of the left-hand task-name column. Sticky on horizontal scroll.
const NAME_COL_PX = 240;
// Default visible window: 14 days back, 76 days forward = ~3 months
// centered loosely on today. Operator can scroll left/right to see more.
const DEFAULT_BACK_DAYS = 14;
const DEFAULT_FWD_DAYS = 76;
// Row height for task rows.
const ROW_PX = 26;
// Row height for job header rows.
const HEADER_ROW_PX = 30;

// ============================================================
// Component
// ============================================================

export default function SchedulesCalendar() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Client multi-select: which jobs to render on the Gantt. Defaults
  // to "all" so first load shows everything. Stored as a Set of jobIds
  // for O(1) lookup during render.
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string> | null>(null);

  // Per-job collapsed/expanded state. Default expanded so the operator
  // sees the bars on first load; they can collapse busy jobs to clear
  // visual space.
  const [collapsedJobs, setCollapsedJobs] = useState<Set<string>>(new Set());

  // Per-task "completing" state - the spinner appears on the bar while
  // the JT mutation is in flight. Stored as a Set of taskIds rather
  // than a boolean so simultaneous completes don't step on each other.
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  // Surface a transient error toast when a complete fails. Keyed by
  // taskId so we can render it next to the right row instead of a
  // global banner.
  const [completeError, setCompleteError] = useState<Record<string, string>>({});

  // Window anchor (left edge of the visible Gantt). Starts at today
  // minus DEFAULT_BACK_DAYS, advances with the Prev/Next buttons.
  const [windowStart, setWindowStart] = useState<Date>(() => addDays(todayLocal(), -DEFAULT_BACK_DAYS));
  const windowDays = DEFAULT_BACK_DAYS + DEFAULT_FWD_DAYS;

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ----------------------------------------------------------
  // Data load
  // ----------------------------------------------------------
  async function load(force = false) {
    if (force) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/precon/schedule', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || `Load failed (${res.status})`);
      setData(json);
      // Initialize selection to "all" only on the very first load.
      // Subsequent reloads preserve whatever the operator picked.
      setSelectedJobIds((cur) => cur === null ? new Set((json.jobs || []).map((j: any) => j.jobId)) : cur);
    } catch (err: any) {
      setError(err?.message || 'Failed to load schedule data');
    } finally {
      if (force) setRefreshing(false); else setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // ----------------------------------------------------------
  // AI staleness analysis
  // ----------------------------------------------------------
  async function runAnalysis() {
    if (!data?.jobs?.length) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const slim = data.jobs.map((j) => ({
        jobId: j.jobId,
        jobName: j.jobName,
        clientName: j.clientName,
        tasks: j.tasks.map((t) => ({
          name: t.name,
          startDate: t.startDate,
          endDate: t.endDate,
          progress: t.progress,
          status: t.status,
        })),
      }));
      const res = await fetch('/api/dashboard/precon/schedule/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: slim }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || `Analysis failed (${res.status})`);
      const byId: Record<string, AnalysisResult> = {};
      for (const a of json.analyses || []) byId[a.jobId] = a;
      setAnalyses(byId);
    } catch (err: any) {
      setAnalyzeError(err?.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  async function refreshAll() {
    await load(true);
    await runAnalysis();
  }

  // ----------------------------------------------------------
  // Selection helpers
  // ----------------------------------------------------------
  const allJobIds = useMemo(() => (data?.jobs || []).map((j) => j.jobId), [data]);
  const allSelected = selectedJobIds !== null && selectedJobIds.size === allJobIds.length && allJobIds.length > 0;

  function toggleAll() {
    if (allSelected) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(allJobIds));
    }
  }
  function toggleJob(jobId: string) {
    setSelectedJobIds((cur) => {
      const next = new Set(cur || []);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }
  function collapseToggle(jobId: string) {
    setCollapsedJobs((cur) => {
      const next = new Set(cur);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  /**
   * Mark a JT task complete. Optimistic update: flip the task's
   * progress to 1.0 + status to 'completed' in local state immediately
   * so the bar disappears from the chart, then fire the JT mutation.
   * On failure, roll back and surface the error inline.
   *
   * The Gantt body filters out completed/undated tasks already, so the
   * status flip is what makes the bar vanish - no separate "hide" flag
   * needed.
   */
  async function completeTask(taskId: string) {
    if (!data) return;
    if (completing.has(taskId)) return; // already in flight
    setCompleting((cur) => {
      const next = new Set(cur);
      next.add(taskId);
      return next;
    });
    setCompleteError((cur) => {
      const next = { ...cur };
      delete next[taskId];
      return next;
    });
    // Snapshot for rollback.
    const prevData = data;
    const optimistic: ScheduleResponse = {
      ...prevData,
      jobs: prevData.jobs.map((j) => ({
        ...j,
        tasks: j.tasks.map((t) =>
          t.id === taskId
            ? { ...t, progress: 1, status: 'completed' as const }
            : t,
        ),
        // Recompute the active/completed counts so the AI flagged
        // panel doesn't keep showing the old "no active work" rule.
        activeTaskCount:
          j.tasks.filter((t) => t.id !== taskId && t.status === 'active').length,
        completedTaskCount:
          j.tasks.filter((t) => t.id === taskId || t.status === 'completed').length,
        hasNoActiveWork:
          j.tasks.filter((t) => t.id !== taskId && t.status === 'active').length === 0,
      })),
      totals: {
        ...prevData.totals,
        activeTaskCount: Math.max(0, prevData.totals.activeTaskCount - 1),
        completedTaskCount: prevData.totals.completedTaskCount + 1,
      },
    };
    setData(optimistic);
    try {
      const res = await fetch('/api/dashboard/precon/schedule/complete-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) {
        throw new Error(json?.error || `Update failed (${res.status})`);
      }
    } catch (err: any) {
      // Roll back local state and surface the error.
      setData(prevData);
      setCompleteError((cur) => ({
        ...cur,
        [taskId]: err?.message || 'Could not mark task complete',
      }));
    } finally {
      setCompleting((cur) => {
        const next = new Set(cur);
        next.delete(taskId);
        return next;
      });
    }
  }

  // ----------------------------------------------------------
  // Derived data
  // ----------------------------------------------------------
  const visibleJobs = useMemo(() => {
    if (!data?.jobs) return [];
    if (!selectedJobIds) return data.jobs;
    return data.jobs.filter((j) => selectedJobIds.has(j.jobId));
  }, [data, selectedJobIds]);

  const flaggedJobs = useMemo(() => {
    if (!data?.jobs) return [];
    return data.jobs.filter((j) => {
      const a = analyses[j.jobId];
      if (a) return a.needsUpdate;
      return j.hasNoActiveWork;
    });
  }, [data, analyses]);

  const undatedJobs = useMemo(() => {
    return visibleJobs
      .map((j) => ({ job: j, tasks: j.tasks.filter((t) => t.status === 'undated') }))
      .filter((x) => x.tasks.length > 0);
  }, [visibleJobs]);

  const today = useMemo(() => todayLocal(), []);

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------
  return (
    <div className="rounded-xl border" style={{ borderColor: 'rgba(200,140,0,0.15)', background: '#ffffff' }}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-b" style={{ borderColor: 'rgba(200,140,0,0.10)' }}>
        <div className="flex items-center gap-2">
          <CalendarDays size={18} style={{ color: '#c88c00' }} />
          <h2 className="text-base font-semibold" style={{ color: '#1a1a1a' }}>
            In-Design Schedule Gantt
          </h2>
          {data?.totals && (
            <span className="text-xs ml-2" style={{ color: '#8a8078' }}>
              {data.totals.jobCount} jobs · {data.totals.activeTaskCount} active · {data.totals.upcomingTaskCount} upcoming
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshAll}
            disabled={loading || refreshing || analyzing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm disabled:opacity-50"
            style={{ background: '#c88c00', color: '#ffffff' }}
            title="Pull fresh schedule data and run the AI staleness check"
          >
            {analyzing || refreshing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {analyzing ? 'Analyzing…' : refreshing ? 'Refreshing…' : 'Refresh + Analyze'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 gap-2 text-sm" style={{ color: '#8a8078' }}>
          <Loader2 size={16} className="animate-spin" />
          Loading schedules…
        </div>
      )}
      {error && !loading && (
        <div className="m-4 rounded-lg p-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <div className="p-4 space-y-4">
          {/* AI / rule-based flagged jobs panel */}
          {flaggedJobs.length > 0 && (
            <div
              className="rounded-lg p-3"
              style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.18)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} style={{ color: '#b91c1c' }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#b91c1c' }}>
                  {Object.keys(analyses).length > 0 ? 'AI flagged' : 'Needs review'}
                </span>
                <span className="text-xs" style={{ color: '#8a8078' }}>
                  {flaggedJobs.length} job{flaggedJobs.length === 1 ? '' : 's'} need{flaggedJobs.length === 1 ? 's' : ''} a schedule update
                </span>
                {Object.keys(analyses).length === 0 && (
                  <span className="ml-auto text-[10px] flex items-center gap-1" style={{ color: '#8a8078' }}>
                    <Sparkles size={10} /> Click Refresh + Analyze for AI verdict
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {flaggedJobs.map((j) => {
                  const a = analyses[j.jobId];
                  return (
                    <div key={j.jobId} className="flex items-start gap-2 text-xs">
                      <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: j.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium" style={{ color: '#1a1a1a' }}>
                            {j.clientName || j.jobName}
                          </span>
                          <span style={{ color: '#8a8078' }}>#{j.jobNumber}</span>
                          <span style={{ color: '#8a8078' }}>·</span>
                          <span style={{ color: '#8a8078' }}>
                            {j.activeTaskCount} active, {j.undatedTaskCount} undated, {j.upcomingTaskCount} upcoming
                          </span>
                        </div>
                        {a && (
                          <>
                            <div style={{ color: '#3d3a36' }}>{a.verdict}</div>
                            {a.suggestedNext && (
                              <div style={{ color: '#5a5550', fontStyle: 'italic' }}>
                                Next: {a.suggestedNext}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <a
                        href={`https://app.jobtread.com/jobs/${j.jobId}/schedule`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0"
                        title="Open job schedule in JobTread"
                        style={{ color: '#c88c00' }}
                      >
                        <ExternalLink size={11} />
                      </a>
                    </div>
                  );
                })}
              </div>
              {analyzeError && (
                <div className="mt-2 text-xs" style={{ color: '#b91c1c' }}>
                  AI analysis failed: {analyzeError}
                </div>
              )}
            </div>
          )}

          {/* Client multi-select chip toolbar.
              "All Clients" toggles the whole set; individual chips
              toggle one job at a time. Selected = filled with the
              job's color; unselected = neutral outline. Nathan can
              pick any subset to compare overlap on the Gantt. */}
          <div className="rounded-lg p-3 space-y-2" style={{ background: '#faf8f5', border: '1px solid rgba(200,140,0,0.10)' }}>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wide" style={{ color: '#8a8078' }}>
                Show clients
              </span>
              <span style={{ color: '#8a8078' }}>
                {(selectedJobIds?.size ?? 0)} of {allJobIds.length} selected
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs px-2.5 py-1 rounded-full"
                style={{
                  background: allSelected ? '#c88c00' : '#ffffff',
                  color: allSelected ? '#ffffff' : '#5a5550',
                  border: `1px solid ${allSelected ? '#c88c00' : 'rgba(200,140,0,0.30)'}`,
                  fontWeight: 600,
                }}
              >
                {allSelected ? '✓ All clients' : 'All clients'}
              </button>
              {(data.jobs || []).map((j) => {
                const on = selectedJobIds?.has(j.jobId);
                return (
                  <button
                    key={j.jobId}
                    type="button"
                    onClick={() => toggleJob(j.jobId)}
                    className="text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5"
                    style={{
                      background: on ? j.color : '#ffffff',
                      color: on ? '#ffffff' : '#5a5550',
                      border: `1px solid ${on ? j.color : 'rgba(200,140,0,0.20)'}`,
                      fontWeight: on ? 600 : 400,
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-sm shrink-0"
                      style={{ background: on ? '#ffffff' : j.color, opacity: on ? 0.9 : 1 }}
                    />
                    {j.clientName || j.jobName}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Gantt timeline window controls */}
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setWindowStart(addDays(windowStart, -14))}
              className="text-xs px-2 py-1 rounded hover:bg-stone-50"
              style={{ border: '1px solid rgba(200,140,0,0.12)', color: '#8a8078' }}
            >
              ← 2 weeks
            </button>
            <button
              type="button"
              onClick={() => setWindowStart(addDays(today, -DEFAULT_BACK_DAYS))}
              className="text-xs px-2 py-1 rounded hover:bg-stone-50"
              style={{ border: '1px solid rgba(200,140,0,0.12)', color: '#8a8078' }}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setWindowStart(addDays(windowStart, 14))}
              className="text-xs px-2 py-1 rounded hover:bg-stone-50"
              style={{ border: '1px solid rgba(200,140,0,0.12)', color: '#8a8078' }}
            >
              2 weeks →
            </button>
            <span className="ml-2 text-xs" style={{ color: '#8a8078' }}>
              {fmtShortDate(windowStart)} to {fmtShortDate(addDays(windowStart, windowDays - 1))}
            </span>
          </div>

          {/* Gantt chart */}
          {visibleJobs.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: '#8a8078' }}>
              No clients selected. Pick at least one above to see their schedule.
            </div>
          ) : (
            <GanttBody
              jobs={visibleJobs}
              windowStart={windowStart}
              windowDays={windowDays}
              today={today}
              collapsedJobs={collapsedJobs}
              onCollapseToggle={collapseToggle}
              scrollRef={scrollRef}
              completingTaskIds={completing}
              completeErrors={completeError}
              onCompleteTask={completeTask}
            />
          )}

          {/* Undated tasks pile */}
          {undatedJobs.length > 0 && (
            <details
              className="rounded-lg"
              style={{ background: '#faf8f5', border: '1px solid rgba(200,140,0,0.12)' }}
            >
              <summary className="cursor-pointer text-xs px-3 py-2 font-medium flex items-center gap-2" style={{ color: '#5a5550' }}>
                <CalendarDays size={12} />
                Undated tasks ({undatedJobs.reduce((s, x) => s + x.tasks.length, 0)})
                <span className="font-normal" style={{ color: '#8a8078' }}>
                  - tasks with no start or end date set
                </span>
              </summary>
              <div className="px-3 py-2 space-y-2 border-t" style={{ borderColor: 'rgba(200,140,0,0.10)' }}>
                {undatedJobs.map((u) => (
                  <div key={u.job.jobId}>
                    <div className="flex items-center gap-1.5 text-xs font-semibold mb-1" style={{ color: '#1a1a1a' }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: u.job.color }} />
                      {u.job.clientName || u.job.jobName}
                      <span style={{ color: '#8a8078', fontWeight: 400 }}>#{u.job.jobNumber}</span>
                    </div>
                    <div className="space-y-0.5 ml-3.5">
                      {u.tasks.map((t) => (
                        <div key={t.id} className="text-[11px]" style={{ color: '#5a5550' }}>
                          {t.name}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {data.jobs.length === 0 && (
            <div className="text-center py-8 text-sm" style={{ color: '#8a8078' }}>
              <CheckCircle2 size={24} style={{ color: '#22c55e' }} className="mx-auto mb-2" />
              No in-design jobs at the moment.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// GanttBody - the actual chart (header + rows + bars)
// ============================================================

function GanttBody({
  jobs,
  windowStart,
  windowDays,
  today,
  collapsedJobs,
  onCollapseToggle,
  scrollRef,
  completingTaskIds,
  completeErrors,
  onCompleteTask,
}: {
  jobs: JobSchedule[];
  windowStart: Date;
  windowDays: number;
  today: Date;
  collapsedJobs: Set<string>;
  onCollapseToggle: (jobId: string) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  completingTaskIds: Set<string>;
  completeErrors: Record<string, string>;
  onCompleteTask: (taskId: string) => void;
}) {
  const totalWidthPx = windowDays * DAY_PX;
  const todayOffset = daysBetween(windowStart, today);
  const todayInWindow = todayOffset >= 0 && todayOffset < windowDays;

  // Build the per-day header cells, plus month-band cells so the
  // operator gets month context above the day numbers.
  const dayCells: Array<{ date: Date; isToday: boolean; isWeekendStart: boolean }> = [];
  for (let i = 0; i < windowDays; i++) {
    const d = addDays(windowStart, i);
    dayCells.push({
      date: d,
      isToday: d.getTime() === today.getTime(),
      isWeekendStart: d.getDay() === 0,
    });
  }
  // Month bands: group consecutive same-month days.
  const monthBands: Array<{ label: string; startOffset: number; widthPx: number }> = [];
  for (let i = 0; i < dayCells.length; ) {
    const dc = dayCells[i];
    const monthKey = `${dc.date.getFullYear()}-${dc.date.getMonth()}`;
    let j = i;
    while (j < dayCells.length) {
      const dj = dayCells[j];
      if (`${dj.date.getFullYear()}-${dj.date.getMonth()}` !== monthKey) break;
      j++;
    }
    monthBands.push({
      label: fmtMonthYear(dc.date),
      startOffset: i * DAY_PX,
      widthPx: (j - i) * DAY_PX,
    });
    i = j;
  }

  // Render each visible job as an expandable group with its task rows
  // below. Filter tasks down to those that overlap the visible window
  // so we don't render bars miles off-screen.
  const visible = jobs.map((j) => {
    const dated = j.tasks.filter((t) => t.status !== 'undated' && t.status !== 'completed');
    const inWindow = dated
      .map((t) => {
        const s = parseLocalDate(t.startDate);
        const e = parseLocalDate(t.endDate);
        const startD = s || e!;
        const endD = e || s!;
        return { task: t, startD, endD };
      })
      .filter((x) => {
        // Overlap if [startD, endD] intersects [windowStart, windowEnd].
        const windowEnd = addDays(windowStart, windowDays - 1);
        return !(x.endD < windowStart || x.startD > windowEnd);
      });
    return { job: j, taskBars: inWindow };
  });

  return (
    <div
      className="rounded-lg"
      style={{ border: '1px solid rgba(200,140,0,0.15)', background: '#ffffff', overflow: 'hidden' }}
    >
      <div
        ref={scrollRef}
        className="overflow-x-auto"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div style={{ minWidth: NAME_COL_PX + totalWidthPx + 1, position: 'relative' }}>
          {/* Header: month band + day cells. Left column reserves
              space for the task-name column so the timeline starts
              flush with the bars below. */}
          <div className="flex" style={{ borderBottom: '1px solid rgba(200,140,0,0.15)' }}>
            <div
              style={{
                width: NAME_COL_PX,
                flexShrink: 0,
                background: '#faf8f5',
                borderRight: '1px solid rgba(200,140,0,0.15)',
              }}
            >
              <div
                className="px-2 py-1.5 text-[10px] uppercase tracking-wide font-semibold"
                style={{ color: '#8a8078' }}
              >
                Task
              </div>
              <div
                className="px-2 py-1 text-[10px] font-medium"
                style={{ color: '#8a8078', borderTop: '1px solid rgba(200,140,0,0.10)' }}
              >
                Day
              </div>
            </div>
            <div style={{ position: 'relative', width: totalWidthPx, flexShrink: 0 }}>
              {/* Month band row */}
              <div
                className="flex text-[11px] font-semibold"
                style={{ height: 26, color: '#5a5550', background: '#fcfaf6' }}
              >
                {monthBands.map((m, idx) => (
                  <div
                    key={`${m.label}-${idx}`}
                    className="px-1 py-1 truncate"
                    style={{
                      width: m.widthPx,
                      flexShrink: 0,
                      borderRight: idx < monthBands.length - 1 ? '1px solid rgba(200,140,0,0.20)' : 'none',
                    }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
              {/* Day-number row */}
              <div className="flex" style={{ borderTop: '1px solid rgba(200,140,0,0.10)' }}>
                {dayCells.map((dc, idx) => (
                  <div
                    key={idx}
                    className="text-[10px] text-center"
                    style={{
                      width: DAY_PX,
                      flexShrink: 0,
                      padding: '4px 0',
                      color: dc.isToday ? '#ffffff' : dc.date.getDay() === 0 || dc.date.getDay() === 6 ? '#8a8078' : '#5a5550',
                      background: dc.isToday
                        ? '#c88c00'
                        : dc.date.getDay() === 0 || dc.date.getDay() === 6
                          ? 'rgba(200,140,0,0.04)'
                          : 'transparent',
                      borderRight: dc.isWeekendStart ? '1px solid rgba(200,140,0,0.18)' : '1px solid rgba(200,140,0,0.05)',
                      fontWeight: dc.isToday ? 700 : 400,
                    }}
                  >
                    {dc.date.getDate()}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Body: job groups with task rows */}
          <div style={{ position: 'relative' }}>
            {/* Today vertical line - spans the full body height. */}
            {todayInWindow && (
              <div
                style={{
                  position: 'absolute',
                  left: NAME_COL_PX + todayOffset * DAY_PX,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: '#c88c00',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />
            )}

            {visible.map(({ job, taskBars }) => {
              const collapsed = collapsedJobs.has(job.jobId);
              return (
                <div key={job.jobId}>
                  {/* Job header row */}
                  <div
                    className="flex items-center cursor-pointer hover:bg-stone-50 transition-colors"
                    onClick={() => onCollapseToggle(job.jobId)}
                    style={{
                      height: HEADER_ROW_PX,
                      background: 'rgba(200,140,0,0.04)',
                      borderBottom: '1px solid rgba(200,140,0,0.10)',
                    }}
                  >
                    <div
                      style={{
                        width: NAME_COL_PX,
                        flexShrink: 0,
                        borderRight: '1px solid rgba(200,140,0,0.10)',
                      }}
                      className="px-2 flex items-center gap-1.5 text-xs h-full"
                    >
                      {collapsed
                        ? <ChevronRight size={12} style={{ color: '#8a8078' }} />
                        : <ChevronDown size={12} style={{ color: '#8a8078' }} />}
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: job.color }} />
                      <span className="font-semibold truncate" style={{ color: '#1a1a1a' }}>
                        {job.clientName || job.jobName}
                      </span>
                      <span className="text-[10px]" style={{ color: '#8a8078' }}>
                        #{job.jobNumber}
                      </span>
                    </div>
                    <div
                      style={{
                        width: totalWidthPx,
                        flexShrink: 0,
                        height: '100%',
                        position: 'relative',
                      }}
                    >
                      <span
                        className="absolute text-[10px]"
                        style={{ color: '#8a8078', top: 8, left: 8 }}
                      >
                        {taskBars.length} task{taskBars.length === 1 ? '' : 's'} in window
                      </span>
                    </div>
                  </div>

                  {/* Task rows (hidden when collapsed) */}
                  {!collapsed && taskBars.map(({ task, startD, endD }) => {
                    // Clip bar to the visible window so it doesn't
                    // overflow into the name column or off the right.
                    const windowEnd = addDays(windowStart, windowDays - 1);
                    const clipStart = startD < windowStart ? windowStart : startD;
                    const clipEnd = endD > windowEnd ? windowEnd : endD;
                    const left = daysBetween(windowStart, clipStart) * DAY_PX;
                    const days = daysBetween(clipStart, clipEnd) + 1;
                    const width = Math.max(DAY_PX - 2, days * DAY_PX - 2);
                    const isOverdue = endD < today && task.progress < 1;
                    const fillColor = job.color;
                    const isCompleting = completingTaskIds.has(task.id);
                    const rowError = completeErrors[task.id];
                    return (
                      <div
                        key={task.id}
                        className="flex hover:bg-stone-50 transition-colors"
                        style={{
                          height: ROW_PX,
                          borderBottom: '1px solid rgba(200,140,0,0.06)',
                        }}
                      >
                        <div
                          className="px-2 flex items-center gap-1.5 text-[11px] h-full"
                          style={{
                            width: NAME_COL_PX,
                            flexShrink: 0,
                            borderRight: '1px solid rgba(200,140,0,0.10)',
                            color: '#3d3a36',
                          }}
                          title={task.name}
                        >
                          {/* Mark-complete checkbox button. Sits in the
                              left task-name column so it stays reachable
                              regardless of horizontal scroll. Clicking
                              fires the JT updateTask mutation via the
                              parent's onCompleteTask handler. While the
                              request is in flight, render a spinner; on
                              failure, surface a small error icon with the
                              message in its title. */}
                          <button
                            type="button"
                            onClick={() => {
                              if (isCompleting) return;
                              const ok = window.confirm(
                                `Mark "${task.name}" complete in JobTread? This sets the task's progress to 100% on the job's schedule.`,
                              );
                              if (ok) onCompleteTask(task.id);
                            }}
                            disabled={isCompleting}
                            className="shrink-0 inline-flex items-center justify-center rounded hover:bg-stone-100 transition-colors"
                            style={{
                              width: 16,
                              height: 16,
                              border: '1px solid rgba(200,140,0,0.35)',
                              background: '#ffffff',
                              cursor: isCompleting ? 'wait' : 'pointer',
                            }}
                            title={rowError
                              ? `Last attempt failed: ${rowError}. Click to retry.`
                              : `Mark "${task.name}" complete in JobTread`}
                          >
                            {isCompleting
                              ? <Loader2 size={10} className="animate-spin" style={{ color: '#c88c00' }} />
                              : rowError
                                ? <AlertTriangle size={10} style={{ color: '#b91c1c' }} />
                                : <Check size={10} style={{ color: '#22c55e', opacity: 0.6 }} />}
                          </button>
                          <span className="truncate">{task.name}</span>
                        </div>
                        <div
                          style={{
                            width: totalWidthPx,
                            flexShrink: 0,
                            position: 'relative',
                            height: '100%',
                          }}
                        >
                          {/* Weekend stripe background */}
                          {dayCells.map((dc, idx) => {
                            if (dc.date.getDay() !== 0 && dc.date.getDay() !== 6) return null;
                            return (
                              <div
                                key={idx}
                                style={{
                                  position: 'absolute',
                                  left: idx * DAY_PX,
                                  top: 0,
                                  width: DAY_PX,
                                  height: '100%',
                                  background: 'rgba(200,140,0,0.04)',
                                }}
                              />
                            );
                          })}
                          {/* The bar itself */}
                          <div
                            title={`${task.name} (${task.startDate || '?'} to ${task.endDate || '?'}${task.progress > 0 ? `, ${Math.round(task.progress * 100)}%` : ''})`}
                            style={{
                              position: 'absolute',
                              left,
                              top: 4,
                              height: ROW_PX - 8,
                              width,
                              background: fillColor,
                              borderRadius: 4,
                              boxShadow: isOverdue ? 'inset 0 0 0 1px #b91c1c' : 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              paddingLeft: 6,
                              color: '#ffffff',
                              fontSize: 10,
                              fontWeight: 600,
                              overflow: 'hidden',
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {width > 60 ? task.name : ''}
                          </div>
                          {/* Progress overlay - hatched portion of the bar
                              indicating % complete. Hidden for very small
                              bars where the indicator would be illegible. */}
                          {task.progress > 0 && task.progress < 1 && width > 30 && (
                            <div
                              style={{
                                position: 'absolute',
                                left,
                                top: 4,
                                height: ROW_PX - 8,
                                width: width * task.progress,
                                background: 'rgba(0,0,0,0.18)',
                                borderRadius: 4,
                                pointerEvents: 'none',
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Empty-state row when job has no tasks in this window */}
                  {!collapsed && taskBars.length === 0 && (
                    <div className="flex" style={{ height: ROW_PX, borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                      <div
                        className="px-2 flex items-center text-[11px] italic"
                        style={{
                          width: NAME_COL_PX,
                          flexShrink: 0,
                          borderRight: '1px solid rgba(200,140,0,0.10)',
                          color: '#8a8078',
                        }}
                      >
                        No scheduled tasks in window
                      </div>
                      <div style={{ width: totalWidthPx, flexShrink: 0 }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// @ts-nocheck
'use client';

/**
 * SchedulesCalendar
 *
 * Pre-Construction dashboard's master calendar: every In-Design job's
 * tasks overlaid on a single month grid, color-coded by job. Tasks
 * with no dates land in an "Undated" pile below the calendar. A
 * Refresh button kicks off an AI staleness check that flags jobs
 * with no active work and proposes the next concrete schedule update.
 *
 * Self-contained component — manages its own fetch + state — so the
 * precon page just imports and renders <SchedulesCalendar />.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
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
// Date helpers (local time so day boundaries match the operator's clock)
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

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtMonthYear(d: Date): string {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function fmtShortDate(d: Date): string {
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Build the array of 42 day cells (6 weeks) covering the visible month. */
function buildMonthGrid(monthAnchor: Date): Date[] {
  const firstOfMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
  const startOffset = firstOfMonth.getDay(); // 0 = Sunday
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - startOffset);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return days;
}

// ============================================================
// Bucketing tasks by day
// ============================================================

interface CalendarChip {
  task: ScheduleTask;
  job: JobSchedule;
  // What kind of marker is this chip on this specific day?
  //   'start'   - the task starts on this day (renders as a solid pill)
  //   'continue' - the task spans through this day, neither start nor end
  //   'end'     - the task ends on this day (renders as a hollow/outlined pill)
  //   'single'  - a one-day task (renders as a solid pill)
  kind: 'start' | 'continue' | 'end' | 'single';
}

function buildChipsByDay(jobs: JobSchedule[]): Map<string, CalendarChip[]> {
  const out = new Map<string, CalendarChip[]>();
  for (const job of jobs) {
    for (const task of job.tasks) {
      if (task.status === 'undated' || task.status === 'completed') continue;
      const start = parseLocalDate(task.startDate);
      const end = parseLocalDate(task.endDate);
      const anchor = start || end;
      if (!anchor) continue;
      const finish = end || start!;
      // Walk every day between anchor and finish, capped at 60 days so a
      // single 6-month task doesn't blow up rendering across the whole grid.
      const cur = new Date(anchor);
      let dayIndex = 0;
      while (cur <= finish && dayIndex < 60) {
        const key = ymd(cur);
        const isStart = sameDay(cur, anchor);
        const isEnd = sameDay(cur, finish);
        const kind: CalendarChip['kind'] = isStart && isEnd ? 'single' : isStart ? 'start' : isEnd ? 'end' : 'continue';
        if (!out.has(key)) out.set(key, []);
        out.get(key)!.push({ task, job, kind });
        cur.setDate(cur.getDate() + 1);
        dayIndex++;
      }
    }
  }
  return out;
}

// ============================================================
// Main component
// ============================================================

export default function SchedulesCalendar() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

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
    } catch (err: any) {
      setError(err?.message || 'Failed to load schedule data');
    } finally {
      if (force) setRefreshing(false); else setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // ----------------------------------------------------------
  // AI analysis
  // ----------------------------------------------------------
  async function runAnalysis() {
    if (!data?.jobs?.length) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      // Compact payload - only fields the prompt needs.
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

  // Combined refresh button: pull fresh schedule, then re-run AI analysis
  // so the operator gets a single "do everything" action.
  async function refreshAll() {
    await load(true);
    await runAnalysis();
  }

  // ----------------------------------------------------------
  // Derived data
  // ----------------------------------------------------------
  const chipsByDay = useMemo(() => buildChipsByDay(data?.jobs || []), [data]);
  const grid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);
  const today = useMemo(() => todayLocal(), []);

  const selectedDayChips: CalendarChip[] = useMemo(() => {
    if (!selectedDay) return [];
    return chipsByDay.get(selectedDay) || [];
  }, [selectedDay, chipsByDay]);

  const flaggedJobs = useMemo(() => {
    if (!data?.jobs) return [];
    // Show jobs that the AI flagged OR (when no AI run has happened
    // yet) jobs with no active task per the deterministic rule.
    return data.jobs.filter((j) => {
      const a = analyses[j.jobId];
      if (a) return a.needsUpdate;
      return j.hasNoActiveWork;
    });
  }, [data, analyses]);

  const undatedJobs = useMemo(() => {
    if (!data?.jobs) return [];
    return data.jobs
      .map((j) => ({ job: j, tasks: j.tasks.filter((t) => t.status === 'undated') }))
      .filter((x) => x.tasks.length > 0);
  }, [data]);

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------
  return (
    <div className="rounded-xl border" style={{ borderColor: 'rgba(200,140,0,0.15)', background: '#ffffff' }}>
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-b" style={{ borderColor: 'rgba(200,140,0,0.10)' }}>
        <div className="flex items-center gap-2">
          <CalendarDays size={18} style={{ color: '#c88c00' }} />
          <h2 className="text-base font-semibold" style={{ color: '#1a1a1a' }}>
            In-Design Schedule Calendar
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

      {/* Loading / error states */}
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
                      <span
                        className="mt-1 w-2 h-2 rounded-full shrink-0"
                        style={{ background: j.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium" style={{ color: '#1a1a1a' }}>
                            {j.clientName || j.jobName}
                          </span>
                          <span style={{ color: '#8a8078' }}>
                            #{j.jobNumber}
                          </span>
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

          {/* Month nav */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1))}
              className="flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-stone-50"
              style={{ color: '#8a8078', border: '1px solid rgba(200,140,0,0.12)' }}
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
                {fmtMonthYear(monthAnchor)}
              </span>
              <button
                type="button"
                onClick={() => {
                  const t = new Date();
                  setMonthAnchor(new Date(t.getFullYear(), t.getMonth(), 1));
                }}
                className="text-xs px-2 py-1 rounded hover:bg-stone-50"
                style={{ color: '#8a8078', border: '1px solid rgba(200,140,0,0.12)' }}
              >
                Today
              </button>
            </div>
            <button
              type="button"
              onClick={() => setMonthAnchor(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1))}
              className="flex items-center gap-1 text-sm px-2 py-1 rounded hover:bg-stone-50"
              style={{ color: '#8a8078', border: '1px solid rgba(200,140,0,0.12)' }}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>

          {/* Day-of-week header */}
          <div className="grid grid-cols-7 gap-px text-[10px] uppercase tracking-wide font-semibold" style={{ color: '#8a8078' }}>
            {DOW_LABELS.map((d) => (
              <div key={d} className="px-1 py-1">{d}</div>
            ))}
          </div>

          {/* Month grid */}
          <div
            className="grid grid-cols-7 gap-px rounded-lg overflow-hidden"
            style={{ background: 'rgba(200,140,0,0.10)', border: '1px solid rgba(200,140,0,0.15)' }}
          >
            {grid.map((d) => {
              const inMonth = d.getMonth() === monthAnchor.getMonth();
              const isToday = sameDay(d, today);
              const key = ymd(d);
              const chips = chipsByDay.get(key) || [];
              const isSelected = selectedDay === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(isSelected ? null : key)}
                  className="text-left p-1 min-h-[78px] hover:bg-stone-50 transition-colors"
                  style={{
                    background: isSelected ? 'rgba(200,140,0,0.10)' : inMonth ? '#ffffff' : '#faf8f5',
                    opacity: inMonth ? 1 : 0.55,
                    cursor: 'pointer',
                  }}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <span
                      className="text-[11px] font-semibold inline-flex items-center justify-center"
                      style={{
                        color: isToday ? '#ffffff' : inMonth ? '#1a1a1a' : '#8a8078',
                        background: isToday ? '#c88c00' : 'transparent',
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                      }}
                    >
                      {d.getDate()}
                    </span>
                  </div>
                  {/* Up to 3 chips per cell, then "+N" overflow */}
                  <div className="space-y-0.5">
                    {chips.slice(0, 3).map((c, idx) => (
                      <ChipPill key={`${c.task.id}-${idx}`} chip={c} />
                    ))}
                    {chips.length > 3 && (
                      <div className="text-[9px]" style={{ color: '#8a8078' }}>
                        +{chips.length - 3} more
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selected-day drill-down */}
          {selectedDay && selectedDayChips.length > 0 && (
            <div className="rounded-lg p-3" style={{ background: '#faf8f5', border: '1px solid rgba(200,140,0,0.12)' }}>
              <div className="flex items-center gap-2 mb-2 text-xs font-semibold" style={{ color: '#1a1a1a' }}>
                <Clock size={12} />
                {(() => {
                  const d = parseLocalDate(selectedDay);
                  return d ? fmtShortDate(d) : selectedDay;
                })()}
                <span className="ml-1 font-normal" style={{ color: '#8a8078' }}>
                  {selectedDayChips.length} item{selectedDayChips.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="space-y-1">
                {selectedDayChips.map((c, idx) => (
                  <div key={`${c.task.id}-detail-${idx}`} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: c.job.color }}
                    />
                    <span className="font-medium truncate" style={{ color: '#1a1a1a' }}>
                      {c.task.name}
                    </span>
                    <span className="shrink-0" style={{ color: '#8a8078' }}>
                      {c.job.clientName || c.job.jobName} · #{c.job.jobNumber}
                    </span>
                    <span className="shrink-0 text-[10px] px-1 py-0.5 rounded" style={{ background: '#ffffff', color: '#8a8078', border: '1px solid rgba(200,140,0,0.10)' }}>
                      {c.kind === 'start' ? 'Starts' : c.kind === 'end' ? 'Ends' : c.kind === 'single' ? 'Single' : 'Active'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Job color legend */}
          {data.jobs.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: '#8a8078' }}>
                Color legend
              </div>
              <div className="flex flex-wrap gap-2">
                {data.jobs.map((j) => (
                  <div
                    key={j.jobId}
                    className="flex items-center gap-1.5 text-xs px-2 py-1 rounded"
                    style={{ background: '#faf8f5', border: '1px solid rgba(200,140,0,0.10)' }}
                  >
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: j.color }} />
                    <span style={{ color: '#1a1a1a' }}>
                      {j.clientName || j.jobName}
                    </span>
                    <span style={{ color: '#8a8078' }}>
                      ({j.activeTaskCount + j.upcomingTaskCount} scheduled)
                    </span>
                  </div>
                ))}
              </div>
            </div>
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
                      {u.job.clientName || u.job.jobName} <span style={{ color: '#8a8078', fontWeight: 400 }}>#{u.job.jobNumber}</span>
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

          {/* Empty state */}
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
// ChipPill - the colored bar inside a day cell
// ============================================================

function ChipPill({ chip }: { chip: CalendarChip }) {
  const { task, job, kind } = chip;
  // 'start' and 'single' get a solid color fill; 'end' gets a lighter
  // outlined version so the eye can spot where a multi-day task wraps
  // up; 'continue' chips render as just a thin colored bar.
  if (kind === 'continue') {
    return (
      <div
        className="text-[9px] truncate px-1 rounded"
        style={{
          background: job.color,
          color: '#ffffff',
          opacity: 0.65,
        }}
        title={`${task.name} (continues)`}
      >
        {task.name}
      </div>
    );
  }
  const isEnd = kind === 'end';
  return (
    <div
      className="text-[9px] truncate px-1 rounded"
      style={{
        background: isEnd ? '#ffffff' : job.color,
        color: isEnd ? job.color : '#ffffff',
        border: `1px solid ${job.color}`,
        fontWeight: 600,
      }}
      title={`${task.name} (${kind === 'single' ? 'one-day' : kind})`}
    >
      {task.name}
    </div>
  );
}

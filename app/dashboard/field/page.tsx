// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, Loader2, RefreshCw, Calendar,
  ChevronRight, Check, MessageSquare
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import Link from 'next/link';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ============================================================
// Job color palette
// ============================================================
const JOB_COLORS = [
  { bg: 'rgba(205,162,116,0.18)', border: '#CDA274', text: '#CDA274', dot: '#CDA274' },
  { bg: 'rgba(59,130,246,0.15)', border: '#3b82f6', text: '#60a5fa', dot: '#3b82f6' },
  { bg: 'rgba(34,197,94,0.15)', border: '#22c55e', text: '#4ade80', dot: '#22c55e' },
  { bg: 'rgba(168,85,247,0.15)', border: '#a855f7', text: '#c084fc', dot: '#a855f7' },
  { bg: 'rgba(236,72,153,0.15)', border: '#ec4899', text: '#f472b6', dot: '#ec4899' },
  { bg: 'rgba(245,158,11,0.15)', border: '#f59e0b', text: '#fbbf24', dot: '#f59e0b' },
  { bg: 'rgba(20,184,166,0.15)', border: '#14b8a6', text: '#2dd4bf', dot: '#14b8a6' },
  { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#f87171', dot: '#ef4444' },
];

// ============================================================
// Types
// ============================================================
interface CalendarTask {
  id: string; name: string; date: string;
  startDate: string | null; endDate: string | null;
  progress: number | null; isComplete: boolean;
  jobId: string; jobName: string; jobNumber: string;
}

interface OverdueTask {
  id: string; name: string; date: string;
  progress: number | null;
  jobId: string; jobName: string; jobNumber: string;
}

interface JobItem {
  id: string; name: string; number: string;
  clientName: string; customStatus: string | null;
}

interface DashboardData {
  userName: string; briefing: string;
  weekStartDate: string; todayDate: string;
  overdueTasks: OverdueTask[];
  calendarTasks: CalendarTask[];
  activeJobs: JobItem[];
}

// ============================================================
// Main Page
// ============================================================
export default function FieldDashboardPage() {
  const auth = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/field-dashboard', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Failed to load');
      setData(await res.json());
    } catch (e: any) {
      setError(e.message || 'Failed to load dashboard');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Job color map
  const jobColorMap = useMemo(() => {
    if (!data?.activeJobs) return {};
    const map: Record<string, typeof JOB_COLORS[0]> = {};
    data.activeJobs.forEach((job, i) => { map[job.id] = JOB_COLORS[i % JOB_COLORS.length]; });
    return map;
  }, [data?.activeJobs]);

  // Build week grids
  const weeks = useMemo(() => {
    if (!data?.weekStartDate) return [];
    const start = new Date(data.weekStartDate + 'T12:00:00');
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const result = [];
    for (let w = 0; w < 2; w++) {
      const days = [];
      for (let d = 0; d < 7; d++) {
        const dt = new Date(start);
        dt.setDate(start.getDate() + w * 7 + d);
        days.push({
          date: dt.toISOString().split('T')[0],
          dayName: dayNames[d],
          dayNum: dt.getDate(),
          month: dt.toLocaleDateString('en-US', { month: 'short' }),
          isWeekend: d >= 5,
        });
      }
      result.push({ label: w === 0 ? 'This Week' : 'Next Week', days });
    }
    return result;
  }, [data?.weekStartDate]);

  // Tasks grouped by date
  const tasksByDate = useMemo(() => {
    if (!data?.calendarTasks) return {};
    const map: Record<string, CalendarTask[]> = {};
    for (const t of data.calendarTasks) {
      if (!map[t.date]) map[t.date] = [];
      map[t.date].push(t);
    }
    return map;
  }, [data?.calendarTasks]);

  const firstName = data?.userName?.split(' ')[0] || auth.user?.name?.split(' ')[0] || '';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin" style={{ color: '#CDA274' }} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="text-center py-16">
        <p className="text-sm mb-3" style={{ color: '#ef4444' }}>{error || 'Something went wrong'}</p>
        <button onClick={() => fetchData()} className="text-xs px-4 py-2 rounded" style={{ background: '#CDA274', color: '#1a1a1a' }}>Retry</button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* ---- HEADER ROW ---- */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold" style={{ color: '#e8e0d8' }}>
          {getGreeting()}, {firstName}
        </h1>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/ask" className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs" style={{ background: 'rgba(205,162,116,0.1)', color: '#CDA274' }}>
            <MessageSquare size={12} /> Ask Agent
          </Link>
          <button onClick={() => fetchData(true)} disabled={refreshing} className="p-1.5 rounded" style={{ background: 'rgba(205,162,116,0.08)' }}>
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} style={{ color: '#CDA274' }} />
          </button>
        </div>
      </div>

      {/* ---- BRIEFING + LEGEND ROW ---- */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <p className="text-xs leading-relaxed flex-1" style={{ color: '#a09890' }}>{data.briefing}</p>
        <div className="flex flex-wrap gap-1.5">
          {data.activeJobs.map(job => {
            const c = jobColorMap[job.id];
            return (
              <a key={job.id} href={`https://app.jobtread.com/jobs/${job.id}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] hover:brightness-125"
                style={{ background: c?.bg, border: `1px solid ${c?.border}40` }}>
                <span className="w-2 h-2 rounded-full" style={{ background: c?.dot }} />
                <span style={{ color: c?.text }}>#{job.number}</span>
              </a>
            );
          })}
        </div>
      </div>

      {/* ---- OVERDUE (compact inline) ---- */}
      {data.overdueTasks.length > 0 && (
        <div className="rounded px-3 py-2 mb-3 flex flex-wrap gap-2 items-center" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: '#ef4444' }}>
            <AlertTriangle size={11} /> OVERDUE
          </span>
          {data.overdueTasks.map(t => {
            const c = jobColorMap[t.jobId];
            const days = Math.floor((new Date(data.todayDate + 'T12:00:00').getTime() - new Date(t.date + 'T12:00:00').getTime()) / 86400000);
            return (
              <span key={t.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px]" style={{ background: 'rgba(239,68,68,0.08)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: c?.dot || '#ef4444' }} />
                <span className="truncate max-w-[150px]" style={{ color: '#e8e0d8' }}>{t.name}</span>
                <span style={{ color: '#ef4444' }}>({days}d)</span>
              </span>
            );
          })}
        </div>
      )}

      {/* ---- WEEK GRIDS ---- */}
      {weeks.map((week, wi) => (
        <div key={wi} className="mb-3">
          {/* Week label + date range */}
          <div className="flex items-center gap-2 mb-1.5">
            <Calendar size={12} style={{ color: '#CDA274' }} />
            <span className="text-[10px] font-bold tracking-wider" style={{ color: '#5a5550' }}>
              {week.label.toUpperCase()}
            </span>
            <span className="text-[10px]" style={{ color: '#3f3f3f' }}>
              {week.days[0].month} {week.days[0].dayNum} – {week.days[6].month} {week.days[6].dayNum}
            </span>
          </div>

          {/* 7-column grid */}
          <div className="grid grid-cols-7 gap-px rounded-lg overflow-hidden" style={{ background: 'rgba(205,162,116,0.06)' }}>
            {week.days.map(day => {
              const isToday = day.date === data.todayDate;
              const isPast = day.date < data.todayDate;
              const tasks = tasksByDate[day.date] || [];
              const incomplete = tasks.filter(t => !t.isComplete);
              const complete = tasks.filter(t => t.isComplete);

              return (
                <div
                  key={day.date}
                  className="flex flex-col"
                  style={{
                    background: isToday ? 'rgba(205,162,116,0.1)' : '#1a1a1a',
                    opacity: isPast && !isToday ? 0.45 : 1,
                    minHeight: 90,
                  }}
                >
                  {/* Day header */}
                  <div className="flex items-center justify-between px-1.5 pt-1.5 pb-1" style={{ borderBottom: '1px solid rgba(205,162,116,0.06)' }}>
                    <span className="text-[9px] font-medium" style={{ color: day.isWeekend ? '#3f3f3f' : '#6a6058' }}>
                      {day.dayName}
                    </span>
                    <span
                      className="text-xs font-bold"
                      style={{
                        color: isToday ? '#CDA274' : day.isWeekend ? '#3f3f3f' : '#8a8078',
                        ...(isToday ? { background: 'rgba(205,162,116,0.2)', borderRadius: 4, padding: '0 4px' } : {}),
                      }}
                    >
                      {day.dayNum}
                    </span>
                  </div>

                  {/* Tasks */}
                  <div className="flex-1 px-1 py-0.5 space-y-0.5 overflow-hidden">
                    {incomplete.map(task => {
                      const c = jobColorMap[task.jobId];
                      return (
                        <div
                          key={task.id}
                          className="px-1 py-0.5 rounded text-[9px] truncate"
                          style={{ background: c?.bg, borderLeft: `2px solid ${c?.dot}`, color: '#e8e0d8' }}
                          title={`${task.name} — #${task.jobNumber}`}
                        >
                          {task.name}
                        </div>
                      );
                    })}
                    {complete.map(task => (
                      <div
                        key={task.id}
                        className="px-1 py-0.5 rounded text-[9px] truncate flex items-center gap-0.5"
                        style={{ color: '#3f3f3f' }}
                        title={`✓ ${task.name} — #${task.jobNumber}`}
                      >
                        <Check size={8} style={{ color: '#22c55e', flexShrink: 0 }} />
                        <span className="line-through truncate">{task.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* ---- ACTIVE JOBS (compact row) ---- */}
      {data.activeJobs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-1">
          {data.activeJobs.map(job => {
            const c = jobColorMap[job.id];
            const upcoming = data.calendarTasks.filter(t => t.jobId === job.id && !t.isComplete).length;
            return (
              <a key={job.id} href={`https://app.jobtread.com/jobs/${job.id}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:brightness-110 transition-colors"
                style={{ background: '#1e1e1e', border: `1px solid ${c?.border}30` }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c?.dot }} />
                <span className="text-xs font-medium truncate flex-1" style={{ color: '#e8e0d8' }}>
                  <span style={{ color: c?.text }}>#{job.number}</span> {job.name}
                </span>
                {upcoming > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(205,162,116,0.1)', color: '#8a8078' }}>
                    {upcoming}
                  </span>
                )}
                <ChevronRight size={12} style={{ color: '#3f3f3f' }} />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

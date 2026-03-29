// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, Loader2, RefreshCw, Calendar,
  Building2, ChevronLeft, ChevronRight, ChevronDown,
  Clock, Check, Pencil, X, MessageSquare
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
// Color palette for jobs (consistent assignment per job)
// ============================================================
const JOB_COLORS = [
  { bg: 'rgba(205,162,116,0.15)', border: 'rgba(205,162,116,0.35)', text: '#CDA274', dot: '#CDA274' },   // gold
  { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.30)', text: '#60a5fa', dot: '#3b82f6' },      // blue
  { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.30)', text: '#4ade80', dot: '#22c55e' },        // green
  { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.30)', text: '#c084fc', dot: '#a855f7' },      // purple
  { bg: 'rgba(236,72,153,0.12)', border: 'rgba(236,72,153,0.30)', text: '#f472b6', dot: '#ec4899' },      // pink
  { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.30)', text: '#fbbf24', dot: '#f59e0b' },      // amber
  { bg: 'rgba(20,184,166,0.12)', border: 'rgba(20,184,166,0.30)', text: '#2dd4bf', dot: '#14b8a6' },      // teal
  { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.30)', text: '#f87171', dot: '#ef4444' },        // red
];

// ============================================================
// Types
// ============================================================
interface CalendarTask {
  id: string;
  name: string;
  date: string;
  startDate: string | null;
  endDate: string | null;
  progress: number | null;
  isComplete: boolean;
  jobId: string;
  jobName: string;
  jobNumber: string;
}

interface OverdueTask {
  id: string;
  name: string;
  date: string;
  progress: number | null;
  jobId: string;
  jobName: string;
  jobNumber: string;
}

interface JobItem {
  id: string;
  name: string;
  number: string;
  clientName: string;
  customStatus: string | null;
}

interface DashboardData {
  userName: string;
  briefing: string;
  weekStartDate: string;
  todayDate: string;
  overdueTasks: OverdueTask[];
  calendarTasks: CalendarTask[];
  activeJobs: JobItem[];
}

// ============================================================
// Helper: get day names for headers
// ============================================================
function getDayHeaders(weekStartStr: string): { date: string; dayName: string; dayNum: number; monthStr: string; isWeekend: boolean }[] {
  const start = new Date(weekStartStr + 'T12:00:00');
  const days = [];
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push({
      date: d.toISOString().split('T')[0],
      dayName: dayNames[i % 7],
      dayNum: d.getDate(),
      monthStr: d.toLocaleDateString('en-US', { month: 'short' }),
      isWeekend: i % 7 >= 5,
    });
  }
  return days;
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
  const [weekOffset, setWeekOffset] = useState(0); // 0 = this/next week, -1 = last week, etc.

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/field-dashboard', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Failed to load');
      const d = await res.json();
      setData(d);
    } catch (e: any) {
      setError(e.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Build job color map
  const jobColorMap = useMemo(() => {
    if (!data?.activeJobs) return {};
    const map: Record<string, typeof JOB_COLORS[0]> = {};
    data.activeJobs.forEach((job, i) => {
      map[job.id] = JOB_COLORS[i % JOB_COLORS.length];
    });
    return map;
  }, [data?.activeJobs]);

  // Calendar days (14 days starting from weekStart)
  const calendarDays = useMemo(() => {
    if (!data?.weekStartDate) return [];
    return getDayHeaders(data.weekStartDate);
  }, [data?.weekStartDate]);

  // Group calendar tasks by date
  const tasksByDate = useMemo(() => {
    if (!data?.calendarTasks) return {};
    const map: Record<string, CalendarTask[]> = {};
    for (const task of data.calendarTasks) {
      if (!map[task.date]) map[task.date] = [];
      map[task.date].push(task);
    }
    return map;
  }, [data?.calendarTasks]);

  const firstName = data?.userName?.split(' ')[0] || auth.user?.name?.split(' ')[0] || 'Team';

  // -- Loading / error states --
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin" style={{ color: '#CDA274' }} />
        <span className="ml-3 text-sm" style={{ color: '#8a8078' }}>Loading your dashboard...</span>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="text-center py-20">
        <AlertTriangle size={24} className="mx-auto mb-3" style={{ color: '#ef4444' }} />
        <p className="text-sm" style={{ color: '#ef4444' }}>{error || 'Something went wrong'}</p>
        <button onClick={() => fetchData()} className="mt-3 text-xs px-4 py-2 rounded" style={{ background: '#CDA274', color: '#1a1a1a' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-20">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#e8e0d8' }}>
            {getGreeting()}, {firstName}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/ask"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ background: 'rgba(205,162,116,0.1)', color: '#CDA274' }}
          >
            <MessageSquare size={13} />
            Ask Agent
          </Link>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="p-2 rounded-lg"
            style={{ background: 'rgba(205,162,116,0.08)' }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} style={{ color: '#CDA274' }} />
          </button>
        </div>
      </div>

      {/* Briefing */}
      <div className="rounded-lg px-4 py-3 mb-4" style={{ background: 'rgba(205,162,116,0.06)', border: '1px solid rgba(205,162,116,0.12)' }}>
        <p className="text-sm leading-relaxed" style={{ color: '#e8e0d8' }}>{data.briefing}</p>
      </div>

      {/* Job Legend */}
      {data.activeJobs.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          {data.activeJobs.map(job => {
            const color = jobColorMap[job.id];
            return (
              <a
                key={job.id}
                href={`https://app.jobtread.com/jobs/${job.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors hover:brightness-110"
                style={{ background: color?.bg || '#242424', border: `1px solid ${color?.border || '#333'}` }}
              >
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color?.dot || '#888' }} />
                <span style={{ color: color?.text || '#e8e0d8' }}>#{job.number}</span>
                <span className="truncate max-w-[140px]" style={{ color: '#a09890' }}>{job.name}</span>
              </a>
            );
          })}
        </div>
      )}

      {/* Overdue Section */}
      {data.overdueTasks.length > 0 && (
        <div className="rounded-lg px-4 py-3 mb-4" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} style={{ color: '#ef4444' }} />
            <span className="text-xs font-semibold" style={{ color: '#ef4444' }}>
              Overdue ({data.overdueTasks.length})
            </span>
          </div>
          <div className="space-y-1.5">
            {data.overdueTasks.map(task => {
              const color = jobColorMap[task.jobId];
              const daysOverdue = Math.floor((new Date(data.todayDate + 'T12:00:00').getTime() - new Date(task.date + 'T12:00:00').getTime()) / 86400000);
              return (
                <div key={task.id} className="flex items-center gap-3 px-3 py-2 rounded" style={{ background: 'rgba(239,68,68,0.05)' }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color?.dot || '#ef4444' }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm truncate block" style={{ color: '#e8e0d8' }}>{task.name}</span>
                    <span className="text-[10px]" style={{ color: '#8a8078' }}>#{task.jobNumber}</span>
                  </div>
                  <span className="text-[10px] flex-shrink-0 px-2 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                    {daysOverdue}d overdue
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- 2-WEEK CALENDAR ---- */}
      <div className="rounded-lg overflow-hidden" style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)' }}>
        {/* Calendar header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(205,162,116,0.08)' }}>
          <div className="flex items-center gap-2">
            <Calendar size={15} style={{ color: '#CDA274' }} />
            <span className="text-sm font-semibold" style={{ color: '#CDA274' }}>Schedule</span>
          </div>
          <span className="text-xs" style={{ color: '#8a8078' }}>
            {calendarDays.length > 0 && (
              <>
                {calendarDays[0].monthStr} {calendarDays[0].dayNum} – {calendarDays[13]?.monthStr} {calendarDays[13]?.dayNum}
              </>
            )}
          </span>
        </div>

        {/* Week 1 Label */}
        <div className="px-4 pt-3 pb-1">
          <span className="text-[10px] font-semibold tracking-widest" style={{ color: '#5a5550' }}>THIS WEEK</span>
        </div>

        {/* Week 1: Days 0-6 */}
        <div className="px-3 pb-2">
          {calendarDays.slice(0, 7).map(day => {
            const isToday = day.date === data.todayDate;
            const tasks = tasksByDate[day.date] || [];
            const incompleteTasks = tasks.filter(t => !t.isComplete);
            const completeTasks = tasks.filter(t => t.isComplete);
            const isPast = day.date < data.todayDate;

            return (
              <div
                key={day.date}
                className="flex items-start gap-3 px-2 py-2"
                style={{
                  borderBottom: '1px solid rgba(205,162,116,0.04)',
                  opacity: isPast && !isToday ? 0.5 : 1,
                  background: isToday ? 'rgba(205,162,116,0.06)' : 'transparent',
                  borderRadius: isToday ? 6 : 0,
                }}
              >
                {/* Day label */}
                <div className="flex-shrink-0 text-center" style={{ width: 44 }}>
                  <div className="text-[10px] font-medium" style={{ color: isToday ? '#CDA274' : day.isWeekend ? '#5a5550' : '#8a8078' }}>
                    {day.dayName}
                  </div>
                  <div
                    className="text-base font-bold"
                    style={{
                      color: isToday ? '#CDA274' : day.isWeekend ? '#5a5550' : '#e8e0d8',
                    }}
                  >
                    {day.dayNum}
                  </div>
                </div>

                {/* Tasks for this day */}
                <div className="flex-1 min-w-0">
                  {incompleteTasks.length === 0 && completeTasks.length === 0 && (
                    <div className="py-1">
                      <span className="text-xs" style={{ color: '#3f3f3f' }}>—</span>
                    </div>
                  )}
                  {incompleteTasks.map(task => {
                    const color = jobColorMap[task.jobId];
                    return (
                      <div
                        key={task.id}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded mb-1"
                        style={{
                          background: color?.bg || 'rgba(205,162,116,0.08)',
                          borderLeft: `3px solid ${color?.dot || '#CDA274'}`,
                        }}
                      >
                        <span className="text-xs flex-1 truncate" style={{ color: '#e8e0d8' }}>{task.name}</span>
                        <span className="text-[10px] flex-shrink-0" style={{ color: color?.text || '#8a8078' }}>#{task.jobNumber}</span>
                      </div>
                    );
                  })}
                  {completeTasks.map(task => {
                    const color = jobColorMap[task.jobId];
                    return (
                      <div
                        key={task.id}
                        className="flex items-center gap-2 px-2.5 py-1 rounded mb-1"
                        style={{ background: 'rgba(34,197,94,0.05)', borderLeft: '3px solid rgba(34,197,94,0.3)' }}
                      >
                        <Check size={11} style={{ color: '#22c55e' }} />
                        <span className="text-xs flex-1 truncate line-through" style={{ color: '#5a5550' }}>{task.name}</span>
                        <span className="text-[10px] flex-shrink-0" style={{ color: '#5a5550' }}>#{task.jobNumber}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Week 2 Label */}
        <div className="px-4 pt-2 pb-1" style={{ borderTop: '1px solid rgba(205,162,116,0.08)' }}>
          <span className="text-[10px] font-semibold tracking-widest" style={{ color: '#5a5550' }}>NEXT WEEK</span>
        </div>

        {/* Week 2: Days 7-13 */}
        <div className="px-3 pb-3">
          {calendarDays.slice(7, 14).map(day => {
            const tasks = tasksByDate[day.date] || [];
            const incompleteTasks = tasks.filter(t => !t.isComplete);
            const completeTasks = tasks.filter(t => t.isComplete);

            return (
              <div
                key={day.date}
                className="flex items-start gap-3 px-2 py-2"
                style={{ borderBottom: '1px solid rgba(205,162,116,0.04)' }}
              >
                {/* Day label */}
                <div className="flex-shrink-0 text-center" style={{ width: 44 }}>
                  <div className="text-[10px] font-medium" style={{ color: day.isWeekend ? '#5a5550' : '#8a8078' }}>
                    {day.dayName}
                  </div>
                  <div className="text-base font-bold" style={{ color: day.isWeekend ? '#5a5550' : '#e8e0d8' }}>
                    {day.dayNum}
                  </div>
                </div>

                {/* Tasks for this day */}
                <div className="flex-1 min-w-0">
                  {incompleteTasks.length === 0 && completeTasks.length === 0 && (
                    <div className="py-1">
                      <span className="text-xs" style={{ color: '#3f3f3f' }}>—</span>
                    </div>
                  )}
                  {incompleteTasks.map(task => {
                    const color = jobColorMap[task.jobId];
                    return (
                      <div
                        key={task.id}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded mb-1"
                        style={{
                          background: color?.bg || 'rgba(205,162,116,0.08)',
                          borderLeft: `3px solid ${color?.dot || '#CDA274'}`,
                        }}
                      >
                        <span className="text-xs flex-1 truncate" style={{ color: '#e8e0d8' }}>{task.name}</span>
                        <span className="text-[10px] flex-shrink-0" style={{ color: color?.text || '#8a8078' }}>#{task.jobNumber}</span>
                      </div>
                    );
                  })}
                  {completeTasks.map(task => (
                    <div
                      key={task.id}
                      className="flex items-center gap-2 px-2.5 py-1 rounded mb-1"
                      style={{ background: 'rgba(34,197,94,0.05)', borderLeft: '3px solid rgba(34,197,94,0.3)' }}
                    >
                      <Check size={11} style={{ color: '#22c55e' }} />
                      <span className="text-xs flex-1 truncate line-through" style={{ color: '#5a5550' }}>{task.name}</span>
                      <span className="text-[10px] flex-shrink-0" style={{ color: '#5a5550' }}>#{task.jobNumber}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Jobs - clickable to JT */}
      {data.activeJobs.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <Building2 size={15} style={{ color: '#CDA274' }} />
            <span className="text-sm font-semibold" style={{ color: '#CDA274' }}>
              Active Jobs ({data.activeJobs.length})
            </span>
          </div>
          <div className="space-y-2">
            {data.activeJobs.map(job => {
              const color = jobColorMap[job.id];
              const statusColors: Record<string, string> = {
                'Pre-Construction': '#CDA274',
                'In Progress': '#22c55e',
                'On Hold': '#eab308',
                'Punch List': '#f97316',
              };
              const statusColor = statusColors[job.customStatus || ''] || '#8a8078';
              const jobTasks = data.calendarTasks.filter(t => t.jobId === job.id && !t.isComplete);

              return (
                <a
                  key={job.id}
                  href={`https://app.jobtread.com/jobs/${job.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg px-4 py-3 transition-colors hover:brightness-110"
                  style={{ background: '#242424', border: `1px solid ${color?.border || 'rgba(205,162,116,0.08)'}` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color?.dot || '#888' }} />
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'rgba(205,162,116,0.1)', color: '#CDA274' }}>
                        #{job.number}
                      </span>
                      <span className="text-sm font-medium truncate" style={{ color: '#e8e0d8' }}>{job.name}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {job.customStatus && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: statusColor + '18', color: statusColor }}>
                          {job.customStatus}
                        </span>
                      )}
                      {jobTasks.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(205,162,116,0.1)', color: '#8a8078' }}>
                          {jobTasks.length} upcoming
                        </span>
                      )}
                      <ChevronRight size={14} style={{ color: '#5a5550' }} />
                    </div>
                  </div>
                  {job.clientName && (
                    <div className="mt-1 ml-5">
                      <span className="text-xs" style={{ color: '#8a8078' }}>{job.clientName}</span>
                    </div>
                  )}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, Loader2, RefreshCw, Calendar,
  ChevronRight, Check, MessageSquare, ChevronDown, ChevronUp
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
// Consistent color for a job based on its number
// ============================================================
const PALETTE = [
  '#CDA274', '#3b82f6', '#22c55e', '#a855f7',
  '#ec4899', '#f59e0b', '#14b8a6', '#ef4444',
  '#6366f1', '#84cc16', '#f97316', '#06b6d4',
];

function jobColor(jobNumber: string): string {
  // Simple hash from job number string
  let hash = 0;
  for (let i = 0; i < jobNumber.length; i++) hash = hash * 31 + jobNumber.charCodeAt(i);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

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
  const [showOverdue, setShowOverdue] = useState(false);

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

  // Jobs that actually appear in the calendar (for a minimal legend)
  const calendarJobIds = useMemo(() => {
    if (!data?.calendarTasks) return new Set<string>();
    return new Set(data.calendarTasks.filter(t => !t.isComplete).map(t => t.jobId));
  }, [data?.calendarTasks]);

  const firstName = data?.userName?.split(' ')[0] || auth.user?.name?.split(' ')[0] || '';

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
        <Loader2 size={20} className="animate-spin" style={{ color: '#CDA274' }} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error || 'Something went wrong'}</p>
        <button onClick={() => fetchData()} style={{ background: '#CDA274', color: '#1a1a1a', fontSize: 12, padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer' }}>Retry</button>
      </div>
    );
  }

  const overdueCount = data.overdueTasks.length;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 8px' }}>
      {/* ---- HEADER ---- */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ color: '#e8e0d8', fontSize: 18, fontWeight: 700, margin: 0 }}>
          {getGreeting()}, {firstName}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link href="/dashboard/ask" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, fontSize: 11, background: 'rgba(205,162,116,0.1)', color: '#CDA274', textDecoration: 'none' }}>
            <MessageSquare size={11} /> Ask Agent
          </Link>
          <button onClick={() => fetchData(true)} disabled={refreshing} style={{ padding: 5, borderRadius: 6, background: 'rgba(205,162,116,0.08)', border: 'none', cursor: 'pointer' }}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} style={{ color: '#CDA274' }} />
          </button>
        </div>
      </div>

      {/* ---- OVERDUE BANNER (if any) ---- */}
      {overdueCount > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 8, marginBottom: 8 }}>
          <button
            onClick={() => setShowOverdue(!showOverdue)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <AlertTriangle size={12} style={{ color: '#ef4444', flexShrink: 0 }} />
            <span style={{ color: '#ef4444', fontSize: 12, fontWeight: 700 }}>{overdueCount} overdue</span>
            <span style={{ color: '#8a8078', fontSize: 11, flex: 1 }}>
              — {data.overdueTasks.slice(0, 3).map(t => t.name).join(', ')}{overdueCount > 3 ? '...' : ''}
            </span>
            {showOverdue ? <ChevronUp size={12} style={{ color: '#8a8078' }} /> : <ChevronDown size={12} style={{ color: '#8a8078' }} />}
          </button>
          {showOverdue && (
            <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
              {data.overdueTasks.map(t => {
                const days = Math.floor((new Date(data.todayDate + 'T12:00:00').getTime() - new Date(t.date + 'T12:00:00').getTime()) / 86400000);
                const c = jobColor(t.jobNumber);
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0' }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: c, flexShrink: 0 }} />
                    <span style={{ color: '#e8e0d8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    <span style={{ color: '#8a8078', flexShrink: 0, fontSize: 10 }}>#{t.jobNumber}</span>
                    <span style={{ color: '#ef4444', flexShrink: 0, fontSize: 10, fontWeight: 600 }}>{days}d</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---- WEEK CALENDARS ---- */}
      {weeks.map((week, wi) => (
        <div key={wi} style={{ marginBottom: 10 }}>
          {/* Week header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Calendar size={11} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#5a5550' }}>
              {week.label.toUpperCase()}
            </span>
            <span style={{ fontSize: 10, color: '#3f3f3f' }}>
              {week.days[0].month} {week.days[0].dayNum} – {week.days[6].month} {week.days[6].dayNum}
            </span>
          </div>

          {/* 7-column grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, borderRadius: 8, overflow: 'hidden' }}>
            {week.days.map(day => {
              const isToday = day.date === data.todayDate;
              const isPast = day.date < data.todayDate;
              const tasks = tasksByDate[day.date] || [];
              const incomplete = tasks.filter(t => !t.isComplete);
              const complete = tasks.filter(t => t.isComplete);

              return (
                <div
                  key={day.date}
                  style={{
                    background: isToday ? 'rgba(205,162,116,0.1)' : '#1a1a1a',
                    opacity: isPast && !isToday ? 0.4 : 1,
                    minHeight: 80,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Day header */}
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 5px 2px' }}>
                    <span style={{ fontSize: 9, fontWeight: 500, color: day.isWeekend ? '#3a3a3a' : '#6a6058' }}>
                      {day.dayName}
                    </span>
                    <span style={{
                      fontSize: 13, fontWeight: 700,
                      color: isToday ? '#CDA274' : day.isWeekend ? '#3a3a3a' : '#7a7068',
                      ...(isToday ? { background: 'rgba(205,162,116,0.25)', borderRadius: 4, padding: '0 4px' } : {}),
                    }}>
                      {day.dayNum}
                    </span>
                  </div>

                  {/* Tasks */}
                  <div style={{ flex: 1, padding: '2px 3px 3px', display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                    {incomplete.map(task => {
                      const c = jobColor(task.jobNumber);
                      return (
                        <div
                          key={task.id}
                          title={`${task.name} — #${task.jobNumber} ${task.jobName}`}
                          style={{
                            padding: '2px 4px',
                            borderRadius: 3,
                            borderLeft: `3px solid ${c}`,
                            background: `${c}20`,
                            fontSize: 9,
                            lineHeight: '13px',
                            color: '#e8e0d8',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {task.name}
                        </div>
                      );
                    })}
                    {complete.length > 0 && (
                      <div style={{ fontSize: 9, color: '#3a3a3a', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Check size={8} style={{ color: '#22c55e' }} />
                        {complete.length} done
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* ---- LEGEND: only jobs visible in calendar ---- */}
      {calendarJobIds.size > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, marginTop: 2 }}>
          {data.activeJobs
            .filter(j => calendarJobIds.has(j.id))
            .map(job => {
              const c = jobColor(job.number);
              return (
                <a
                  key={job.id}
                  href={`https://app.jobtread.com/jobs/${job.id}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#8a8078', textDecoration: 'none' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: c, flexShrink: 0 }} />
                  <span>#{job.number}</span>
                  <span style={{ color: '#5a5550', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.name}</span>
                </a>
              );
            })}
        </div>
      )}

      {/* ---- ACTIVE JOBS (compact) ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
        {data.activeJobs.map(job => {
          const c = jobColor(job.number);
          const upcoming = data.calendarTasks.filter(t => t.jobId === job.id && !t.isComplete).length;
          return (
            <a
              key={job.id}
              href={`https://app.jobtread.com/jobs/${job.id}`}
              target="_blank" rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', borderRadius: 6,
                background: '#1e1e1e', border: '1px solid #2a2a2a',
                textDecoration: 'none', fontSize: 11,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 3, background: c, flexShrink: 0 }} />
              <span style={{ color: '#8a8078', flexShrink: 0 }}>#{job.number}</span>
              <span style={{ color: '#e8e0d8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.name}</span>
              {upcoming > 0 && (
                <span style={{ fontSize: 9, color: '#5a5550', flexShrink: 0 }}>{upcoming}</span>
              )}
              <ChevronRight size={10} style={{ color: '#3a3a3a', flexShrink: 0 }} />
            </a>
          );
        })}
      </div>
    </div>
  );
}

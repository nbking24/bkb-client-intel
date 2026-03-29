// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, Loader2, RefreshCw, Calendar,
  Check, MessageSquare, ChevronDown, ChevronUp,
  Zap, ClipboardList
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

// Consistent color from job number
const PALETTE = [
  '#CDA274', '#3b82f6', '#22c55e', '#a855f7',
  '#ec4899', '#f59e0b', '#14b8a6', '#ef4444',
  '#6366f1', '#84cc16', '#f97316', '#06b6d4',
];
function jobColor(jobNumber: string): string {
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
interface OpenTask {
  id: string; name: string; endDate: string | null;
  progress: number | null;
  jobName: string; jobNumber: string; jobId: string;
}
interface DashboardData {
  userName: string; briefing: string;
  weekStartDate: string; todayDate: string;
  overdueTasks: OverdueTask[];
  calendarTasks: CalendarTask[];
  openTasks: OpenTask[];
  activeJobCount: number;
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
  const [showTasks, setShowTasks] = useState(false);

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
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Week grids
  const weeks = useMemo(() => {
    if (!data?.weekStartDate) return [];
    const start = new Date(data.weekStartDate + 'T12:00:00');
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return [0, 1].map(w => ({
      label: w === 0 ? 'This Week' : 'Next Week',
      days: Array.from({ length: 7 }, (_, d) => {
        const dt = new Date(start);
        dt.setDate(start.getDate() + w * 7 + d);
        return {
          date: dt.toISOString().split('T')[0],
          dayName: dayNames[d],
          dayNum: dt.getDate(),
          month: dt.toLocaleDateString('en-US', { month: 'short' }),
          isWeekend: d >= 5,
        };
      }),
    }));
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

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 8px' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ color: '#e8e0d8', fontSize: 18, fontWeight: 700, margin: 0 }}>
          {getGreeting()}, {firstName}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link href="/dashboard/ask" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, fontSize: 11, background: 'rgba(205,162,116,0.1)', color: '#CDA274', textDecoration: 'none' }}>
            <MessageSquare size={11} /> Ask Agent
          </Link>
          <button onClick={() => fetchData(true)} disabled={refreshing} style={{ padding: 5, borderRadius: 6, background: 'rgba(205,162,116,0.08)', border: 'none', cursor: 'pointer', lineHeight: 0 }}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} style={{ color: '#CDA274' }} />
          </button>
        </div>
      </div>

      {/* AI BRIEFING */}
      <div style={{ background: 'rgba(205,162,116,0.06)', border: '1px solid rgba(205,162,116,0.12)', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          <Zap size={11} style={{ color: '#CDA274' }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: '#CDA274', letterSpacing: '0.03em' }}>BRIEFING</span>
        </div>
        <p style={{ fontSize: 12, lineHeight: '18px', color: '#e8e0d8', margin: 0 }}>{data.briefing}</p>
      </div>

      {/* OVERDUE BANNER */}
      {data.overdueTasks.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
          <button
            onClick={() => setShowOverdue(!showOverdue)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '7px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <AlertTriangle size={12} style={{ color: '#ef4444', flexShrink: 0 }} />
            <span style={{ color: '#ef4444', fontSize: 12, fontWeight: 700 }}>{data.overdueTasks.length} overdue</span>
            <span style={{ color: '#6a6058', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              — {data.overdueTasks.slice(0, 2).map(t => t.name).join(', ')}{data.overdueTasks.length > 2 ? '...' : ''}
            </span>
            {showOverdue ? <ChevronUp size={12} style={{ color: '#6a6058' }} /> : <ChevronDown size={12} style={{ color: '#6a6058' }} />}
          </button>
          {showOverdue && (
            <div style={{ padding: '0 12px 8px', maxHeight: 160, overflowY: 'auto' }}>
              {data.overdueTasks.map(t => {
                const days = Math.floor((new Date(data.todayDate + 'T12:00:00').getTime() - new Date(t.date + 'T12:00:00').getTime()) / 86400000);
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0', borderBottom: '1px solid rgba(239,68,68,0.06)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: jobColor(t.jobNumber), flexShrink: 0 }} />
                    <span style={{ color: '#e8e0d8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    <span style={{ color: '#6a6058', flexShrink: 0, fontSize: 10 }}>#{t.jobNumber}</span>
                    <span style={{ color: '#ef4444', flexShrink: 0, fontSize: 10, fontWeight: 600 }}>{days}d</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* WEEK CALENDARS */}
      {weeks.map((week, wi) => (
        <div key={wi} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <Calendar size={11} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#5a5550' }}>{week.label.toUpperCase()}</span>
            <span style={{ fontSize: 10, color: '#3f3f3f' }}>{week.days[0].month} {week.days[0].dayNum} – {week.days[6].month} {week.days[6].dayNum}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, borderRadius: 8, overflow: 'hidden' }}>
            {week.days.map(day => {
              const isToday = day.date === data.todayDate;
              const isPast = day.date < data.todayDate;
              const tasks = tasksByDate[day.date] || [];
              const incomplete = tasks.filter(t => !t.isComplete);
              const complete = tasks.filter(t => t.isComplete);

              return (
                <div key={day.date} style={{
                  background: isToday ? 'rgba(205,162,116,0.1)' : '#1a1a1a',
                  opacity: isPast && !isToday ? 0.4 : 1,
                  minHeight: 76, display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '3px 5px 2px' }}>
                    <span style={{ fontSize: 9, fontWeight: 500, color: day.isWeekend ? '#3a3a3a' : '#6a6058' }}>{day.dayName}</span>
                    <span style={{
                      fontSize: 13, fontWeight: 700,
                      color: isToday ? '#CDA274' : day.isWeekend ? '#3a3a3a' : '#7a7068',
                      ...(isToday ? { background: 'rgba(205,162,116,0.25)', borderRadius: 4, padding: '0 4px' } : {}),
                    }}>{day.dayNum}</span>
                  </div>
                  <div style={{ flex: 1, padding: '1px 3px 3px', display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                    {incomplete.map(task => (
                      <div key={task.id} title={`${task.name} — #${task.jobNumber} ${task.jobName}`}
                        style={{
                          padding: '2px 4px', borderRadius: 3,
                          borderLeft: `3px solid ${jobColor(task.jobNumber)}`,
                          background: `${jobColor(task.jobNumber)}20`,
                          fontSize: 9, lineHeight: '12px', color: '#e8e0d8',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{task.name}</div>
                    ))}
                    {complete.length > 0 && (
                      <div style={{ fontSize: 8, color: '#3a3a3a', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Check size={7} style={{ color: '#22c55e' }} /> {complete.length} done
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* OPEN TASKS (collapsible) */}
      {data.openTasks && data.openTasks.length > 0 && (
        <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
          <button
            onClick={() => setShowTasks(!showTasks)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <ClipboardList size={12} style={{ color: '#CDA274', flexShrink: 0 }} />
            <span style={{ color: '#CDA274', fontSize: 12, fontWeight: 600 }}>Open Tasks</span>
            <span style={{ color: '#5a5550', fontSize: 11 }}>({data.openTasks.length})</span>
            <span style={{ flex: 1 }} />
            {showTasks ? <ChevronUp size={12} style={{ color: '#5a5550' }} /> : <ChevronDown size={12} style={{ color: '#5a5550' }} />}
          </button>
          {showTasks && (
            <div style={{ padding: '0 12px 8px', maxHeight: 280, overflowY: 'auto' }}>
              {data.openTasks.map(task => {
                const isOverdue = task.endDate && task.endDate < data.todayDate;
                const dueLabel = !task.endDate ? 'No date'
                  : task.endDate === data.todayDate ? 'Today'
                  : isOverdue ? (() => {
                    const d = Math.floor((new Date(data.todayDate + 'T12:00:00').getTime() - new Date(task.endDate + 'T12:00:00').getTime()) / 86400000);
                    return `${d}d overdue`;
                  })()
                  : (() => {
                    const d = Math.floor((new Date(task.endDate + 'T12:00:00').getTime() - new Date(data.todayDate + 'T12:00:00').getTime()) / 86400000);
                    return d === 1 ? 'Tomorrow' : `${d}d`;
                  })();

                return (
                  <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid rgba(205,162,116,0.04)', fontSize: 11 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: jobColor(task.jobNumber), flexShrink: 0 }} />
                    <span style={{ color: '#e8e0d8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name}</span>
                    <span style={{ color: '#5a5550', flexShrink: 0, fontSize: 10 }}>#{task.jobNumber}</span>
                    <span style={{
                      flexShrink: 0, fontSize: 10, fontWeight: 500,
                      color: isOverdue ? '#ef4444' : task.endDate === data.todayDate ? '#eab308' : '#5a5550',
                    }}>{dueLabel}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

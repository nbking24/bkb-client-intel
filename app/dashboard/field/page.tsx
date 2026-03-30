// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, Loader2, RefreshCw, Calendar,
  Check, MessageSquare, ChevronDown, ChevronUp,
  Zap, ClipboardList, Circle, CheckCircle2
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import Link from 'next/link';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}
function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const PALETTE = [
  '#CDA274', '#3b82f6', '#22c55e', '#a855f7',
  '#ec4899', '#f59e0b', '#14b8a6', '#ef4444',
  '#6366f1', '#84cc16', '#f97316', '#06b6d4',
];
function jobColor(n: string): string {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = h * 31 + n.charCodeAt(i);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

// Types
interface CalTask {
  id: string; name: string; date: string;
  startDate: string | null; endDate: string | null;
  progress: number | null; isComplete: boolean;
  jobId: string; jobName: string; jobNumber: string;
  isAssignedToMe: boolean;
}
interface OdTask {
  id: string; name: string; date: string; progress: number | null;
  jobId: string; jobName: string; jobNumber: string;
  isAssignedToMe: boolean;
}
interface OpenTask {
  id: string; name: string; endDate: string | null; progress: number | null;
  jobName: string; jobNumber: string; jobId: string;
}
interface Data {
  userName: string; briefing: string;
  week1Start: string; todayDate: string;
  overdueTasks: OdTask[]; calendarTasks: CalTask[];
  openTasks: OpenTask[]; activeJobCount: number;
}

export default function FieldDashboardPage() {
  const auth = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showTasks, setShowTasks] = useState(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/field-dashboard', { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error('Failed to load');
      setData(await res.json());
    } catch (e: any) { setError(e.message || 'Failed'); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const toggleComplete = async (taskId: string, currentlyComplete: boolean) => {
    setCompleting(prev => new Set(prev).add(taskId));
    try {
      const res = await fetch('/api/field-dashboard', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ taskId, complete: !currentlyComplete }),
      });
      if (!res.ok) throw new Error('Failed');
      // Update local state
      if (data) {
        setData({
          ...data,
          calendarTasks: data.calendarTasks.map(t =>
            t.id === taskId ? { ...t, isComplete: !currentlyComplete, progress: !currentlyComplete ? 1 : 0 } : t
          ),
          openTasks: !currentlyComplete
            ? data.openTasks.filter(t => t.id !== taskId)
            : data.openTasks,
        });
      }
    } catch { /* silent */ }
    finally { setCompleting(prev => { const s = new Set(prev); s.delete(taskId); return s; }); }
  };

  useEffect(() => { fetchData(); }, []);

  // Week grids: 2 weeks forward from week1Start
  const weeks = useMemo(() => {
    if (!data?.week1Start) return [];
    const start = new Date(data.week1Start + 'T12:00:00');
    const dn = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return [0, 1].map(w => ({
      label: w === 0 ? 'Upcoming Week' : 'Following Week',
      days: Array.from({ length: 7 }, (_, d) => {
        const dt = new Date(start);
        dt.setDate(start.getDate() + w * 7 + d);
        return {
          date: dt.toISOString().split('T')[0],
          dayName: dn[d],
          dayNum: dt.getDate(),
          month: dt.toLocaleDateString('en-US', { month: 'short' }),
          isWeekend: d >= 5,
        };
      }),
    }));
  }, [data?.week1Start]);

  const tasksByDate = useMemo(() => {
    if (!data?.calendarTasks) return {};
    const m: Record<string, CalTask[]> = {};
    for (const t of data.calendarTasks) { if (!m[t.date]) m[t.date] = []; m[t.date].push(t); }
    return m;
  }, [data?.calendarTasks]);

  // Week 1 end date for "assigned to me" highlighting
  const week1End = useMemo(() => {
    if (!data?.week1Start) return '';
    const d = new Date(data.week1Start + 'T12:00:00');
    d.setDate(d.getDate() + 6);
    return d.toISOString().split('T')[0];
  }, [data?.week1Start]);

  const firstName = data?.userName?.split(' ')[0] || auth.user?.name?.split(' ')[0] || '';
  const overdueCount = data?.overdueTasks?.length || 0;
  const openCount = data?.openTasks?.length || 0;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <Loader2 size={20} className="animate-spin" style={{ color: '#CDA274' }} />
    </div>
  );
  if (error || !data) return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error || 'Something went wrong'}</p>
      <button onClick={() => fetchData()} style={{ background: '#CDA274', color: '#1a1a1a', fontSize: 12, padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer' }}>Retry</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 8px' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ color: '#e8e0d8', fontSize: 18, fontWeight: 700, margin: 0 }}>{getGreeting()}, {firstName}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link href="/dashboard/ask" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, fontSize: 11, background: 'rgba(205,162,116,0.1)', color: '#CDA274', textDecoration: 'none' }}>
            <MessageSquare size={11} /> Ask Agent
          </Link>
          <button onClick={() => fetchData(true)} disabled={refreshing} style={{ padding: 5, borderRadius: 6, background: 'rgba(205,162,116,0.08)', border: 'none', cursor: 'pointer', lineHeight: 0 }}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} style={{ color: '#CDA274' }} />
          </button>
        </div>
      </div>

      {/* BRIEFING */}
      <div style={{ background: 'rgba(205,162,116,0.06)', border: '1px solid rgba(205,162,116,0.12)', borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
          <Zap size={10} style={{ color: '#CDA274' }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: '#CDA274', letterSpacing: '0.06em' }}>BRIEFING</span>
        </div>
        <p style={{ fontSize: 12, lineHeight: '17px', color: '#e8e0d8', margin: 0 }}>{data.briefing}</p>
      </div>

      {/* OVERDUE + OPEN TASKS — collapsible side by side */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {/* Overdue */}
        <button
          onClick={() => overdueCount > 0 && setShowTasks(showTasks === 'overdue' ? false : 'overdue')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 10px', borderRadius: 8, border: 'none', cursor: overdueCount > 0 ? 'pointer' : 'default',
            background: overdueCount > 0 ? 'rgba(239,68,68,0.07)' : '#1e1e1e',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: overdueCount > 0 ? 'rgba(239,68,68,0.18)' : 'rgba(205,162,116,0.06)',
            textAlign: 'left',
          }}
        >
          <AlertTriangle size={13} style={{ color: overdueCount > 0 ? '#ef4444' : '#3a3a3a', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: overdueCount > 0 ? '#ef4444' : '#3a3a3a', lineHeight: 1 }}>{overdueCount}</div>
            <div style={{ fontSize: 9, color: '#6a6058', marginTop: 1 }}>Overdue</div>
          </div>
          {overdueCount > 0 && (showTasks === 'overdue' ? <ChevronUp size={12} style={{ color: '#6a6058' }} /> : <ChevronDown size={12} style={{ color: '#6a6058' }} />)}
        </button>

        {/* Open tasks */}
        <button
          onClick={() => openCount > 0 && setShowTasks(showTasks === 'open' ? false : 'open')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 10px', borderRadius: 8, border: 'none', cursor: openCount > 0 ? 'pointer' : 'default',
            background: '#1e1e1e', textAlign: 'left',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: 'rgba(205,162,116,0.08)',
          }}
        >
          <ClipboardList size={13} style={{ color: '#CDA274', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#CDA274', lineHeight: 1 }}>{openCount}</div>
            <div style={{ fontSize: 9, color: '#6a6058', marginTop: 1 }}>Open Tasks</div>
          </div>
          {openCount > 0 && (showTasks === 'open' ? <ChevronUp size={12} style={{ color: '#6a6058' }} /> : <ChevronDown size={12} style={{ color: '#6a6058' }} />)}
        </button>
      </div>

      {/* Expanded task list */}
      {showTasks && (
        <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 6, maxHeight: 200, overflowY: 'auto' }}>
          {showTasks === 'overdue' && data.overdueTasks.map(t => {
            const days = Math.floor((new Date(data.todayDate + 'T12:00:00').getTime() - new Date(t.date + 'T12:00:00').getTime()) / 86400000);
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid rgba(205,162,116,0.04)', fontSize: 11 }}>
                <button onClick={() => toggleComplete(t.id, false)} disabled={completing.has(t.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, flexShrink: 0 }}>
                  {completing.has(t.id)
                    ? <Loader2 size={13} className="animate-spin" style={{ color: '#6a6058' }} />
                    : <Circle size={13} style={{ color: '#ef4444' }} />
                  }
                </button>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: jobColor(t.jobNumber), flexShrink: 0 }} />
                <span style={{ color: '#e8e0d8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <span style={{ color: '#5a5550', fontSize: 10, flexShrink: 0 }}>#{t.jobNumber}</span>
                <span style={{ color: '#ef4444', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{days}d</span>
              </div>
            );
          })}
          {showTasks === 'open' && data.openTasks.map(t => {
            const isOverdue = t.endDate && t.endDate < data.todayDate;
            const lbl = !t.endDate ? '' : t.endDate === data.todayDate ? 'Today'
              : isOverdue ? `${Math.floor((new Date(data.todayDate + 'T12:00:00').getTime() - new Date(t.endDate + 'T12:00:00').getTime()) / 86400000)}d overdue`
              : (() => { const d = Math.floor((new Date(t.endDate + 'T12:00:00').getTime() - new Date(data.todayDate + 'T12:00:00').getTime()) / 86400000); return d === 1 ? 'Tomorrow' : `${d}d`; })();
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid rgba(205,162,116,0.04)', fontSize: 11 }}>
                <button onClick={() => toggleComplete(t.id, false)} disabled={completing.has(t.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, flexShrink: 0 }}>
                  {completing.has(t.id)
                    ? <Loader2 size={13} className="animate-spin" style={{ color: '#6a6058' }} />
                    : <Circle size={13} style={{ color: '#CDA274' }} />
                  }
                </button>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: jobColor(t.jobNumber), flexShrink: 0 }} />
                <span style={{ color: '#e8e0d8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <span style={{ color: '#5a5550', fontSize: 10, flexShrink: 0 }}>#{t.jobNumber}</span>
                <span style={{ color: isOverdue ? '#ef4444' : t.endDate === data.todayDate ? '#eab308' : '#5a5550', fontSize: 10, fontWeight: 500, flexShrink: 0 }}>{lbl}</span>
              </div>
            );
          })}
          {((showTasks === 'overdue' && overdueCount === 0) || (showTasks === 'open' && openCount === 0)) && (
            <p style={{ color: '#5a5550', fontSize: 11, textAlign: 'center', padding: 8 }}>None</p>
          )}
        </div>
      )}

      {/* WEEK CALENDARS */}
      {weeks.map((week, wi) => (
        <div key={wi} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <Calendar size={11} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#5a5550' }}>{week.label.toUpperCase()}</span>
            <span style={{ fontSize: 10, color: '#3f3f3f' }}>{week.days[0].month} {week.days[0].dayNum} – {week.days[6].month} {week.days[6].dayNum}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, borderRadius: 8, overflow: 'hidden' }}>
            {week.days.map(day => {
              const isToday = day.date === data.todayDate;
              const tasks = tasksByDate[day.date] || [];
              const incomplete = tasks.filter(t => !t.isComplete);
              const complete = tasks.filter(t => t.isComplete);
              const isWeek1 = wi === 0;

              return (
                <div key={day.date} style={{
                  background: isToday ? 'rgba(205,162,116,0.1)' : '#1a1a1a',
                  minHeight: 80, display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '3px 5px 2px' }}>
                    <span style={{ fontSize: 9, fontWeight: 500, color: day.isWeekend ? '#3a3a3a' : '#6a6058' }}>{day.dayName}</span>
                    <span style={{
                      fontSize: 13, fontWeight: 700,
                      color: isToday ? '#CDA274' : day.isWeekend ? '#3a3a3a' : '#7a7068',
                      ...(isToday ? { background: 'rgba(205,162,116,0.25)', borderRadius: 4, padding: '0 4px' } : {}),
                    }}>{day.dayNum}</span>
                  </div>
                  <div style={{ flex: 1, padding: '1px 2px 3px', display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                    {incomplete.map(task => {
                      const c = jobColor(task.jobNumber);
                      const highlighted = task.isAssignedToMe && isWeek1;
                      const isBeingCompleted = completing.has(task.id);
                      return (
                        <div key={task.id} title={`${task.name} — #${task.jobNumber} ${task.jobName}${task.isAssignedToMe ? ' (assigned to you)' : ''}`}
                          style={{
                            padding: '2px 3px', borderRadius: 3,
                            borderLeft: `3px solid ${c}`,
                            background: highlighted ? `${c}35` : `${c}18`,
                            fontSize: 9, lineHeight: '12px', color: '#e8e0d8',
                            display: 'flex', alignItems: 'center', gap: 2,
                            opacity: isBeingCompleted ? 0.4 : 1,
                            ...(highlighted ? { boxShadow: `inset 0 0 0 1px ${c}50` } : {}),
                          }}>
                          {task.isAssignedToMe && (
                            <button onClick={() => toggleComplete(task.id, false)} disabled={isBeingCompleted}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, flexShrink: 0 }}>
                              {isBeingCompleted
                                ? <Loader2 size={9} className="animate-spin" style={{ color: '#6a6058' }} />
                                : <Circle size={9} style={{ color: c }} />
                              }
                            </button>
                          )}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{task.name}</span>
                        </div>
                      );
                    })}
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
    </div>
  );
}

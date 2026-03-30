// @ts-nocheck
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  AlertTriangle, Loader2, RefreshCw, Calendar,
  Check, MessageSquare, ChevronDown, ChevronUp,
  Zap, ClipboardList, Circle, CheckCircle2,
  X, Briefcase, CalendarDays, ExternalLink
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

function jtScheduleUrl(jobId: string): string {
  return `https://app.jobtread.com/jobs/${jobId}/schedule`;
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
interface UpcomingTask {
  id: string; name: string; endDate: string | null; progress: number | null;
  jobName: string; jobNumber: string; jobId: string;
}
interface PmJob {
  id: string; name: string; number: string;
}
interface Data {
  userName: string; briefing: string;
  week1Start: string; todayDate: string;
  jobOverdueTasks: OdTask[]; myOverdueTasks: OdTask[];
  myUpcomingTasks: UpcomingTask[];
  calendarTasks: CalTask[];
  activeJobCount: number;
  pmJobs: PmJob[];
}

export default function FieldDashboardPage() {
  const auth = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showTasks, setShowTasks] = useState<string | false>(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [selectedTask, setSelectedTask] = useState<CalTask | null>(null);
  const [editingDate, setEditingDate] = useState('');
  const [savingDate, setSavingDate] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

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
      if (data) {
        setData({
          ...data,
          calendarTasks: data.calendarTasks.map(t =>
            t.id === taskId ? { ...t, isComplete: !currentlyComplete, progress: !currentlyComplete ? 1 : 0 } : t
          ),
          myUpcomingTasks: !currentlyComplete
            ? data.myUpcomingTasks.filter(t => t.id !== taskId)
            : data.myUpcomingTasks,
          myOverdueTasks: !currentlyComplete
            ? data.myOverdueTasks.filter(t => t.id !== taskId)
            : data.myOverdueTasks,
          jobOverdueTasks: !currentlyComplete
            ? data.jobOverdueTasks.filter(t => t.id !== taskId)
            : data.jobOverdueTasks,
        });
      }
      // Close popup if completing from it
      if (selectedTask?.id === taskId) setSelectedTask(null);
    } catch { /* silent */ }
    finally { setCompleting(prev => { const s = new Set(prev); s.delete(taskId); return s; }); }
  };

  const saveDate = async () => {
    if (!selectedTask || !editingDate) return;
    setSavingDate(true);
    try {
      const res = await fetch('/api/field-dashboard', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ taskId: selectedTask.id, endDate: editingDate }),
      });
      if (!res.ok) throw new Error('Failed');
      // Update local state
      if (data) {
        setData({
          ...data,
          calendarTasks: data.calendarTasks.map(t =>
            t.id === selectedTask.id ? { ...t, date: editingDate, endDate: editingDate } : t
          ),
        });
      }
      setSelectedTask(null);
    } catch { /* silent */ }
    finally { setSavingDate(false); }
  };

  // Close popup on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setSelectedTask(null);
      }
    }
    if (selectedTask) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [selectedTask]);

  useEffect(() => { fetchData(); }, []);

  // Week grids
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

  const week1End = useMemo(() => {
    if (!data?.week1Start) return '';
    const d = new Date(data.week1Start + 'T12:00:00');
    d.setDate(d.getDate() + 6);
    return d.toISOString().split('T')[0];
  }, [data?.week1Start]);

  const firstName = data?.userName?.split(' ')[0] || auth.user?.name?.split(' ')[0] || '';
  const jobOverdueCount = data?.jobOverdueTasks?.length || 0;
  const myOverdueCount = data?.myOverdueTasks?.length || 0;
  const myUpcomingCount = data?.myUpcomingTasks?.length || 0;

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
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 8px', position: 'relative' }}>
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

      {/* THREE TASK CARDS: Job Overdue | My Overdue | Open Tasks */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {/* Job Overdue */}
        <button
          onClick={() => jobOverdueCount > 0 && setShowTasks(showTasks === 'jobOverdue' ? false : 'jobOverdue')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 8px', borderRadius: 8, border: 'none', cursor: jobOverdueCount > 0 ? 'pointer' : 'default',
            background: jobOverdueCount > 0 ? 'rgba(249,115,22,0.07)' : '#1e1e1e',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: jobOverdueCount > 0 ? 'rgba(249,115,22,0.18)' : 'rgba(205,162,116,0.06)',
            textAlign: 'left',
          }}
        >
          <Briefcase size={12} style={{ color: jobOverdueCount > 0 ? '#f97316' : '#3a3a3a', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: jobOverdueCount > 0 ? '#f97316' : '#3a3a3a', lineHeight: 1 }}>{jobOverdueCount}</div>
            <div style={{ fontSize: 8, color: '#6a6058', marginTop: 1, whiteSpace: 'nowrap' }}>Job Overdue</div>
          </div>
          {jobOverdueCount > 0 && (showTasks === 'jobOverdue' ? <ChevronUp size={11} style={{ color: '#6a6058' }} /> : <ChevronDown size={11} style={{ color: '#6a6058' }} />)}
        </button>

        {/* My Overdue */}
        <button
          onClick={() => myOverdueCount > 0 && setShowTasks(showTasks === 'myOverdue' ? false : 'myOverdue')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 8px', borderRadius: 8, border: 'none', cursor: myOverdueCount > 0 ? 'pointer' : 'default',
            background: myOverdueCount > 0 ? 'rgba(239,68,68,0.07)' : '#1e1e1e',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: myOverdueCount > 0 ? 'rgba(239,68,68,0.18)' : 'rgba(205,162,116,0.06)',
            textAlign: 'left',
          }}
        >
          <AlertTriangle size={12} style={{ color: myOverdueCount > 0 ? '#ef4444' : '#3a3a3a', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: myOverdueCount > 0 ? '#ef4444' : '#3a3a3a', lineHeight: 1 }}>{myOverdueCount}</div>
            <div style={{ fontSize: 8, color: '#6a6058', marginTop: 1, whiteSpace: 'nowrap' }}>My Overdue</div>
          </div>
          {myOverdueCount > 0 && (showTasks === 'myOverdue' ? <ChevronUp size={11} style={{ color: '#6a6058' }} /> : <ChevronDown size={11} style={{ color: '#6a6058' }} />)}
        </button>

        {/* My Upcoming */}
        <button
          onClick={() => myUpcomingCount > 0 && setShowTasks(showTasks === 'upcoming' ? false : 'upcoming')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 8px', borderRadius: 8, border: 'none', cursor: myUpcomingCount > 0 ? 'pointer' : 'default',
            background: '#1e1e1e', textAlign: 'left',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: 'rgba(205,162,116,0.08)',
          }}
        >
          <ClipboardList size={12} style={{ color: '#CDA274', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#CDA274', lineHeight: 1 }}>{myUpcomingCount}</div>
            <div style={{ fontSize: 8, color: '#6a6058', marginTop: 1, whiteSpace: 'nowrap' }}>My Upcoming</div>
          </div>
          {myUpcomingCount > 0 && (showTasks === 'upcoming' ? <ChevronUp size={11} style={{ color: '#6a6058' }} /> : <ChevronDown size={11} style={{ color: '#6a6058' }} />)}
        </button>
      </div>

      {/* Expanded task list */}
      {showTasks && (
        <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 6, maxHeight: 200, overflowY: 'auto' }}>
          {showTasks === 'jobOverdue' && data.jobOverdueTasks.map(t => {
            const days = Math.floor((new Date(data.todayDate + 'T12:00:00').getTime() - new Date(t.date + 'T12:00:00').getTime()) / 86400000);
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid rgba(205,162,116,0.04)', fontSize: 11 }}>
                <button onClick={() => toggleComplete(t.id, false)} disabled={completing.has(t.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, flexShrink: 0 }}>
                  {completing.has(t.id)
                    ? <Loader2 size={13} className="animate-spin" style={{ color: '#6a6058' }} />
                    : <Circle size={13} style={{ color: '#f97316' }} />
                  }
                </button>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: jobColor(t.jobNumber), flexShrink: 0 }} />
                <a href={jtScheduleUrl(t.jobId)} target="_blank" rel="noopener noreferrer" style={{ flex: 1, overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column', textDecoration: 'none' }}>
                  <div style={{ color: '#e8e0d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '14px' }}>{t.name}</div>
                  <div style={{ color: '#5a5550', fontSize: 9, lineHeight: '12px' }}>{t.jobName}{t.isAssignedToMe ? ' · assigned to you' : ''}</div>
                </a>
                <span style={{ color: '#f97316', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{days}d</span>
              </div>
            );
          })}
          {showTasks === 'myOverdue' && data.myOverdueTasks.map(t => {
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
                <a href={jtScheduleUrl(t.jobId)} target="_blank" rel="noopener noreferrer" style={{ flex: 1, overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column', textDecoration: 'none' }}>
                  <div style={{ color: '#e8e0d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '14px' }}>{t.name}</div>
                  <div style={{ color: '#5a5550', fontSize: 9, lineHeight: '12px' }}>{t.jobName}</div>
                </a>
                <span style={{ color: '#ef4444', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{days}d</span>
              </div>
            );
          })}
          {showTasks === 'upcoming' && data.myUpcomingTasks.map(t => {
            const lbl = !t.endDate ? '' : t.endDate === data.todayDate ? 'Today'
              : (() => { const d = Math.floor((new Date(t.endDate + 'T12:00:00').getTime() - new Date(data.todayDate + 'T12:00:00').getTime()) / 86400000); return d === 1 ? 'Tomorrow' : d <= 0 ? 'Today' : `${d}d`; })();
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
                <a href={jtScheduleUrl(t.jobId)} target="_blank" rel="noopener noreferrer" style={{ flex: 1, overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column', textDecoration: 'none' }}>
                  <div style={{ color: '#e8e0d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '14px' }}>{t.name}</div>
                  <div style={{ color: '#5a5550', fontSize: 9, lineHeight: '12px' }}>{t.jobName}</div>
                </a>
                <span style={{ color: t.endDate === data.todayDate ? '#eab308' : '#5a5550', fontSize: 10, fontWeight: 500, flexShrink: 0 }}>{lbl}</span>
              </div>
            );
          })}
          {((showTasks === 'jobOverdue' && jobOverdueCount === 0) || (showTasks === 'myOverdue' && myOverdueCount === 0) || (showTasks === 'upcoming' && myUpcomingCount === 0)) && (
            <p style={{ color: '#5a5550', fontSize: 11, textAlign: 'center', padding: 8 }}>None</p>
          )}
        </div>
      )}

      {/* PM JOBS - condensed clickable list */}
      {data.pmJobs && data.pmJobs.length > 0 && (
        <div style={{ background: 'rgba(205,162,116,0.04)', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <Briefcase size={10} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: '#CDA274', letterSpacing: '0.06em' }}>MY JOBS</span>
            <span style={{ fontSize: 9, color: '#4a4a4a' }}>({data.pmJobs.length})</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {data.pmJobs.map(job => (
              <a
                key={job.id}
                href={jtScheduleUrl(job.id)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 7px', borderRadius: 5,
                  background: 'rgba(205,162,116,0.06)',
                  border: '1px solid rgba(205,162,116,0.1)',
                  textDecoration: 'none', fontSize: 10, color: '#c0b8a8',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(205,162,116,0.15)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(205,162,116,0.06)')}
              >
                <span style={{ width: 5, height: 5, borderRadius: 3, background: jobColor(job.number), flexShrink: 0 }} />
                <span style={{ whiteSpace: 'nowrap' }}>{job.name.replace(/^#\d+\s*/, '')}</span>
                <ExternalLink size={8} style={{ color: '#5a5550', flexShrink: 0 }} />
              </a>
            ))}
          </div>
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
                      const isSelected = selectedTask?.id === task.id;
                      return (
                        <div key={task.id} style={{ position: 'relative' }}>
                          <div
                            onClick={() => {
                              setSelectedTask(isSelected ? null : task);
                              setEditingDate(task.endDate || task.date);
                            }}
                            style={{
                              padding: '2px 3px', borderRadius: 3, cursor: 'pointer',
                              borderLeft: `3px solid ${c}`,
                              background: isSelected ? `${c}50` : highlighted ? `${c}35` : `${c}18`,
                              fontSize: 9, lineHeight: '12px', color: '#e8e0d8',
                              display: 'flex', alignItems: 'center', gap: 2,
                              opacity: isBeingCompleted ? 0.4 : 1,
                              ...(highlighted ? { boxShadow: `inset 0 0 0 1px ${c}50` } : {}),
                            }}>
                            {task.isAssignedToMe && (
                              <button onClick={(e) => { e.stopPropagation(); toggleComplete(task.id, false); }} disabled={isBeingCompleted}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, flexShrink: 0 }}>
                                {isBeingCompleted
                                  ? <Loader2 size={9} className="animate-spin" style={{ color: '#6a6058' }} />
                                  : <Circle size={9} style={{ color: c }} />
                                }
                              </button>
                            )}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{task.name}</span>
                          </div>
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

      {/* TASK DETAIL POPUP */}
      {selectedTask && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => setSelectedTask(null)}>
          <div ref={popupRef} onClick={e => e.stopPropagation()} style={{
            background: '#252525', borderRadius: 12, padding: 16, minWidth: 280, maxWidth: 360,
            border: '1px solid rgba(205,162,116,0.15)', boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e8e0d8', lineHeight: '18px' }}>{selectedTask.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: jobColor(selectedTask.jobNumber), flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: '#8a8078' }}>#{selectedTask.jobNumber} {selectedTask.jobName}</span>
                </div>
              </div>
              <button onClick={() => setSelectedTask(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                <X size={14} style={{ color: '#6a6058' }} />
              </button>
            </div>

            {/* Date edit */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 4 }}>DUE DATE</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="date"
                  value={editingDate}
                  onChange={e => setEditingDate(e.target.value)}
                  style={{
                    flex: 1, background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 6,
                    color: '#e8e0d8', fontSize: 12, padding: '5px 8px',
                    colorScheme: 'dark',
                  }}
                />
                {editingDate !== (selectedTask.endDate || selectedTask.date) && (
                  <button onClick={saveDate} disabled={savingDate}
                    style={{
                      background: '#CDA274', color: '#1a1a1a', fontSize: 11, fontWeight: 600,
                      padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      opacity: savingDate ? 0.5 : 1,
                    }}>
                    {savingDate ? 'Saving...' : 'Save'}
                  </button>
                )}
              </div>
            </div>

            {/* Assignment info */}
            {selectedTask.isAssignedToMe && (
              <div style={{ fontSize: 10, color: '#CDA274', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={10} /> Assigned to you
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => toggleComplete(selectedTask.id, selectedTask.isComplete)}
                disabled={completing.has(selectedTask.id)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: selectedTask.isComplete ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                  color: selectedTask.isComplete ? '#ef4444' : '#22c55e',
                  opacity: completing.has(selectedTask.id) ? 0.5 : 1,
                }}>
                {completing.has(selectedTask.id)
                  ? <Loader2 size={13} className="animate-spin" />
                  : selectedTask.isComplete
                    ? <><X size={13} /> Reopen</>
                    : <><Check size={13} /> Mark Complete</>
                }
              </button>
              <a
                href={jtScheduleUrl(selectedTask.jobId)}
                target="_blank" rel="noopener noreferrer"
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '7px 0', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none',
                  background: 'rgba(205,162,116,0.1)', color: '#CDA274',
                }}>
                <ExternalLink size={13} /> View in JobTread
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

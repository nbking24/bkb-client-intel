// @ts-nocheck
'use client';

import { useState, useEffect } from 'react';
import {
  AlertTriangle, Clock, CheckCircle2, Loader2,
  ChevronRight, ClipboardList, RefreshCw, Calendar
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(d: string | null) {
  if (!d) return 'No date';
  const date = new Date(d + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

interface TaskItem {
  id: string;
  name: string;
  progress: number | null;
  startDate: string | null;
  endDate: string | null;
  jobName: string;
  jobNumber: string;
  jobId: string;
}

interface DashboardData {
  userName: string;
  briefing: string;
  stats: { total: number; overdue: number; today: number; upcoming: number };
  overdueTasks: TaskItem[];
  todayTasks: TaskItem[];
  upcomingTasks: TaskItem[];
  otherTasks: TaskItem[];
  activeJobCount: number;
}

export default function FieldDashboardPage() {
  const auth = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [updatingTask, setUpdatingTask] = useState<string | null>(null);

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

  const markTaskProgress = async (taskId: string, progress: number) => {
    setUpdatingTask(taskId);
    try {
      await fetch('/api/field-task-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ taskId, progress }),
      });
      // Refresh dashboard after update
      await fetchData(true);
    } catch {
      // Silent fail — refresh will show current state
    } finally {
      setUpdatingTask(null);
    }
  };

  const firstName = data?.userName?.split(' ')[0] || auth.user?.name?.split(' ')[0] || 'Team';

  // ── Task card component ──
  const TaskCard = ({ task, urgency }: { task: TaskItem; urgency: 'overdue' | 'today' | 'upcoming' | 'normal' }) => {
    const progressPct = task.progress !== null ? Math.round((task.progress || 0) * 100) : 0;
    const isComplete = task.progress === 1;
    const isUpdating = updatingTask === task.id;

    const urgencyColors = {
      overdue: { border: 'rgba(239,68,68,0.3)', badge: '#ef4444', badgeText: '#fff' },
      today: { border: 'rgba(234,179,8,0.3)', badge: '#eab308', badgeText: '#1a1a1a' },
      upcoming: { border: 'rgba(205,162,116,0.15)', badge: '#CDA274', badgeText: '#1a1a1a' },
      normal: { border: 'rgba(205,162,116,0.08)', badge: '#3f3f3f', badgeText: '#8a8078' },
    };
    const colors = urgencyColors[urgency];

    return (
      <div
        className="px-4 py-3 rounded-lg mb-2"
        style={{ background: '#242424', border: `1px solid ${colors.border}` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(205,162,116,0.1)', color: '#CDA274' }}
              >
                #{task.jobNumber}
              </span>
              <span className="text-xs truncate" style={{ color: '#8a8078' }}>{task.jobName}</span>
            </div>
            <p className="text-sm font-medium" style={{ color: '#e8e0d8' }}>{task.name}</p>
            <div className="flex items-center gap-3 mt-1.5">
              {task.endDate && (
                <span className="text-xs flex items-center gap-1" style={{ color: urgency === 'overdue' ? '#ef4444' : '#8a8078' }}>
                  <Calendar size={11} /> {formatDate(task.endDate)}
                </span>
              )}
              <span className="text-xs" style={{ color: '#8a8078' }}>{progressPct}%</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            {!isComplete && (
              <>
                {progressPct === 0 && (
                  <button
                    onClick={() => markTaskProgress(task.id, 0.5)}
                    disabled={isUpdating}
                    className="text-xs px-2.5 py-1.5 rounded-lg font-medium disabled:opacity-40"
                    style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308', border: '1px solid rgba(234,179,8,0.3)' }}
                  >
                    {isUpdating ? '...' : 'Start'}
                  </button>
                )}
                <button
                  onClick={() => markTaskProgress(task.id, 1)}
                  disabled={isUpdating}
                  className="text-xs px-2.5 py-1.5 rounded-lg font-medium disabled:opacity-40"
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}
                >
                  {isUpdating ? '...' : 'Done'}
                </button>
              </>
            )}
            {isComplete && (
              <span className="text-xs px-2.5 py-1.5 rounded-lg font-medium" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                Complete
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Task section component ──
  const TaskSection = ({ title, tasks, urgency, icon: Icon, iconColor }: {
    title: string; tasks: TaskItem[]; urgency: 'overdue' | 'today' | 'upcoming' | 'normal';
    icon: any; iconColor: string;
  }) => {
    if (tasks.length === 0) return null;
    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Icon size={16} style={{ color: iconColor }} />
          <h3 className="text-sm font-semibold" style={{ color: '#e8e0d8' }}>
            {title} <span className="font-normal" style={{ color: '#8a8078' }}>({tasks.length})</span>
          </h3>
        </div>
        {tasks.map(t => <TaskCard key={t.id} task={t} urgency={urgency} />)}
      </div>
    );
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin" style={{ color: '#CDA274' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-sm mb-3" style={{ color: '#c45c4c' }}>{error}</p>
        <button onClick={() => fetchData()} className="text-sm px-4 py-2 rounded-lg" style={{ background: '#242424', color: '#CDA274' }}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-semibold" style={{ color: '#e8e0d8', fontFamily: 'Georgia, serif' }}>
            {getGreeting()}, {firstName}
          </h1>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="p-2 rounded-lg hover:bg-white/5"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} style={{ color: '#8a8078' }} />
          </button>
        </div>
        {/* Briefing card */}
        <div
          className="px-4 py-3 rounded-lg"
          style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.12)' }}
        >
          <p className="text-sm" style={{ color: '#e8e0d8' }}>{data.briefing}</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {[
          { label: 'Total', value: data.stats.total, color: '#CDA274' },
          { label: 'Overdue', value: data.stats.overdue, color: data.stats.overdue > 0 ? '#ef4444' : '#8a8078' },
          { label: 'Today', value: data.stats.today, color: data.stats.today > 0 ? '#eab308' : '#8a8078' },
          { label: 'This Week', value: data.stats.upcoming, color: '#8a8078' },
        ].map(s => (
          <div key={s.label} className="text-center px-2 py-3 rounded-lg" style={{ background: '#242424' }}>
            <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: '#8a8078' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Task sections */}
      <TaskSection
        title="Overdue"
        tasks={data.overdueTasks}
        urgency="overdue"
        icon={AlertTriangle}
        iconColor="#ef4444"
      />
      <TaskSection
        title="Due Today"
        tasks={data.todayTasks}
        urgency="today"
        icon={Clock}
        iconColor="#eab308"
      />
      <TaskSection
        title="This Week"
        tasks={data.upcomingTasks}
        urgency="upcoming"
        icon={Calendar}
        iconColor="#CDA274"
      />
      <TaskSection
        title="Other Open Tasks"
        tasks={data.otherTasks}
        urgency="normal"
        icon={ClipboardList}
        iconColor="#8a8078"
      />

      {data.stats.total === 0 && (
        <div className="text-center py-12">
          <CheckCircle2 size={32} className="mx-auto mb-3" style={{ color: '#22c55e', opacity: 0.5 }} />
          <p className="text-sm" style={{ color: '#8a8078' }}>All caught up! No open tasks assigned to you.</p>
        </div>
      )}
    </div>
  );
}

// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, Clock, CheckCircle2, Loader2,
  ChevronRight, ChevronDown, ClipboardList, RefreshCw,
  Calendar, Search, Building2, X
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

function progressBar(progress: number | null, height = 4) {
  const pct = progress !== null ? Math.round((progress || 0) * 100) : 0;
  const color = pct >= 100 ? '#22c55e' : pct > 0 ? '#CDA274' : '#3f3f3f';
  return (
    <div style={{ background: '#1a1a1a', borderRadius: 2, height, width: '100%' }}>
      <div style={{ background: color, borderRadius: 2, height, width: pct + '%', transition: 'width 0.3s' }} />
    </div>
  );
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

interface JobItem {
  id: string;
  name: string;
  number: string;
  clientName: string;
  customStatus: string | null;
}

interface SchedulePhase {
  id: string;
  name: string;
  progress: number | null;
  startDate: string | null;
  endDate: string | null;
  tasks: { id: string; name: string; progress: number | null; startDate: string | null; endDate: string | null }[];
}

interface JobScheduleData {
  jobId: string;
  jobName: string;
  jobNumber: string;
  totalProgress: number;
  phases: SchedulePhase[];
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
  activeJobs: JobItem[];
}

export default function FieldDashboardPage() {
  const auth = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [updatingTask, setUpdatingTask] = useState<string | null>(null);
  // My Jobs state
  const [jobSearch, setJobSearch] = useState('');
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [scheduleCache, setScheduleCache] = useState<Record<string, JobScheduleData>>({});
  const [loadingSchedule, setLoadingSchedule] = useState<string | null>(null);

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
      await fetchData(true);
    } catch {
      // Silent fail
    } finally {
      setUpdatingTask(null);
    }
  };

  const toggleJobExpand = async (jobId: string) => {
    if (expandedJob === jobId) {
      setExpandedJob(null);
      return;
    }
    setExpandedJob(jobId);
    if (!scheduleCache[jobId]) {
      setLoadingSchedule(jobId);
      try {
        const res = await fetch(`/api/field-job-schedule?jobId=${jobId}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) {
          const sched = await res.json();
          setScheduleCache(prev => ({ ...prev, [jobId]: sched }));
        }
      } catch { /* silent */ }
      finally { setLoadingSchedule(null); }
    }
  };

  const filteredJobs = useMemo(() => {
    if (!data?.activeJobs) return [];
    if (!jobSearch.trim()) return data.activeJobs;
    const q = jobSearch.toLowerCase();
    return data.activeJobs.filter(j =>
      j.name.toLowerCase().includes(q) ||
      j.number?.toLowerCase().includes(q) ||
      j.clientName?.toLowerCase().includes(q)
    );
  }, [data?.activeJobs, jobSearch]);

  const firstName = data?.userName?.split(' ')[0] || auth.user?.name?.split(' ')[0] || 'Team';

  // -- Task card component --
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
            <div className="flex items-center gap-2 mt-1">
              <Calendar size={11} style={{ color: '#8a8078' }} />
              <span className="text-xs" style={{ color: urgency === 'overdue' ? '#ef4444' : '#8a8078' }}>
                {formatDate(task.endDate)}
              </span>
              <span className="text-xs" style={{ color: '#5a5550' }}>{progressPct}%</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {!isComplete && progressPct < 50 && (
              <button
                onClick={() => markTaskProgress(task.id, 0.5)}
                disabled={isUpdating}
                className="text-xs px-3 py-1 rounded font-medium"
                style={{ background: '#CDA274', color: '#1a1a1a' }}
              >
                {isUpdating ? '...' : 'Start'}
              </button>
            )}
            {!isComplete && (
              <button
                onClick={() => markTaskProgress(task.id, 1)}
                disabled={isUpdating}
                className="text-xs px-3 py-1 rounded font-medium"
                style={{ background: '#22c55e', color: '#1a1a1a' }}
              >
                {isUpdating ? '...' : 'Done'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // -- Task section component --
  const TaskSection = ({
    title, tasks, urgency, icon: Icon, iconColor,
  }: {
    title: string; tasks: TaskItem[]; urgency: 'overdue' | 'today' | 'upcoming' | 'normal';
    icon: any; iconColor: string;
  }) => {
    if (!tasks || tasks.length === 0) return null;
    return (
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon size={14} style={{ color: iconColor }} />
          <h3 className="text-sm font-semibold" style={{ color: iconColor }}>
            {title} ({tasks.length})
          </h3>
        </div>
        {tasks.map(t => <TaskCard key={t.id} task={t} urgency={urgency} />)}
      </div>
    );
  };

  // -- Job card with expandable schedule --
  const JobCard = ({ job }: { job: JobItem }) => {
    const isExpanded = expandedJob === job.id;
    const isLoading = loadingSchedule === job.id;
    const schedule = scheduleCache[job.id];

    const statusColors: Record<string, string> = {
      'Pre-Construction': '#CDA274',
      'In Progress': '#22c55e',
      'On Hold': '#eab308',
      'Punch List': '#f97316',
    };
    const statusColor = statusColors[job.customStatus || ''] || '#8a8078';

    return (
      <div className="rounded-lg mb-2 overflow-hidden" style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}>
        <button
          onClick={() => toggleJobExpand(job.id)}
          className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left"
          style={{ background: 'transparent' }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'rgba(205,162,116,0.1)', color: '#CDA274' }}>
                #{job.number}
              </span>
              <span className="text-sm font-medium truncate" style={{ color: '#e8e0d8' }}>{job.name}</span>
            </div>
            <div className="flex items-center gap-3">
              {job.clientName && (
                <span className="text-xs" style={{ color: '#8a8078' }}>{job.clientName}</span>
              )}
              {job.customStatus && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: statusColor + '18', color: statusColor }}>
                  {job.customStatus}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isLoading ? (
              <Loader2 size={14} className="animate-spin" style={{ color: '#CDA274' }} />
            ) : isExpanded ? (
              <ChevronDown size={16} style={{ color: '#CDA274' }} />
            ) : (
              <ChevronRight size={16} style={{ color: '#8a8078' }} />
            )}
          </div>
        </button>

        {isExpanded && (
          <div className="px-4 pb-3 border-t" style={{ borderColor: 'rgba(205,162,116,0.08)' }}>
            {isLoading && !schedule && (
              <div className="flex items-center gap-2 py-4 justify-center">
                <Loader2 size={14} className="animate-spin" style={{ color: '#CDA274' }} />
                <span className="text-xs" style={{ color: '#8a8078' }}>Loading schedule...</span>
              </div>
            )}
            {schedule && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium" style={{ color: '#8a8078' }}>
                    Overall: {Math.round((schedule.totalProgress || 0) * 100)}%
                  </span>
                  <div style={{ width: 120 }}>{progressBar(schedule.totalProgress, 3)}</div>
                </div>
                {schedule.phases.length === 0 && (
                  <p className="text-xs py-2" style={{ color: '#5a5550' }}>No schedule phases found.</p>
                )}
                {schedule.phases.map((phase: SchedulePhase) => (
                  <PhaseRow key={phase.id} phase={phase} />
                ))}
              </div>
            )}
            {!isLoading && !schedule && (
              <p className="text-xs py-3" style={{ color: '#5a5550' }}>Could not load schedule.</p>
            )}
          </div>
        )}
      </div>
    );
  };

  // -- Phase row with inline tasks --
  const PhaseRow = ({ phase }: { phase: SchedulePhase }) => {
    const [open, setOpen] = useState(false);
    const phasePct = phase.progress !== null ? Math.round((phase.progress || 0) * 100) : 0;
    const hasTasks = phase.tasks && phase.tasks.length > 0;

    return (
      <div className="mb-1">
        <button
          onClick={() => hasTasks && setOpen(!open)}
          className="w-full flex items-center gap-2 py-1.5 px-2 rounded text-left"
          style={{ background: open ? 'rgba(205,162,116,0.04)' : 'transparent' }}
        >
          {hasTasks ? (
            open ? <ChevronDown size={12} style={{ color: '#CDA274' }} /> : <ChevronRight size={12} style={{ color: '#5a5550' }} />
          ) : (
            <span style={{ width: 12 }} />
          )}
          <span className="text-xs font-medium flex-1 truncate" style={{ color: '#c4b8a8' }}>
            {phase.name}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: '#5a5550' }}>
            {phasePct}%
          </span>
          <div style={{ width: 60 }}>{progressBar(phase.progress, 3)}</div>
        </button>
        {open && hasTasks && (
          <div className="ml-6 mt-0.5 mb-1">
            {phase.tasks.map((t: any) => {
              const tPct = t.progress !== null ? Math.round((t.progress || 0) * 100) : 0;
              const done = t.progress === 1;
              return (
                <div key={t.id} className="flex items-center gap-2 py-1 px-2">
                  <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: done ? '#22c55e' : tPct > 0 ? '#CDA274' : '#3f3f3f' }} />
                  <span
                    className="text-xs flex-1 truncate"
                    style={{ color: done ? '#5a5550' : '#a09888', textDecoration: done ? 'line-through' : 'none' }}
                  >
                    {t.name}
                  </span>
                  {t.endDate && (
                    <span className="text-[10px] tabular-nums" style={{ color: '#5a5550' }}>{formatDate(t.endDate)}</span>
                  )}
                  <span className="text-[10px] tabular-nums" style={{ color: '#5a5550', width: 28, textAlign: 'right' }}>
                    {tPct}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

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
    <div className="max-w-3xl mx-auto pb-20">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#e8e0d8' }}>
            {getGreeting()}, {firstName}
          </h1>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="p-2 rounded-lg"
          style={{ background: 'rgba(205,162,116,0.08)' }}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} style={{ color: '#CDA274' }} />
        </button>
      </div>

      {/* Briefing */}
      <div className="px-4 py-3 rounded-lg mb-4" style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}>
        <p className="text-sm" style={{ color: '#c4b8a8' }}>{data.briefing}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {[
          { label: 'TOTAL', value: data.stats.total, color: '#e8e0d8' },
          { label: 'OVERDUE', value: data.stats.overdue, color: data.stats.overdue > 0 ? '#ef4444' : '#5a5550' },
          { label: 'TODAY', value: data.stats.today, color: data.stats.today > 0 ? '#eab308' : '#5a5550' },
          { label: 'THIS WEEK', value: data.stats.upcoming, color: '#5a5550' },
        ].map(s => (
          <div key={s.label} className="text-center py-3 rounded-lg" style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.05)' }}>
            <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] font-medium tracking-wide" style={{ color: '#5a5550' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Task Sections */}
      <TaskSection title="Overdue" tasks={data.overdueTasks} urgency="overdue" icon={AlertTriangle} iconColor="#ef4444" />
      <TaskSection title="Today" tasks={data.todayTasks} urgency="today" icon={Clock} iconColor="#eab308" />
      <TaskSection title="This Week" tasks={data.upcomingTasks} urgency="upcoming" icon={Calendar} iconColor="#CDA274" />
      <TaskSection title="Other Open Tasks" tasks={data.otherTasks} urgency="normal" icon={ClipboardList} iconColor="#8a8078" />

      {data.stats.total === 0 && (
        <div className="text-center py-8 mb-6">
          <CheckCircle2 size={32} className="mx-auto mb-3" style={{ color: '#22c55e', opacity: 0.5 }} />
          <p className="text-sm" style={{ color: '#8a8078' }}>All caught up! No open tasks assigned to you.</p>
        </div>
      )}

      {/* ---- MY JOBS SECTION ---- */}
      {data.activeJobs && data.activeJobs.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <Building2 size={16} style={{ color: '#CDA274' }} />
            <h2 className="text-sm font-semibold" style={{ color: '#CDA274' }}>
              Active Jobs ({data.activeJobs.length})
            </h2>
          </div>

          {/* Search box */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#5a5550' }} />
            <input
              type="text"
              value={jobSearch}
              onChange={e => setJobSearch(e.target.value)}
              placeholder="Search jobs by name, number, or client..."
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg outline-none"
              style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.1)', color: '#e8e0d8' }}
            />
            {jobSearch && (
              <button
                onClick={() => setJobSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X size={14} style={{ color: '#5a5550' }} />
              </button>
            )}
          </div>

          {/* Job list */}
          {filteredJobs.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: '#5a5550' }}>
              No jobs match "{jobSearch}"
            </p>
          ) : (
            filteredJobs.map(job => <JobCard key={job.id} job={job} />)
          )}
        </div>
      )}
    </div>
  );
}

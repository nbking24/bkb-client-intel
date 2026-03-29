// @ts-nocheck
'use client';

import { useState, useEffect } from 'react';

'use client';

import { useState, useEffect } from 'react';

'use client';

import { useState, useEffect } from 'react';
import {
  AlertTriangle, Clock, CheckCircle2, Loader2,
  ChevronRight, ChevronDown, ClipboardList, RefreshCw,
  Calendar, Building2, X, Check, Pencil
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
  
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [scheduleCache, setScheduleCache] = useState<Record<string, JobScheduleData>>({});
  const [loadingSchedule, setLoadingSchedule] = useState<string | null>(null);
  const [updatingScheduleTask, setUpdatingScheduleTask] = useState<string | null>(null);
  const [editingDateTask, setEditingDateTask] = useState<string | null>(null);
  const [editDateValue, setEditDateValue] = useState('');
  const [openPhases, setOpenPhases] = useState<Set<string>>(new Set());

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

  const updateScheduleTask = async (taskId: string, fields: { completed?: boolean; endDate?: string }) => {
    setUpdatingScheduleTask(taskId);
    try {
      await fetch('/api/field-schedule-task-update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ taskId, ...fields }),
      });
      // Update the local cache to reflect the change
      setScheduleCache(prev => {
        const updated = { ...prev };
        for (const jobId of Object.keys(updated)) {
          const schedule = updated[jobId];
          if (!schedule) continue;
          for (const phase of schedule.phases) {
            for (const task of phase.tasks) {
              if (task.id === taskId) {
                if (fields.completed !== undefined) {
                  task.progress = fields.completed ? 1 : 0;
                }
                if (fields.endDate !== undefined) {
                  task.endDate = fields.endDate;
                }
              }
            }
          }
        }
        return updated;
      });
      setEditingDateTask(null);
    } catch {
      // Silent fail
    } finally {
      setUpdatingScheduleTask(null);
    }
  };

  const filteredJobs = data?.activeJobs || [];

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
    const open = openPhases.has(phase.name);
    const hasTasks = phase.tasks && phase.tasks.length > 0;
    const phasePct = phase.progress !== null ? Math.round((phase.progress || 0) * 100) : null;

    return (
      <div className="border-t" style={{ borderColor: 'rgba(205,162,116,0.08)' }}>
        <button
          onClick={() => hasTasks && setOpenPhases(prev => { const n = new Set(prev); if (n.has(phase.name)) n.delete(phase.name); else n.add(phase.name); return n; })}
          className="w-full px-3 py-2 flex items-center justify-between text-left"
          style={{ background: 'transparent' }}
          disabled={!hasTasks}
        >
          <div className="flex items-center gap-2">
            {hasTasks ? (
              open ? <ChevronDown size={12} style={{ color: '#CDA274' }} /> : <ChevronRight size={12} style={{ color: '#8a8078' }} />
            ) : (
              <span style={{ width: 12 }} />
            )}
            <span className="text-sm" style={{ color: '#e8e0d8' }}>{phase.name}</span>
          </div>
          {phasePct !== null && (
            <span className="text-[10px] tabular-nums" style={{ color: '#5a5550' }}>
              {phasePct}%
            </span>
          )}
        </button>
        {open && hasTasks && (
          <div className="ml-6 mt-0.5 mb-1">
            {phase.tasks.map((t: any) => {
              const done = t.progress !== null && t.progress >= 1;
              const isUpdating = updatingScheduleTask === t.id;
              const isEditingDate = editingDateTask === t.id;

              return (
                <div key={t.id} className="flex items-center gap-2 py-1.5 px-2 group" style={{ borderBottom: '1px solid rgba(205,162,116,0.04)' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); updateScheduleTask(t.id, { completed: !done }); }}
                    disabled={isUpdating}
                    className="flex-shrink-0"
                    style={{ opacity: isUpdating ? 0.5 : 1 }}
                  >
                    {done ? (
                      <div style={{ width: 18, height: 18, borderRadius: 4, background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Check size={12} style={{ color: '#1a1a1a' }} />
                      </div>
                    ) : (
                      <div style={{ width: 18, height: 18, borderRadius: 4, border: '2px solid #5a5550', background: 'transparent' }} />
                    )}
                  </button>
                  <span
                    className="text-xs flex-1 truncate"
                    style={{ color: done ? '#5a5550' : '#e8e0d8', textDecoration: done ? 'line-through' : 'none' }}
                  >
                    {t.name}
                  </span>
                  <div className="flex items-center gap-1">
                    {isEditingDate ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="date"
                          value={editDateValue}
                          onChange={(e) => setEditDateValue(e.target.value)}
                          className="text-[10px] px-1 py-0.5 rounded"
                          style={{ background: '#2a2a2a', color: '#e8e0d8', border: '1px solid #CDA274', outline: 'none' }}
                        />
                        <button
                          onClick={() => { if (editDateValue) updateScheduleTask(t.id, { endDate: editDateValue }); }}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: '#22c55e', color: '#1a1a1a' }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingDateTask(null)}
                          className="text-[10px] px-1 py-0.5 rounded"
                          style={{ background: '#3f3f3f', color: '#8a8078' }}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ) : (
                      <>
                        {t.endDate && (
                          <span className="text-[10px] tabular-nums" style={{ color: '#5a5550' }}>
                            {formatDate(t.endDate)}
                          </span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingDateTask(t.id); setEditDateValue(t.endDate ? t.endDate.split('T')[0] : ''); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color: '#8a8078' }}
                          title="Edit due date"
                        >
                          <Pencil size={10} />
                        </button>
                      </>
                    )}
                  </div>
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



      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
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


            {filteredJobs.map(job => <JobCard key={job.id} job={job} />)}
      )}
    </div>
  );
}

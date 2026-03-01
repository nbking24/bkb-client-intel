'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, ArrowLeft, ChevronDown, ChevronRight, CheckCircle2, Circle,
  Clock, Plus, Trash2, X, User, Calendar,
} from 'lucide-react';

interface ChildTask {
  id: string;
  name: string;
  progress: number | null;
  startDate: string | null;
  endDate: string | null;
  isGroup: boolean;
  childTasks: { nodes: ChildTask[] };
}

interface Phase {
  id: string;
  name: string;
  isGroup: boolean;
  progress: number | null;
  startDate: string | null;
  endDate: string | null;
  childTasks: { nodes: ChildTask[] };
}

interface JobSchedule {
  id: string;
  name: string;
  number: string;
  clientName: string;
  locationName: string;
  phases: Phase[];
  totalProgress: number;
}

function formatDate(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function progressColor(p: number | null): string {
  if (p === null || p === 0) return '#3f3f3f';
  if (p >= 1) return '#22c55e';
  return '#eab308';
}

function TaskRow({
  task,
  jobId,
  onUpdate,
}: {
  task: ChildTask;
  jobId: string;
  onUpdate: () => void;
}) {
  const [toggling, setToggling] = useState(false);
  const isComplete = task.progress !== null && task.progress >= 1;

  async function toggleComplete() {
    setToggling(true);
    try {
      await fetch('/api/dashboard/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateProgress',
          taskId: task.id,
          progress: isComplete ? 0 : 1,
        }),
      });
      onUpdate();
    } catch (err) {
      console.error('Failed to update task:', err);
    } finally {
      setToggling(false);
    }
  }

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
      style={{ borderBottom: '1px solid rgba(205,162,116,0.06)' }}
    >
      <button
        onClick={toggleComplete}
        disabled={toggling}
        className="shrink-0"
      >
        {toggling ? (
          <Loader2 size={18} className="animate-spin" style={{ color: '#8a8078' }} />
        ) : isComplete ? (
          <CheckCircle2 size={18} style={{ color: '#22c55e' }} />
        ) : (
          <Circle size={18} style={{ color: '#6b7280' }} />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p
          className="text-sm truncate"
          style={{
            color: isComplete ? '#6b7280' : '#e8e0d8',
            textDecoration: isComplete ? 'line-through' : 'none',
          }}
        >
          {task.name}
        </p>
      </div>
      {task.endDate && (
        <span className="flex items-center gap-1 text-xs shrink-0" style={{ color: '#8a8078' }}>
          <Calendar size={12} />
          {formatDate(task.endDate)}
        </span>
      )}
    </div>
  );
}

function PhaseAccordion({
  phase,
  jobId,
  onUpdate,
}: {
  phase: Phase;
  jobId: string;
  onUpdate: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [saving, setSaving] = useState(false);

  const tasks = phase.childTasks?.nodes || [];
  const completedCount = tasks.filter((t) => t.progress !== null && t.progress >= 1).length;
  const progressPct = phase.progress !== null ? Math.round(phase.progress * 100) : 0;

  async function addTask() {
    if (!newTaskName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/dashboard/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createTask',
          jobId,
          parentGroupId: phase.id,
          name: newTaskName.trim(),
        }),
      });
      const data = await res.json();
      if (data.warning) {
        // Task was created at job level due to template-imported phase limitation
        alert(data.warning);
      }
      setNewTaskName('');
      setAdding(false);
      onUpdate();
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.12)' }}
    >
      {/* Phase header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown size={16} style={{ color: '#8a8078' }} />
        ) : (
          <ChevronRight size={16} style={{ color: '#8a8078' }} />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: '#e8e0d8' }}>
            {phase.name}
          </h3>
        </div>
        {/* Progress indicator */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs" style={{ color: '#8a8078' }}>
            {completedCount}/{tasks.length}
          </span>
          <div className="w-16 h-1.5 rounded-full" style={{ background: '#1a1a1a' }}>
            <div
              className="h-1.5 rounded-full transition-all"
              style={{
                width: `${Math.max(progressPct, 4)}%`,
                background: progressColor(phase.progress),
              }}
            />
          </div>
          <span
            className="text-xs font-medium w-8 text-right"
            style={{ color: progressColor(phase.progress) }}
          >
            {progressPct}%
          </span>
        </div>
      </button>

      {/* Expanded task list */}
      {expanded && (
        <div>
          {tasks.length > 0 ? (
            tasks.map((task) => (
              <TaskRow key={task.id} task={task} jobId={jobId} onUpdate={onUpdate} />
            ))
          ) : (
            <div className="px-4 py-3 text-xs" style={{ color: '#6b7280' }}>
              No tasks in this phase yet
            </div>
          )}

          {/* Add task form */}
          <div className="px-4 py-2" style={{ borderTop: '1px solid rgba(205,162,116,0.06)' }}>
            {adding ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newTaskName}
                  onChange={(e) => setNewTaskName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTask()}
                  placeholder="Task name..."
                  autoFocus
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: '#e8e0d8' }}
                />
                <button
                  onClick={addTask}
                  disabled={saving || !newTaskName.trim()}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: '#C9A84C20', color: '#C9A84C' }}
                >
                  {saving ? '...' : 'Add'}
                </button>
                <button onClick={() => { setAdding(false); setNewTaskName(''); }}>
                  <X size={14} style={{ color: '#8a8078' }} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex items-center gap-1.5 text-xs py-1"
                style={{ color: '#8a8078' }}
              >
                <Plus size={12} />
                Add task
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectScheduleDetail() {
  const params = useParams();
  const jobId = params.jobId as string;
  const [schedule, setSchedule] = useState<JobSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addingPhase, setAddingPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [savingPhase, setSavingPhase] = useState(false);

  const loadSchedule = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/schedule?jobId=${jobId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSchedule(data.schedule);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  async function addPhase() {
    if (!newPhaseName.trim()) return;
    setSavingPhase(true);
    try {
      await fetch('/api/dashboard/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createPhase',
          jobId,
          name: newPhaseName.trim(),
        }),
      });
      setNewPhaseName('');
      setAddingPhase(false);
      await loadSchedule();
    } catch (err) {
      console.error('Failed to create phase:', err);
    } finally {
      setSavingPhase(false);
    }
  }

  const progressPct = schedule ? Math.round(schedule.totalProgress * 100) : 0;

  // Separate standalone tasks (non-group, no parent) from phase groups
  const allTasks = schedule?.phases || [];

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <Link
        href="/dashboard/precon"
        className="inline-flex items-center gap-1.5 text-sm"
        style={{ color: '#8a8078' }}
      >
        <ArrowLeft size={16} />
        All Projects
      </Link>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin" style={{ color: '#C9A84C' }} />
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl text-center" style={{ background: '#242424' }}>
          <p className="text-sm" style={{ color: '#ef4444' }}>Error: {error}</p>
        </div>
      ) : schedule ? (
        <>
          {/* Project header */}
          <div>
            <h1
              className="text-2xl font-bold"
              style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}
            >
              {schedule.name}
            </h1>
            <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
              {schedule.clientName || schedule.locationName}
              {schedule.number ? ` \u00B7 #${schedule.number}` : ''}
            </p>
          </div>

          {/* Overall progress */}
          <div
            className="p-4 rounded-xl"
            style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.12)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium" style={{ color: '#e8e0d8' }}>
                Overall Progress
              </span>
              <span className="text-sm font-bold" style={{ color: '#C9A84C' }}>
                {progressPct}%
              </span>
            </div>
            <div className="w-full h-3 rounded-full" style={{ background: '#1a1a1a' }}>
              <div
                className="h-3 rounded-full transition-all"
                style={{
                  width: `${Math.max(progressPct, 2)}%`,
                  background: progressPct >= 100 ? '#22c55e' : progressPct > 0 ? '#C9A84C' : '#3f3f3f',
                }}
              />
            </div>
            <p className="text-xs mt-2" style={{ color: '#8a8078' }}>
              {allTasks.length} phase{allTasks.length !== 1 ? 's' : ''} in schedule
            </p>
          </div>

          {/* Phase accordions */}
          <div className="space-y-3">
            {allTasks.map((phase) => (
              <PhaseAccordion
                key={phase.id}
                phase={phase}
                jobId={jobId}
                onUpdate={loadSchedule}
              />
            ))}
          </div>

          {/* Add phase */}
          <div>
            {addingPhase ? (
              <div
                className="flex items-center gap-2 p-4 rounded-xl"
                style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.12)' }}
              >
                <input
                  type="text"
                  value={newPhaseName}
                  onChange={(e) => setNewPhaseName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPhase()}
                  placeholder="Phase name (e.g. Design & Planning)"
                  autoFocus
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: '#e8e0d8' }}
                />
                <button
                  onClick={addPhase}
                  disabled={savingPhase || !newPhaseName.trim()}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ background: '#C9A84C', color: '#1a1a1a' }}
                >
                  {savingPhase ? '...' : 'Create Phase'}
                </button>
                <button onClick={() => { setAddingPhase(false); setNewPhaseName(''); }}>
                  <X size={16} style={{ color: '#8a8078' }} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingPhase(true)}
                className="flex items-center gap-2 text-sm px-4 py-3 rounded-xl w-full hover:bg-white/[0.02] transition-colors"
                style={{
                  color: '#C9A84C',
                  border: '1px dashed rgba(201,168,76,0.3)',
                }}
              >
                <Plus size={16} />
                Add Phase
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

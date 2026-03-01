'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, ArrowLeft, ChevronDown, ChevronRight, CheckCircle2, Circle,
  Clock, Plus, Trash2, X, User, Calendar, AlertTriangle, Zap, Package,
} from 'lucide-react';
import { STANDARD_PHASES, type StatusCategoryKey } from '@/app/lib/constants';
import { BKB_STANDARD_TEMPLATE } from '@/app/lib/schedule-templates';

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
  customStatus: string | null;
  statusCategory: StatusCategoryKey | null;
  phases: Phase[];
  orphanTasks: ChildTask[];
  totalProgress: number;
}

// ============================================================
// Toast notification system (replaces browser alert())
// ============================================================

interface Toast {
  id: number;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
}

let toastId = 0;

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  const colors = {
    info: { bg: '#1e40af', border: '#3b82f6', text: '#dbeafe' },
    warning: { bg: '#78350f', border: '#f59e0b', text: '#fef3c7' },
    success: { bg: '#14532d', border: '#22c55e', text: '#dcfce7' },
    error: { bg: '#7f1d1d', border: '#ef4444', text: '#fecaca' },
  };

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2 p-3 rounded-lg shadow-lg text-sm animate-slideIn"
          style={{
            background: colors[t.type].bg,
            border: `1px solid ${colors[t.type].border}`,
            color: colors[t.type].text,
          }}
        >
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function formatDate(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function progressColor(p: number | null): string {
  if (p === null || p === 0) return '#3f3f3f';
  if (p >= 1) return '#22c55e';
  return '#eab308';
}

// Try to match a phase name to a standard phase number (for "Add Defaults" feature)
function matchPhaseNumber(phaseName: string): number | null {
  const lower = phaseName.toLowerCase().trim();
  for (const sp of STANDARD_PHASES) {
    if (lower === sp.name.toLowerCase()) return sp.number;
    if (lower.includes(sp.short.toLowerCase())) return sp.number;
  }
  // Fuzzy match common variants
  if (lower.includes('admin')) return 1;
  if (lower.includes('conceptual')) return 2;
  if (lower.includes('design dev') || lower.includes('selections')) return 3;
  if (lower.includes('contract')) return 4;
  if (lower.includes('precon') || lower.includes('pre-con') || lower.includes('preconstruction')) return 5;
  if (lower.includes('production') || lower.includes('in prod')) return 6;
  if (lower.includes('inspection')) return 7;
  if (lower.includes('punch')) return 8;
  if (lower.includes('completion') || lower.includes('closeout') || lower.includes('close-out')) return 9;
  return null;
}

// ============================================================
// Task Row Component
// ============================================================

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

// ============================================================
// Phase Accordion Component
// ============================================================

function PhaseAccordion({
  phase,
  jobId,
  onUpdate,
  addToast,
}: {
  phase: Phase;
  jobId: string;
  onUpdate: () => void;
  addToast: (message: string, type: Toast['type']) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [saving, setSaving] = useState(false);
  const [fillingDefaults, setFillingDefaults] = useState(false);

  const tasks = phase.childTasks?.nodes || [];
  const completedCount = tasks.filter((t) => t.progress !== null && t.progress >= 1).length;
  const progressPct = phase.progress !== null ? Math.round(phase.progress * 100) : 0;

  // Check if this phase matches a standard phase (for "Add Defaults" button)
  const matchedPhaseNumber = matchPhaseNumber(phase.name);
  const hasDefaults = matchedPhaseNumber
    ? BKB_STANDARD_TEMPLATE.some((p) => p.phaseNumber === matchedPhaseNumber && !p.startsEmpty && p.tasks.length > 0)
    : false;
  const showAddDefaults = tasks.length === 0 && hasDefaults;

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
        addToast(data.warning, 'warning');
      } else {
        addToast(`Task added to ${phase.name}`, 'success');
      }
      setNewTaskName('');
      setAdding(false);
      onUpdate();
    } catch (err) {
      console.error('Failed to create task:', err);
      addToast('Failed to create task', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function fillDefaults() {
    if (!matchedPhaseNumber) return;
    setFillingDefaults(true);
    try {
      const res = await fetch('/api/dashboard/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'applyPhaseDefaults',
          jobId,
          parentGroupId: phase.id,
          phaseNumber: matchedPhaseNumber,
        }),
      });
      const data = await res.json();
      if (data.errors?.length > 0) {
        addToast(`Added ${data.tasksCreated} tasks with ${data.errors.length} errors`, 'warning');
      } else {
        addToast(`Added ${data.tasksCreated} default tasks to ${phase.name}`, 'success');
      }
      onUpdate();
    } catch (err) {
      console.error('Failed to fill defaults:', err);
      addToast('Failed to add default tasks', 'error');
    } finally {
      setFillingDefaults(false);
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

          {/* Add Default Tasks button (for empty phases that match standard templates) */}
          {showAddDefaults && (
            <div className="px-4 py-2" style={{ borderTop: '1px solid rgba(205,162,116,0.06)' }}>
              <button
                onClick={fillDefaults}
                disabled={fillingDefaults}
                className="flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-lg"
                style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}
              >
                {fillingDefaults ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Package size={12} />
                )}
                Add default tasks
              </button>
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

// ============================================================
// Orphan Task Section
// ============================================================

function OrphanSection({
  orphanTasks,
  jobId,
  onUpdate,
}: {
  orphanTasks: ChildTask[];
  jobId: string;
  onUpdate: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (orphanTasks.length === 0) return null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#242424', border: '1px solid rgba(245,158,11,0.3)' }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown size={16} style={{ color: '#f59e0b' }} />
        ) : (
          <ChevronRight size={16} style={{ color: '#f59e0b' }} />
        )}
        <AlertTriangle size={16} style={{ color: '#f59e0b' }} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: '#f59e0b' }}>
            Unassigned Tasks
          </h3>
          <p className="text-xs" style={{ color: '#8a8078' }}>
            {orphanTasks.length} task{orphanTasks.length !== 1 ? 's' : ''} not assigned to any phase — drag them into phases in JobTread
          </p>
        </div>
      </button>

      {expanded && (
        <div>
          {orphanTasks.map((task) => (
            <TaskRow key={task.id} task={task} jobId={jobId} onUpdate={onUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Page Component
// ============================================================

export default function ProjectScheduleDetail() {
  const params = useParams();
  const jobId = params.jobId as string;
  const [schedule, setSchedule] = useState<JobSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addingPhase, setAddingPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState('');
  const [savingPhase, setSavingPhase] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function addToast(message: string, type: Toast['type'] = 'info') {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

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
      addToast(`Phase "${newPhaseName.trim()}" created`, 'success');
      await loadSchedule();
    } catch (err) {
      console.error('Failed to create phase:', err);
      addToast('Failed to create phase', 'error');
    } finally {
      setSavingPhase(false);
    }
  }

  async function applyFullTemplate() {
    setApplyingTemplate(true);
    try {
      const res = await fetch('/api/dashboard/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'applyTemplate',
          jobId,
        }),
      });
      const data = await res.json();
      if (data.errors?.length > 0) {
        addToast(`Created ${data.phasesCreated} phases, ${data.tasksCreated} tasks (${data.errors.length} errors)`, 'warning');
      } else {
        addToast(`Standard schedule applied: ${data.phasesCreated} phases, ${data.tasksCreated} tasks`, 'success');
      }
      await loadSchedule();
    } catch (err) {
      console.error('Failed to apply template:', err);
      addToast('Failed to apply standard schedule', 'error');
    } finally {
      setApplyingTemplate(false);
    }
  }

  const progressPct = schedule ? Math.round(schedule.totalProgress * 100) : 0;
  const allPhases = schedule?.phases || [];
  const orphanTasks = schedule?.orphanTasks || [];
  const hasSchedule = allPhases.length > 0;

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

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
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm" style={{ color: '#8a8078' }}>
                {schedule.clientName || schedule.locationName}
                {schedule.number ? ` \u00B7 #${schedule.number}` : ''}
              </p>
              {schedule.customStatus && (
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{ background: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}
                >
                  {schedule.customStatus}
                </span>
              )}
            </div>
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
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs" style={{ color: '#8a8078' }}>
                {allPhases.length} phase{allPhases.length !== 1 ? 's' : ''} in schedule
              </p>
              {orphanTasks.length > 0 && (
                <p className="text-xs flex items-center gap-1" style={{ color: '#f59e0b' }}>
                  <AlertTriangle size={12} />
                  {orphanTasks.length} unassigned task{orphanTasks.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>

          {/* Apply Standard Schedule button (for projects with no/few phases) */}
          {!hasSchedule && (
            <div
              className="p-4 rounded-xl text-center"
              style={{ background: '#242424', border: '1px dashed rgba(201,168,76,0.3)' }}
            >
              <Zap size={24} style={{ color: '#C9A84C', margin: '0 auto 8px' }} />
              <p className="text-sm font-medium mb-1" style={{ color: '#e8e0d8' }}>
                No schedule set up yet
              </p>
              <p className="text-xs mb-3" style={{ color: '#8a8078' }}>
                Apply the BKB standard 9-phase schedule with default tasks and projected durations.
              </p>
              <button
                onClick={applyFullTemplate}
                disabled={applyingTemplate}
                className="text-sm px-4 py-2 rounded-lg font-medium"
                style={{ background: '#C9A84C', color: '#1a1a1a' }}
              >
                {applyingTemplate ? (
                  <span className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Applying...
                  </span>
                ) : (
                  'Apply Standard Schedule'
                )}
              </button>
            </div>
          )}

          {/* Orphan tasks warning section */}
          <OrphanSection orphanTasks={orphanTasks} jobId={jobId} onUpdate={loadSchedule} />

          {/* Phase accordions */}
          <div className="space-y-3">
            {allPhases.map((phase) => (
              <PhaseAccordion
                key={phase.id}
                phase={phase}
                jobId={jobId}
                onUpdate={loadSchedule}
                addToast={addToast}
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
                  placeholder="Phase name (e.g. Admin Tasks)"
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

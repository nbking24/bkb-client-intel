'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2, ArrowLeft, ChevronDown, ChevronRight, CheckCircle2, Circle,
  Clock, Plus, X, Calendar, AlertTriangle, Zap, Package, Eye, EyeOff,
  ArrowRightLeft, Shield,
} from 'lucide-react';
import { STANDARD_PHASES, STATUS_ACTIVE_PHASES, type StatusCategoryKey } from '@/app/lib/constants';
import { BKB_STANDARD_TEMPLATE, recommendPhaseForTask } from '@/app/lib/schedule-templates';
import { createBrowserClient } from '@/app/lib/supabase';

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
// Toast notification system
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
    info: { bg: 'rgba(200,140,0,0.08)', border: '#c88c00', text: '#1a1a1a' },
    warning: { bg: '#78350f', border: '#f59e0b', text: '#fef3c7' },
    success: { bg: '#14532d', border: '#22c55e', text: '#dcfce7' },
    error: { bg: '#7f1d1d', border: '#ef4444', text: '#fecaca' },
  };

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2 p-3 rounded-lg shadow-lg text-sm"
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

// Try to match a phase name to a standard phase number
function matchPhaseNumber(phaseName: string): number | null {
  const lower = phaseName.toLowerCase().trim();
  for (const sp of STANDARD_PHASES) {
    if (lower === sp.name.toLowerCase()) return sp.number;
    if (lower.includes(sp.short.toLowerCase())) return sp.number;
  }
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

// Audit a task: is it in the right phase?
interface AuditFlag {
  taskId: string;
  taskName: string;
  currentPhaseId: string;
  currentPhaseName: string;
  recommendedPhaseNumber: number;
  recommendedPhaseName: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

function auditTaskPlacement(
  task: ChildTask,
  currentPhaseId: string,
  currentPhaseName: string,
  currentPhaseNumber: number | null,
): AuditFlag | null {
  const rec = recommendPhaseForTask(task.name);
  if (!rec) return null; // no recommendation = we can't say it's wrong

  // If the recommended phase matches the current phase, it's fine
  if (currentPhaseNumber !== null && rec.phaseNumber === currentPhaseNumber) return null;

  return {
    taskId: task.id,
    taskName: task.name,
    currentPhaseId,
    currentPhaseName,
    recommendedPhaseNumber: rec.phaseNumber,
    recommendedPhaseName: rec.phaseName,
    confidence: rec.confidence,
    reason: rec.reason,
  };
}

// ============================================================
// Task Row Component
// ============================================================

function TaskRow({
  task,
  jobId,
  onUpdate,
  auditFlag,
  phases,
  addToast,
  onIgnoreAudit,
}: {
  task: ChildTask;
  jobId: string;
  onUpdate: () => void;
  auditFlag?: AuditFlag | null;
  phases: Phase[];
  addToast: (message: string, type: Toast['type']) => void;
  onIgnoreAudit?: (taskId: string, taskName: string) => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [moving, setMoving] = useState(false);
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

  async function moveToRecommended() {
    if (!auditFlag) return;
    // Find the target phase in the current schedule
    const targetPhase = phases.find((p) => {
      const pn = matchPhaseNumber(p.name);
      return pn === auditFlag.recommendedPhaseNumber;
    });
    if (!targetPhase) {
      addToast(`Phase "${auditFlag.recommendedPhaseName}" not found in this project's schedule. Create it first.`, 'warning');
      return;
    }

    setMoving(true);
    try {
      const res = await fetch('/api/dashboard/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'moveTask',
          jobId,
          taskId: task.id,
          taskName: task.name,
          newParentGroupId: targetPhase.id,
          startDate: task.startDate,
          endDate: task.endDate,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        addToast(`Moved "${task.name}" → ${auditFlag.recommendedPhaseName}`, 'success');
        onUpdate();
      } else {
        addToast(`Failed to move task: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      console.error('Failed to move task:', err);
      addToast('Failed to move task', 'error');
    } finally {
      setMoving(false);
    }
  }

  return (
    <div>
      <div
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
        style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}
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
              color: isComplete ? '#6b7280' : '#1a1a1a',
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
      {/* Audit flag row */}
      {auditFlag && auditFlag.confidence !== 'low' && (
        <div
          className="flex items-center gap-2 px-4 py-1.5 text-xs"
          style={{
            background: auditFlag.confidence === 'high' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
            borderBottom: '1px solid rgba(200,140,0,0.06)',
          }}
        >
          <ArrowRightLeft size={12} style={{ color: auditFlag.confidence === 'high' ? '#ef4444' : '#f59e0b' }} />
          <span style={{ color: auditFlag.confidence === 'high' ? '#fca5a5' : '#fcd34d' }}>
            Recommended: <strong>{auditFlag.recommendedPhaseName}</strong>
          </span>
          <span style={{ color: '#8a8078' }}>({auditFlag.reason})</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={moveToRecommended}
              disabled={moving}
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{
                background: auditFlag.confidence === 'high' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
                color: auditFlag.confidence === 'high' ? '#fca5a5' : '#fcd34d',
              }}
            >
              {moving ? '...' : 'Move'}
            </button>
            {onIgnoreAudit && (
              <button
                onClick={() => onIgnoreAudit(task.id, task.name)}
                className="px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1"
                style={{ background: 'rgba(138,128,120,0.15)', color: '#8a8078' }}
              >
                <EyeOff size={10} /> Ignore
              </button>
            )}
          </div>
        </div>
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
  allPhases,
  isActivePhase,
  ignoredTaskIds,
  onIgnoreAudit,
}: {
  phase: Phase;
  jobId: string;
  onUpdate: () => void;
  addToast: (message: string, type: Toast['type']) => void;
  allPhases: Phase[];
  isActivePhase: boolean;
  ignoredTaskIds: Set<string>;
  onIgnoreAudit: (taskId: string, taskName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [saving, setSaving] = useState(false);
  const [fillingDefaults, setFillingDefaults] = useState(false);

  const tasks = phase.childTasks?.nodes || [];
  const pendingTasks = tasks.filter((t) => t.progress === null || t.progress < 1);
  const completedTasks = tasks.filter((t) => t.progress !== null && t.progress >= 1);
  const completedCount = completedTasks.length;
  const totalCount = tasks.length;
  const progressPct = phase.progress !== null ? Math.round(phase.progress * 100) : 0;

  // Auto-expand if this phase has pending tasks and is an active phase
  useEffect(() => {
    if (isActivePhase && pendingTasks.length > 0) {
      setExpanded(true);
    }
  }, [isActivePhase, pendingTasks.length]);

  // Phase matching for defaults and audit
  const matchedPhaseNumber = matchPhaseNumber(phase.name);
  const hasDefaults = matchedPhaseNumber
    ? BKB_STANDARD_TEMPLATE.some((p) => p.phaseNumber === matchedPhaseNumber && !p.startsEmpty && p.tasks.length > 0)
    : false;
  const showAddDefaults = tasks.length === 0 && hasDefaults;

  // Audit: check each pending task placement (filter out ignored)
  const auditFlags: Map<string, AuditFlag> = new Map();
  for (const task of tasks) {
    if (ignoredTaskIds.has(task.id)) continue;
    const flag = auditTaskPlacement(task, phase.id, phase.name, matchedPhaseNumber);
    if (flag) auditFlags.set(task.id, flag);
  }
  const mismatchCount = auditFlags.size;

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

  // Determine the phase status indicator
  const phaseStatus = progressPct >= 100 ? 'complete' : pendingTasks.length > 0 ? 'active' : totalCount === 0 ? 'empty' : 'not_started';
  const statusDot = {
    complete: '#22c55e',
    active: '#eab308',
    not_started: '#3f3f3f',
    empty: '#3f3f3f',
  }[phaseStatus];

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: '#f8f6f3',
        border: `1px solid ${isActivePhase && phaseStatus === 'active' ? 'rgba(201,168,76,0.3)' : 'rgba(200,140,0,0.12)'}`,
      }}
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
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: statusDot }} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
            {phase.name}
          </h3>
        </div>
        {/* Audit mismatch indicator */}
        {mismatchCount > 0 && (
          <span
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
            style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
          >
            <ArrowRightLeft size={10} />
            {mismatchCount}
          </span>
        )}
        {/* Progress indicator */}
        <div className="flex items-center gap-2 shrink-0">
          {totalCount > 0 ? (
            <>
              <span className="text-xs" style={{ color: '#8a8078' }}>
                {pendingTasks.length} left
              </span>
              <div className="w-16 h-1.5 rounded-full" style={{ background: '#ffffff' }}>
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
            </>
          ) : (
            <span className="text-xs" style={{ color: '#6b7280' }}>empty</span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div>
          {/* Pending tasks (always shown) */}
          {pendingTasks.length > 0 ? (
            pendingTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                jobId={jobId}
                onUpdate={onUpdate}
                auditFlag={auditFlags.get(task.id)}
                phases={allPhases}
                addToast={addToast}
                onIgnoreAudit={onIgnoreAudit}
              />
            ))
          ) : totalCount === 0 ? (
            <div className="px-4 py-3 text-xs" style={{ color: '#6b7280' }}>
              No tasks in this phase yet
            </div>
          ) : (
            <div className="px-4 py-3 text-xs flex items-center gap-1.5" style={{ color: '#22c55e' }}>
              <CheckCircle2 size={12} />
              All tasks complete
            </div>
          )}

          {/* Completed tasks toggle */}
          {completedCount > 0 && (
            <div style={{ borderTop: '1px solid rgba(200,140,0,0.06)' }}>
              <button
                onClick={() => setShowCompleted(!showCompleted)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs w-full hover:bg-white/[0.02]"
                style={{ color: '#6b7280' }}
              >
                {showCompleted ? <EyeOff size={12} /> : <Eye size={12} />}
                {showCompleted ? 'Hide' : 'Show'} {completedCount} completed task{completedCount !== 1 ? 's' : ''}
              </button>
              {showCompleted && (
                <div>
                  {completedTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      jobId={jobId}
                      onUpdate={onUpdate}
                      auditFlag={auditFlags.get(task.id)}
                      phases={allPhases}
                      addToast={addToast}
                      onIgnoreAudit={onIgnoreAudit}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add Default Tasks button */}
          {showAddDefaults && (
            <div className="px-4 py-2" style={{ borderTop: '1px solid rgba(200,140,0,0.06)' }}>
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
          <div className="px-4 py-2" style={{ borderTop: '1px solid rgba(200,140,0,0.06)' }}>
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
                  style={{ color: '#1a1a1a' }}
                />
                <button
                  onClick={addTask}
                  disabled={saving || !newTaskName.trim()}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: '#c88c0020', color: '#c88c00' }}
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
  phases,
  addToast,
  onIgnoreAudit,
}: {
  orphanTasks: ChildTask[];
  jobId: string;
  onUpdate: () => void;
  phases: Phase[];
  addToast: (message: string, type: Toast['type']) => void;
  onIgnoreAudit: (taskId: string, taskName: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (orphanTasks.length === 0) return null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#f8f6f3', border: '1px solid rgba(245,158,11,0.3)' }}
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
            {orphanTasks.length} task{orphanTasks.length !== 1 ? 's' : ''} not assigned to any phase
          </p>
        </div>
      </button>

      {expanded && (
        <div>
          {orphanTasks.map((task) => {
            const rec = recommendPhaseForTask(task.name);
            const auditFlag: AuditFlag | null = rec ? {
              taskId: task.id,
              taskName: task.name,
              currentPhaseId: '',
              currentPhaseName: 'Unassigned',
              recommendedPhaseNumber: rec.phaseNumber,
              recommendedPhaseName: rec.phaseName,
              confidence: rec.confidence,
              reason: rec.reason,
            } : null;
            return (
              <TaskRow
                key={task.id}
                task={task}
                jobId={jobId}
                onUpdate={onUpdate}
                auditFlag={auditFlag}
                phases={phases}
                addToast={addToast}
                onIgnoreAudit={onIgnoreAudit}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Stage Indicator — shows where the project is in the lifecycle
// ============================================================

function StageIndicator({ statusCategory, customStatus }: { statusCategory: StatusCategoryKey | null; customStatus: string | null }) {
  const stages: { key: StatusCategoryKey; label: string; color: string }[] = [
    { key: 'LEADS', label: 'Lead', color: '#8b5cf6' },
    { key: 'IN_DESIGN', label: 'Design', color: '#eab308' },
    { key: 'READY', label: 'Ready', color: '#c88c00' },
    { key: 'IN_PRODUCTION', label: 'Production', color: '#22c55e' },
    { key: 'FINAL_BILLING', label: 'Billing', color: '#f97316' },
  ];

  const currentIdx = stages.findIndex((s) => s.key === statusCategory);

  return (
    <div className="flex items-center gap-1">
      {stages.map((stage, idx) => {
        const isCurrent = idx === currentIdx;
        const isPast = currentIdx >= 0 && idx < currentIdx;
        return (
          <div key={stage.key} className="flex items-center gap-1">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                background: isCurrent ? `${stage.color}25` : isPast ? `${stage.color}10` : 'rgba(255,255,255,0.03)',
                color: isCurrent ? stage.color : isPast ? `${stage.color}80` : '#4a4a4a',
                border: isCurrent ? `1px solid ${stage.color}50` : '1px solid transparent',
              }}
            >
              {isPast && <CheckCircle2 size={10} />}
              {stage.label}
            </div>
            {idx < stages.length - 1 && (
              <div
                className="w-4 h-px"
                style={{ background: isPast ? `${stage.color}40` : 'rgba(255,255,255,0.06)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Mismatch Panel — lists all misplaced tasks with Move/Ignore
// ============================================================

function MismatchPanel({
  allPhases,
  ignoredTaskIds,
  jobId,
  onUpdate,
  addToast,
  onIgnoreAudit,
}: {
  allPhases: Phase[];
  ignoredTaskIds: Set<string>;
  jobId: string;
  onUpdate: () => void;
  addToast: (message: string, type: Toast['type']) => void;
  onIgnoreAudit: (taskId: string, taskName: string) => void;
}) {
  // Collect all mismatched tasks across all phases
  const mismatches: { task: ChildTask; flag: AuditFlag; phase: Phase }[] = [];
  for (const phase of allPhases) {
    const phaseNum = matchPhaseNumber(phase.name);
    const tasks = phase.childTasks?.nodes || [];
    for (const task of tasks) {
      if (ignoredTaskIds.has(task.id)) continue;
      const flag = auditTaskPlacement(task, phase.id, phase.name, phaseNum);
      if (flag && flag.confidence !== 'low') {
        mismatches.push({ task, flag, phase });
      }
    }
  }

  if (mismatches.length === 0) return null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Shield size={18} style={{ color: '#fca5a5' }} />
        <p className="text-sm font-medium" style={{ color: '#fca5a5' }}>
          Schedule Audit: {mismatches.length} task{mismatches.length !== 1 ? 's' : ''} may be in the wrong phase
        </p>
      </div>
      <div style={{ borderTop: '1px solid rgba(239,68,68,0.12)' }}>
        {mismatches.map(({ task, flag }) => (
          <MismatchRow
            key={task.id}
            task={task}
            flag={flag}
            phases={allPhases}
            jobId={jobId}
            onUpdate={onUpdate}
            addToast={addToast}
            onIgnoreAudit={onIgnoreAudit}
          />
        ))}
      </div>
    </div>
  );
}

function MismatchRow({
  task,
  flag,
  phases,
  jobId,
  onUpdate,
  addToast,
  onIgnoreAudit,
}: {
  task: ChildTask;
  flag: AuditFlag;
  phases: Phase[];
  jobId: string;
  onUpdate: () => void;
  addToast: (message: string, type: Toast['type']) => void;
  onIgnoreAudit: (taskId: string, taskName: string) => void;
}) {
  const [moving, setMoving] = useState(false);

  async function moveToRecommended() {
    const targetPhase = phases.find((p) => {
      const pn = matchPhaseNumber(p.name);
      return pn === flag.recommendedPhaseNumber;
    });
    if (!targetPhase) {
      addToast(`Phase "${flag.recommendedPhaseName}" not found. Create it first.`, 'warning');
      return;
    }
    setMoving(true);
    try {
      const res = await fetch('/api/dashboard/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'moveTask',
          jobId,
          taskId: task.id,
          taskName: task.name,
          newParentGroupId: targetPhase.id,
          startDate: task.startDate,
          endDate: task.endDate,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        addToast(`Moved "${task.name}" → ${flag.recommendedPhaseName}`, 'success');
        onUpdate();
      } else {
        addToast(`Failed to move task: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      console.error('Failed to move task:', err);
      addToast('Failed to move task', 'error');
    } finally {
      setMoving(false);
    }
  }

  const confColor = flag.confidence === 'high' ? '#fca5a5' : '#fcd34d';
  const confBg = flag.confidence === 'high' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)';

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5"
      style={{ borderBottom: '1px solid rgba(239,68,68,0.08)' }}
    >
      <ArrowRightLeft size={13} style={{ color: confColor, flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: '#1a1a1a' }}>{task.name}</p>
        <p className="text-[11px] mt-0.5" style={{ color: '#8a8078' }}>
          In <span style={{ color: '#a09088' }}>{flag.currentPhaseName}</span> → should be <span style={{ color: confColor }}>{flag.recommendedPhaseName}</span>
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={moveToRecommended}
          disabled={moving}
          className="px-2.5 py-1 rounded text-xs font-medium"
          style={{ background: confBg, color: confColor }}
        >
          {moving ? '...' : 'Move'}
        </button>
        <button
          onClick={() => onIgnoreAudit(task.id, task.name)}
          className="px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1"
          style={{ background: 'rgba(138,128,120,0.15)', color: '#8a8078' }}
        >
          <EyeOff size={10} /> Ignore
        </button>
      </div>
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
  const [ignoredTaskIds, setIgnoredTaskIds] = useState<Set<string>>(new Set());

  // Load ignored audit dismissals from Supabase
  useEffect(() => {
    async function loadDismissals() {
      try {
        const supabase = createBrowserClient();
        const { data } = await supabase
          .from('agent_dismissals')
          .select('rec_action')
          .eq('job_id', jobId)
          .eq('rec_action_type', 'auditPlacement');
        if (data && data.length > 0) {
          setIgnoredTaskIds(new Set(data.map((d: { rec_action: string }) => d.rec_action)));
        }
      } catch (err) {
        console.error('Failed to load audit dismissals:', err);
      }
    }
    loadDismissals();
  }, [jobId]);

  async function handleIgnoreAudit(taskId: string, taskName: string) {
    // Optimistic local update
    setIgnoredTaskIds((prev) => { const next = new Set(Array.from(prev)); next.add(taskId); return next; });
    addToast(`Ignored placement flag for "${taskName}"`, 'info');
    try {
      const supabase = createBrowserClient();
      await supabase.from('agent_dismissals').upsert({
        job_id: jobId,
        rec_action: taskId,
        rec_action_type: 'auditPlacement',
        rec_description: taskName,
        dismissal_type: 'ignored',
        dismissed_by: 'nathan',
      }, { onConflict: 'job_id,rec_action,rec_action_type' });
    } catch (err) {
      console.error('Failed to save audit dismissal:', err);
      // Revert on failure
      setIgnoredTaskIds((prev) => {
        const next = new Set(Array.from(prev));
        next.delete(taskId);
        return next;
      });
      addToast('Failed to save dismissal', 'error');
    }
  }

  function addToast(message: string, type: Toast['type'] = 'info') {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
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

  // Determine which phases are "active" based on status
  const activePhaseNumbers = schedule?.statusCategory
    ? STATUS_ACTIVE_PHASES[schedule.statusCategory] || []
    : [];

  // Count total audit issues across all phases (excluding ignored)
  const totalMismatches = allPhases.reduce((count, phase) => {
    const phaseNum = matchPhaseNumber(phase.name);
    const tasks = phase.childTasks?.nodes || [];
    return count + tasks.filter((t) => {
      if (ignoredTaskIds.has(t.id)) return false;
      const flag = auditTaskPlacement(t, phase.id, phase.name, phaseNum);
      return flag && flag.confidence !== 'low';
    }).length;
  }, 0);

  // Sort phases: Admin Tasks (phase 1) first, then by standard number, complete phases to bottom, unmatched at end
  const sortedPhases = [...allPhases].sort((a, b) => {
    const aNum = matchPhaseNumber(a.name);
    const bNum = matchPhaseNumber(b.name);
    const aProgress = a.progress !== null ? Math.round(a.progress * 100) : 0;
    const bProgress = b.progress !== null ? Math.round(b.progress * 100) : 0;
    const aTasks = a.childTasks?.nodes?.length || 0;
    const bTasks = b.childTasks?.nodes?.length || 0;
    const aComplete = aTasks > 0 && aProgress >= 100;
    const bComplete = bTasks > 0 && bProgress >= 100;

    // 100% complete phases go to the bottom
    if (aComplete !== bComplete) return aComplete ? 1 : -1;

    // Then sort by standard phase number (Admin Tasks = 1 goes first)
    if (aNum !== null && bNum !== null) return aNum - bNum;
    if (aNum !== null) return -1;
    if (bNum !== null) return 1;

    // Unmatched phases keep original order
    return 0;
  });

  // Summary stats
  const totalPending = allPhases.reduce((sum, p) => {
    const tasks = p.childTasks?.nodes || [];
    return sum + tasks.filter((t) => t.progress === null || t.progress < 1).length;
  }, 0);
  const totalCompleted = allPhases.reduce((sum, p) => {
    const tasks = p.childTasks?.nodes || [];
    return sum + tasks.filter((t) => t.progress !== null && t.progress >= 1).length;
  }, 0);
  const phasesWithWork = allPhases.filter((p) => {
    const tasks = p.childTasks?.nodes || [];
    return tasks.some((t) => t.progress === null || t.progress < 1);
  }).length;

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
          <Loader2 size={28} className="animate-spin" style={{ color: '#c88c00' }} />
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl text-center" style={{ background: '#f8f6f3' }}>
          <p className="text-sm" style={{ color: '#ef4444' }}>Error: {error}</p>
        </div>
      ) : schedule ? (
        <>
          {/* Project header */}
          <div>
            <h1
              className="text-2xl font-bold"
              style={{ fontFamily: 'Georgia, serif', color: '#c88c00' }}
            >
              {schedule.name}
            </h1>
            <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
              {schedule.clientName || schedule.locationName}
              {schedule.number ? ` · #${schedule.number}` : ''}
            </p>
          </div>

          {/* Stage indicator */}
          <StageIndicator statusCategory={schedule.statusCategory} customStatus={schedule.customStatus} />

          {/* Stats bar */}
          <div
            className="p-4 rounded-xl"
            style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.12)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
                Overall Progress
              </span>
              <span className="text-sm font-bold" style={{ color: '#c88c00' }}>
                {progressPct}%
              </span>
            </div>
            <div className="w-full h-3 rounded-full" style={{ background: '#ffffff' }}>
              <div
                className="h-3 rounded-full transition-all"
                style={{
                  width: `${Math.max(progressPct, 2)}%`,
                  background: progressPct >= 100 ? '#22c55e' : progressPct > 0 ? '#c88c00' : '#3f3f3f',
                }}
              />
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: '#8a8078' }}>
              <span className="flex items-center gap-1">
                <Clock size={12} style={{ color: '#eab308' }} />
                {totalPending} pending
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 size={12} style={{ color: '#22c55e' }} />
                {totalCompleted} done
              </span>
              <span className="flex items-center gap-1">
                <Package size={12} style={{ color: '#8a8078' }} />
                {phasesWithWork} active phase{phasesWithWork !== 1 ? 's' : ''}
              </span>
              {orphanTasks.length > 0 && (
                <span className="flex items-center gap-1" style={{ color: '#f59e0b' }}>
                  <AlertTriangle size={12} />
                  {orphanTasks.length} unassigned
                </span>
              )}
              {totalMismatches > 0 && (
                <span className="flex items-center gap-1" style={{ color: '#ef4444' }}>
                  <ArrowRightLeft size={12} />
                  {totalMismatches} misplaced
                </span>
              )}
            </div>
          </div>

          {/* Schedule audit panel — lists each misplaced task with Move/Ignore */}
          {totalMismatches > 0 && (
            <MismatchPanel
              allPhases={allPhases}
              ignoredTaskIds={ignoredTaskIds}
              jobId={jobId}
              onUpdate={loadSchedule}
              addToast={addToast}
              onIgnoreAudit={handleIgnoreAudit}
            />
          )}

          {/* Apply Standard Schedule button (for projects with no phases) */}
          {!hasSchedule && (
            <div
              className="p-4 rounded-xl text-center"
              style={{ background: '#f8f6f3', border: '1px dashed rgba(201,168,76,0.3)' }}
            >
              <Zap size={24} style={{ color: '#c88c00', margin: '0 auto 8px' }} />
              <p className="text-sm font-medium mb-1" style={{ color: '#1a1a1a' }}>
                No schedule set up yet
              </p>
              <p className="text-xs mb-3" style={{ color: '#8a8078' }}>
                Apply the BKB standard 9-phase schedule with default tasks and projected durations.
              </p>
              <button
                onClick={applyFullTemplate}
                disabled={applyingTemplate}
                className="text-sm px-4 py-2 rounded-lg font-medium"
                style={{ background: '#c88c00', color: '#ffffff' }}
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
          <OrphanSection
            orphanTasks={orphanTasks}
            jobId={jobId}
            onUpdate={loadSchedule}
            phases={allPhases}
            addToast={addToast}
            onIgnoreAudit={handleIgnoreAudit}
          />

          {/* Phase accordions — sorted: Admin Tasks first, then by standard phase number, 100% complete to bottom */}
          <div className="space-y-3">
            {sortedPhases.map((phase) => {
              const phaseNum = matchPhaseNumber(phase.name);
              const isActive = phaseNum !== null && activePhaseNumbers.includes(phaseNum);
              return (
                <PhaseAccordion
                  key={phase.id}
                  phase={phase}
                  jobId={jobId}
                  onUpdate={loadSchedule}
                  addToast={addToast}
                  allPhases={allPhases}
                  isActivePhase={isActive}
                  ignoredTaskIds={ignoredTaskIds}
                  onIgnoreAudit={handleIgnoreAudit}
                />
              );
            })}
          </div>

          {/* Add phase */}
          <div>
            {addingPhase ? (
              <div
                className="flex items-center gap-2 p-4 rounded-xl"
                style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.12)' }}
              >
                <input
                  type="text"
                  value={newPhaseName}
                  onChange={(e) => setNewPhaseName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPhase()}
                  placeholder="Phase name (e.g. Admin Tasks)"
                  autoFocus
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ color: '#1a1a1a' }}
                />
                <button
                  onClick={addPhase}
                  disabled={savingPhase || !newPhaseName.trim()}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium"
                  style={{ background: '#c88c00', color: '#ffffff' }}
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
                  color: '#c88c00',
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

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Loader2, ArrowLeft, ArrowRightLeft, AlertTriangle, Shield, CheckCircle2,
  ChevronDown, ChevronRight, X, Filter,
} from 'lucide-react';
import { STATUS_CATEGORY_LABELS, type StatusCategoryKey } from '@/app/lib/constants';

interface AuditIssue {
  taskId: string;
  taskName: string;
  taskProgress: number | null;
  startDate: string | null;
  endDate: string | null;
  jobId: string;
  jobName: string;
  jobNumber: string;
  customStatus: string | null;
  statusCategory: StatusCategoryKey | null;
  currentPhaseId: string | null;
  currentPhaseName: string | null;
  recommendedPhaseNumber: number;
  recommendedPhaseName: string;
  confidence: 'high' | 'medium';
  reason: string;
  isOrphan: boolean;
}

interface AuditStats {
  totalJobs: number;
  totalTasks: number;
  misplacedTasks: number;
  orphanTasks: number;
  jobsWithIssues: number;
}

function formatDate(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================================
// Toast system
// ============================================================

interface Toast {
  id: number;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
}

let toastIdCounter = 0;

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
          style={{ background: colors[t.type].bg, border: `1px solid ${colors[t.type].border}`, color: colors[t.type].text }}
        >
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="shrink-0 opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Issue Row
// ============================================================

function IssueRow({
  issue,
  addToast,
  onFixed,
}: {
  issue: AuditIssue;
  addToast: (msg: string, type: Toast['type']) => void;
  onFixed: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const isComplete = issue.taskProgress !== null && issue.taskProgress >= 1;

  async function handleMove() {
    setMoving(true);
    try {
      // We need to find the target phase group for this job
      // First, load the job schedule to find the matching phase
      const schedRes = await fetch(`/api/dashboard/schedule?jobId=${issue.jobId}`);
      const schedData = await schedRes.json();
      if (schedData.error) throw new Error(schedData.error);

      const targetPhase = (schedData.schedule?.phases || []).find((p: any) => {
        const lower = p.name.toLowerCase();
        const recLower = issue.recommendedPhaseName.toLowerCase();
        return lower === recLower || lower.includes(recLower) || recLower.includes(lower);
      });

      if (!targetPhase) {
        addToast(`Phase "${issue.recommendedPhaseName}" not found on ${issue.jobName}. Create it first.`, 'warning');
        return;
      }

      const res = await fetch('/api/dashboard/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'moveTask',
          jobId: issue.jobId,
          taskId: issue.taskId,
          taskName: issue.taskName,
          newParentGroupId: targetPhase.id,
          startDate: issue.startDate,
          endDate: issue.endDate,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        addToast(`Moved "${issue.taskName}" → ${issue.recommendedPhaseName}`, 'success');
        onFixed();
      } else {
        addToast(`Failed: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (err: any) {
      addToast(`Error: ${err.message}`, 'error');
    } finally {
      setMoving(false);
    }
  }

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
      style={{ borderBottom: '1px solid rgba(200,140,0,0.06)' }}
    >
      {/* Issue type icon */}
      {issue.isOrphan ? (
        <AlertTriangle size={16} style={{ color: '#f59e0b' }} className="shrink-0" />
      ) : (
        <ArrowRightLeft size={16} style={{ color: issue.confidence === 'high' ? '#ef4444' : '#f59e0b' }} className="shrink-0" />
      )}

      {/* Task info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: isComplete ? '#6b7280' : '#1a1a1a' }}>
          {issue.taskName}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <Link
            href={`/dashboard/precon/${issue.jobId}`}
            className="text-xs hover:underline"
            style={{ color: '#c88c00' }}
          >
            {issue.jobName}
          </Link>
          {issue.jobNumber && (
            <span className="text-[10px]" style={{ color: '#6b7280' }}>#{issue.jobNumber}</span>
          )}
        </div>
      </div>

      {/* Current location */}
      <div className="text-right shrink-0 hidden sm:block">
        <p className="text-[10px] uppercase tracking-wider" style={{ color: '#6b7280' }}>Current</p>
        <p className="text-xs" style={{ color: issue.isOrphan ? '#f59e0b' : '#8a8078' }}>
          {issue.isOrphan ? 'Unassigned' : issue.currentPhaseName}
        </p>
      </div>

      {/* Arrow */}
      <span className="text-xs shrink-0 hidden sm:block" style={{ color: '#6b7280' }}>→</span>

      {/* Recommended */}
      <div className="text-right shrink-0 hidden sm:block">
        <p className="text-[10px] uppercase tracking-wider" style={{ color: '#6b7280' }}>Move to</p>
        <p className="text-xs font-medium" style={{ color: issue.confidence === 'high' ? '#fca5a5' : '#fcd34d' }}>
          {issue.recommendedPhaseName}
        </p>
      </div>

      {/* Move button */}
      <button
        onClick={handleMove}
        disabled={moving}
        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium"
        style={{
          background: issue.confidence === 'high' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
          color: issue.confidence === 'high' ? '#fca5a5' : '#fcd34d',
        }}
      >
        {moving ? <Loader2 size={12} className="animate-spin" /> : 'Fix'}
      </button>
    </div>
  );
}

// ============================================================
// Job Section (grouped issues)
// ============================================================

function JobSection({
  jobId,
  jobName,
  jobNumber,
  customStatus,
  issues,
  addToast,
  onFixed,
}: {
  jobId: string;
  jobName: string;
  jobNumber: string;
  customStatus: string | null;
  issues: AuditIssue[];
  addToast: (msg: string, type: Toast['type']) => void;
  onFixed: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const highCount = issues.filter((i) => i.confidence === 'high').length;
  const orphanCount = issues.filter((i) => i.isOrphan).length;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.12)' }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        {expanded ? <ChevronDown size={16} style={{ color: '#8a8078' }} /> : <ChevronRight size={16} style={{ color: '#8a8078' }} />}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate" style={{ color: '#1a1a1a' }}>
            {jobName}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            {jobNumber && <span className="text-[10px]" style={{ color: '#6b7280' }}>#{jobNumber}</span>}
            {customStatus && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(201,168,76,0.15)', color: '#c88c00' }}
              >
                {customStatus}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {highCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}>
              {highCount} misplaced
            </span>
          )}
          {orphanCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.15)', color: '#fcd34d' }}>
              {orphanCount} orphan
            </span>
          )}
          <span className="text-xs" style={{ color: '#8a8078' }}>
            {issues.length} issue{issues.length !== 1 ? 's' : ''}
          </span>
        </div>
      </button>
      {expanded && (
        <div>
          {issues.map((issue) => (
            <IssueRow key={issue.taskId} issue={issue} addToast={addToast} onFixed={onFixed} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Audit Page
// ============================================================

export default function ScheduleAuditPage() {
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filter, setFilter] = useState<'all' | 'misplaced' | 'orphan'>('all');
  const [confidenceFilter, setConfidenceFilter] = useState<'all' | 'high' | 'medium'>('all');

  function addToast(message: string, type: Toast['type'] = 'info') {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  async function loadAudit() {
    try {
      setLoading(true);
      const res = await fetch('/api/dashboard/schedule?audit=true');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setIssues(data.issues || []);
      setStats(data.stats || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAudit();
  }, []);

  // Apply filters
  const filtered = issues.filter((i) => {
    if (filter === 'misplaced' && i.isOrphan) return false;
    if (filter === 'orphan' && !i.isOrphan) return false;
    if (confidenceFilter !== 'all' && i.confidence !== confidenceFilter) return false;
    return true;
  });

  // Group by job
  const grouped: Record<string, AuditIssue[]> = {};
  for (const issue of filtered) {
    if (!grouped[issue.jobId]) grouped[issue.jobId] = [];
    grouped[issue.jobId].push(issue);
  }

  // Sort: jobs with most high-confidence issues first
  const jobOrder = Object.entries(grouped).sort((a, b) => {
    const aHigh = a[1].filter((i) => i.confidence === 'high').length;
    const bHigh = b[1].filter((i) => i.confidence === 'high').length;
    return bHigh - aHigh || b[1].length - a[1].length;
  });

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

      {/* Header */}
      <div>
        <h1
          className="text-2xl font-bold flex items-center gap-3"
          style={{ fontFamily: 'Georgia, serif', color: '#c88c00' }}
        >
          <Shield size={28} />
          Schedule Audit
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
          Scans all active projects for misplaced tasks and orphan assignments.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin" style={{ color: '#c88c00' }} />
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl text-center" style={{ background: '#f8f6f3' }}>
          <p className="text-sm" style={{ color: '#ef4444' }}>Error: {error}</p>
        </div>
      ) : (
        <>
          {/* Stats cards */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Active Jobs', value: stats.totalJobs, color: '#c88c00' },
                { label: 'Tasks Scanned', value: stats.totalTasks, color: '#8a8078' },
                { label: 'Misplaced', value: stats.misplacedTasks, color: '#ef4444' },
                { label: 'Orphaned', value: stats.orphanTasks, color: '#f59e0b' },
                { label: 'Jobs w/ Issues', value: stats.jobsWithIssues, color: '#f97316' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="p-3 rounded-xl text-center"
                  style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.12)' }}
                >
                  <p className="text-2xl font-bold" style={{ color: stat.color }}>
                    {stat.value}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: '#6b7280' }}>
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} style={{ color: '#8a8078' }} />
            {(['all', 'misplaced', 'orphan'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="text-xs px-3 py-1.5 rounded-full transition-all"
                style={{
                  background: filter === f ? 'rgba(201,168,76,0.2)' : 'rgba(255,255,255,0.03)',
                  color: filter === f ? '#c88c00' : '#8a8078',
                  border: filter === f ? '1px solid rgba(201,168,76,0.3)' : '1px solid rgba(200,140,0,0.1)',
                }}
              >
                {f === 'all' ? 'All Issues' : f === 'misplaced' ? 'Misplaced Only' : 'Orphans Only'}
              </button>
            ))}
            <span className="w-px h-4" style={{ background: 'rgba(200,140,0,0.12)' }} />
            {(['all', 'high', 'medium'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setConfidenceFilter(c)}
                className="text-xs px-3 py-1.5 rounded-full transition-all"
                style={{
                  background: confidenceFilter === c ? 'rgba(201,168,76,0.2)' : 'rgba(255,255,255,0.03)',
                  color: confidenceFilter === c ? '#c88c00' : '#8a8078',
                  border: confidenceFilter === c ? '1px solid rgba(201,168,76,0.3)' : '1px solid rgba(200,140,0,0.1)',
                }}
              >
                {c === 'all' ? 'All Confidence' : c === 'high' ? 'High Confidence' : 'Medium Confidence'}
              </button>
            ))}
          </div>

          {/* All clear state */}
          {filtered.length === 0 && (
            <div className="p-8 rounded-xl text-center" style={{ background: '#f8f6f3' }}>
              <CheckCircle2 size={32} style={{ color: '#22c55e', margin: '0 auto 12px' }} />
              <p className="text-sm font-medium" style={{ color: '#22c55e' }}>
                {issues.length === 0 ? 'All schedules look good!' : 'No issues match the current filter.'}
              </p>
              <p className="text-xs mt-1" style={{ color: '#8a8078' }}>
                {issues.length === 0
                  ? `Scanned ${stats?.totalTasks || 0} tasks across ${stats?.totalJobs || 0} projects.`
                  : `${issues.length} total issues — adjust filters to see them.`
                }
              </p>
            </div>
          )}

          {/* Issue list grouped by job */}
          <div className="space-y-3">
            {jobOrder.map(([jobId, jobIssues]) => {
              const first = jobIssues[0];
              return (
                <JobSection
                  key={jobId}
                  jobId={jobId}
                  jobName={first.jobName}
                  jobNumber={first.jobNumber}
                  customStatus={first.customStatus}
                  issues={jobIssues}
                  addToast={addToast}
                  onFixed={loadAudit}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

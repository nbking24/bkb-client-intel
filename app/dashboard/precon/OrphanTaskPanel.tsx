'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Link2Off,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
  Check,
  Loader2,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react';

// ================================================================
// Types
// ================================================================

interface OrphanTask {
  taskId: string;
  taskName: string;
  jobId: string;
  jobName: string;
  currentPhase: string | null;
  suggestedPhase: number;
  suggestedPhaseName: string;
  confidence: number;
  reason: string;
}

interface AuditJob {
  jobId: string;
  jobName: string;
  orphans: OrphanTask[];
  misplaced: OrphanTask[];
  totalTasks: number;
  phaseCount: number;
}

interface AuditResult {
  jobs: AuditJob[];
  totalOrphans: number;
  totalMisplaced: number;
  scannedJobs: number;
  timestamp: string;
}

// ================================================================
// OrphanTaskPanel
// ================================================================

export default function OrphanTaskPanel() {
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [reassigning, setReassigning] = useState<Set<string>>(new Set());
  const [reassigned, setReassigned] = useState<Set<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard/schedule?audit=true');
      if (!res.ok) throw new Error('Failed to run audit');
      const data = await res.json();
      setAudit(data);
      const jobsWithIssues = new Set<string>(
        (data.jobs || [])
          .filter((j: AuditJob) => j.orphans.length > 0 || j.misplaced.length > 0)
          .map((j: AuditJob) => j.jobId)
      );
      setExpandedJobs(jobsWithIssues);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runAudit();
  }, [runAudit]);

  const handleReassign = async (task: OrphanTask) => {
    setReassigning(prev => new Set(prev).add(task.taskId));
    try {
      const res = await fetch('/api/dashboard/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'moveTask',
          taskId: task.taskId,
          jobId: task.jobId,
          targetPhase: task.suggestedPhase,
        }),
      });
      if (!res.ok) throw new Error('Move failed');
      setReassigned(prev => new Set(prev).add(task.taskId));
    } catch {
      setError(`Failed to move "${task.taskName}"`);
    } finally {
      setReassigning(prev => {
        const next = new Set(prev);
        next.delete(task.taskId);
        return next;
      });
    }
  };

  const handleDismiss = (taskId: string) => {
    setDismissed(prev => new Set(prev).add(taskId));
  };

  const totalIssues = audit
    ? audit.totalOrphans + audit.totalMisplaced - dismissed.size - reassigned.size
    : 0;

  const activeJobs = (audit?.jobs || []).filter(j => {
    const tasks = [...j.orphans, ...j.misplaced];
    const activeTasks = tasks.filter(
      t => !dismissed.has(t.taskId) && !reassigned.has(t.taskId)
    );
    return showDismissed ? tasks.length > 0 : activeTasks.length > 0;
  }) || [];

  // ================================================================
  // Render
  // ================================================================

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid rgba(200,140,0,0.15)',
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link2Off size={20} color="#f97316" />
          <h3 style={{ margin: 0, color: '#1a1a1a', fontSize: 16, fontWeight: 600 }}>
            Orphan &amp; Misplaced Tasks
          </h3>
          {totalIssues > 0 && (
            <span
              style={{
                background: '#f97316',
                color: '#fff',
                borderRadius: 10,
                padding: '2px 8px',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {totalIssues}
            </span>
          )}
          {totalIssues === 0 && audit && !loading && (
            <span
              style={{
                background: 'rgba(34,197,94,0.15)',
                color: '#22c55e',
                borderRadius: 10,
                padding: '2px 8px',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              All clear
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowDismissed(!showDismissed)}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(200,140,0,0.15)',
              borderRadius: 6,
              padding: '4px 10px',
              color: '#8a8078',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {showDismissed ? <EyeOff size={12} /> : <Eye size={12} />}
            {showDismissed ? 'Hide resolved' : 'Show resolved'}
          </button>
          <button
            onClick={runAudit}
            disabled={loading}
            style={{
              background: 'rgba(201,168,76,0.1)',
              border: '1px solid rgba(201,168,76,0.3)',
              borderRadius: 6,
              padding: '4px 10px',
              color: '#c88c00',
              fontSize: 12,
              cursor: loading ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {loading ? 'Scanning...' : 'Re-scan'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8,
            padding: '8px 12px',
            color: '#ef4444',
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !audit && (
        <div style={{ textAlign: 'center', padding: 24, color: '#8a8078' }}>
          <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
          <p style={{ margin: 0, fontSize: 13 }}>Scanning all active jobs for orphan tasks...</p>
        </div>
      )}

      {/* Summary bar */}
      {audit && !loading && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ background: '#0d0d0d', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a' }}>{audit.scannedJobs}</div>
            <div style={{ fontSize: 11, color: '#8a8078' }}>Jobs Scanned</div>
          </div>
          <div style={{ background: '#0d0d0d', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#f97316' }}>{audit.totalOrphans}</div>
            <div style={{ fontSize: 11, color: '#8a8078' }}>Orphan Tasks</div>
          </div>
          <div style={{ background: '#0d0d0d', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#eab308' }}>{audit.totalMisplaced}</div>
            <div style={{ fontSize: 11, color: '#8a8078' }}>Misplaced</div>
          </div>
        </div>
      )}

      {/* Jobs list */}
      {activeJobs.map(job => {
        const isExpanded = expandedJobs.has(job.jobId);
        const allTasks = [...job.orphans, ...job.misplaced];
        const visibleTasks = showDismissed
          ? allTasks
          : allTasks.filter(t => !dismissed.has(t.taskId) && !reassigned.has(t.taskId));

        return (
          <div
            key={job.jobId}
            style={{
              background: '#0d0d0d',
              border: '1px solid rgba(200,140,0,0.1)',
              borderRadius: 8,
              marginBottom: 8,
              overflow: 'hidden',
            }}
          >
            {/* Job header */}
            <button
              onClick={() => {
                setExpandedJobs(prev => {
                  const next = new Set(prev);
                  if (next.has(job.jobId)) next.delete(job.jobId);
                  else next.add(job.jobId);
                  return next;
                });
              }}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                color: '#1a1a1a',
              }}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span style={{ fontWeight: 600, fontSize: 13 }}>{job.jobName}</span>
              <span style={{ fontSize: 11, color: '#8a8078', marginLeft: 'auto' }}>
                {visibleTasks.length} task{visibleTasks.length !== 1 ? 's' : ''}
              </span>
            </button>

            {/* Tasks */}
            {isExpanded && (
              <div style={{ padding: '0 14px 10px' }}>
                {visibleTasks.map(task => {
                  const isOrphan = job.orphans.some(o => o.taskId === task.taskId);
                  const isDone = reassigned.has(task.taskId);
                  const isMoving = reassigning.has(task.taskId);
                  const isDismissedTask = dismissed.has(task.taskId);

                  return (
                    <div
                      key={task.taskId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 6,
                        marginBottom: 4,
                        background: isDone
                          ? 'rgba(34,197,94,0.06)'
                          : isDismissedTask
                          ? 'rgba(255,255,255,0.02)'
                          : 'rgba(255,255,255,0.03)',
                        opacity: isDone || isDismissedTask ? 0.5 : 1,
                      }}
                    >
                      {isOrphan ? (
                        <Link2Off size={14} color="#f97316" />
                      ) : (
                        <ArrowRightLeft size={14} color="#eab308" />
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            color: '#1a1a1a',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {task.taskName}
                        </div>
                        <div style={{ fontSize: 11, color: '#8a8078' }}>
                          {isOrphan ? 'No phase' : `In: ${task.currentPhase}`}
                          {' \u2192 '}
                          <span style={{ color: '#c88c00' }}>
                            Phase {task.suggestedPhase}: {task.suggestedPhaseName}
                          </span>
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              padding: '1px 5px',
                              borderRadius: 4,
                              background:
                                task.confidence >= 0.8
                                  ? 'rgba(34,197,94,0.15)'
                                  : task.confidence >= 0.5
                                  ? 'rgba(234,179,8,0.15)'
                                  : 'rgba(239,68,68,0.15)',
                              color:
                                task.confidence >= 0.8
                                  ? '#22c55e'
                                  : task.confidence >= 0.5
                                  ? '#eab308'
                                  : '#ef4444',
                            }}
                          >
                            {Math.round(task.confidence * 100)}%
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      {!isDone && !isDismissedTask && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            onClick={() => handleReassign(task)}
                            disabled={isMoving}
                            title="Move to suggested phase"
                            style={{
                              background: 'rgba(201,168,76,0.15)',
                              border: '1px solid rgba(201,168,76,0.3)',
                              borderRadius: 4,
                              padding: '3px 8px',
                              color: '#c88c00',
                              fontSize: 11,
                              cursor: isMoving ? 'wait' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            {isMoving ? (
                              <Loader2 size={10} className="animate-spin" />
                            ) : (
                              <ArrowRightLeft size={10} />
                            )}
                            Move
                          </button>
                          <button
                            onClick={() => handleDismiss(task.taskId)}
                            title="Dismiss"
                            style={{
                              background: 'rgba(255,255,255,0.05)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: 4,
                              padding: '3px 8px',
                              color: '#8a8078',
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                      {isDone && <Check size={14} color="#22c55e" />}
                    </div>
                  );
                })}

                {visibleTasks.length === 0 && (
                  <div style={{ fontSize: 12, color: '#8a8078', padding: '8px 0', textAlign: 'center' }}>
                    All tasks resolved
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {audit && !loading && activeJobs.length === 0 && (
        <div style={{ textAlign: 'center', padding: 16, color: '#8a8078', fontSize: 13 }}>
          <Check size={20} color="#22c55e" style={{ margin: '0 auto 8px' }} />
          <p style={{ margin: 0 }}>All tasks are properly categorized across {audit.scannedJobs} active jobs.</p>
          {audit.timestamp && (
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#6a6058' }}>
              Last scan: {new Date(audit.timestamp).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

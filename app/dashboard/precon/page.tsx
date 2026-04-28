'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import OrphanTaskPanel from './OrphanTaskPanel';
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  MessageSquare,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Zap,
  Users,
  BarChart3,
  Wrench,
  EyeOff,
  Check,
  Search,
  X,
  Mail,
  Copy,
  FileText,
  Shield,
} from 'lucide-react';

// ============================================================
// Types — matches AgentReport from the API route
// ============================================================
interface AgentRecommendation {
  action: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  actionType: 'createTask' | 'draftMessage' | 'standardizeSchedule' | 'other';
}

interface AgentProject {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  category?: 'In-Design' | 'Ready';
  status: 'on_track' | 'at_risk' | 'stalled' | 'blocked' | 'complete';
  currentPhase: string | null;
  nextStep: string;
  nextStepAssignee: string;
  lastClientContact: string | null;
  daysSinceContact: number | null;
  nextMeeting: string | null;
  totalProgress: number;
  alerts: string[];
  recommendations: AgentRecommendation[];
  suggestedEmail?: { subject: string; body: string } | null;
  weeklyUpdateEmail?: { subject: string; body: string } | null;
}

interface AgentReport {
  generatedAt: string;
  summary: string;
  projectCount: number;
  alertCount: number;
  projects: AgentProject[];
  topPriorities: string[];
  _fromCache?: boolean;
}

// ============================================================
// Status helpers
// ============================================================
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  on_track: { label: 'On Track', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: CheckCircle2 },
  at_risk: { label: 'At Risk', color: '#eab308', bg: 'rgba(234,179,8,0.12)', icon: AlertTriangle },
  stalled: { label: 'Stalled', color: '#f97316', bg: 'rgba(249,115,22,0.12)', icon: Clock },
  blocked: { label: 'Blocked', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: XCircle },
  complete: { label: 'Complete', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: CheckCircle2 },
};

const PRIORITY_COLORS: Record<string, { color: string; bg: string }> = {
  high: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  medium: { color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
  low: { color: '#8a8078', bg: 'rgba(138,128,120,0.12)' },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatTimestamp(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// ============================================================
// Summary Cards
// ============================================================
function SummaryCards({ report }: { report: AgentReport }) {
  const onTrack = (report.projects || []).filter(p => p.status === 'on_track').length;
  const atRisk = (report.projects || []).filter(p => p.status === 'at_risk').length;
  const stalled = (report.projects || []).filter(p => p.status === 'stalled' || p.status === 'blocked').length;

  const cards = [
    { label: 'Projects', value: report.projectCount, color: '#c88c00', icon: BarChart3 },
    { label: 'On Track', value: onTrack, color: '#22c55e', icon: CheckCircle2 },
    { label: 'At Risk', value: atRisk, color: '#eab308', icon: AlertTriangle },
    { label: 'Stalled', value: stalled, color: '#f97316', icon: Clock },
    { label: 'Alerts', value: report.alertCount, color: '#ef4444', icon: Zap },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.label}
            className="rounded-lg p-3"
            style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon size={14} style={{ color: c.color }} />
              <span className="text-xs" style={{ color: '#8a8078' }}>{c.label}</span>
            </div>
            <div className="text-2xl font-bold" style={{ color: c.color }}>
              {c.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Top Priorities
// ============================================================
function TopPriorities({ priorities }: { priorities: string[] }) {
  if (!priorities || !priorities.length) return null;
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
    >
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#c88c00' }}>
        <Zap size={14} />
        Agent Top Priorities
      </h3>
      <div className="space-y-2">
        {priorities.map((p, i) => (
          <div key={i} className="flex gap-3 text-sm">
            <span
              className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: 'rgba(201,168,76,0.2)', color: '#c88c00' }}
            >
              {i + 1}
            </span>
            <span style={{ color: '#3a3530' }}>{p}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Project Card
// ============================================================
function EmailDraftSection({
  title,
  icon: Icon,
  iconColor,
  email,
  onCopy,
}: {
  title: string;
  icon: any;
  iconColor: string;
  email: { subject: string; body: string };
  onCopy: () => void;
}) {
  const [showBody, setShowBody] = useState(false);

  return (
    <div
      className="rounded-md p-2.5"
      style={{
        background: '#f8f6f3',
        border: `1px solid ${iconColor}30`,
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Icon size={12} style={{ color: iconColor }} />
          <span className="text-[10px] font-semibold uppercase" style={{ color: iconColor }}>
            {title}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium hover:opacity-80 transition-opacity"
          style={{
            background: `${iconColor}15`,
            color: iconColor,
            border: `1px solid ${iconColor}30`,
          }}
        >
          <Copy size={10} />
          Copy Email
        </button>
      </div>
      <div className="text-xs mb-1" style={{ color: '#2a2520' }}>
        <span style={{ color: '#5a5550' }}>Subject: </span>
        {email.subject}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowBody(!showBody);
        }}
        className="text-[10px] hover:opacity-80 transition-opacity"
        style={{ color: '#5a5550' }}
      >
        {showBody ? '▾ Hide body' : '▸ Show body'}
      </button>
      {showBody && (
        <div
          className="mt-1.5 p-2 rounded text-xs whitespace-pre-wrap leading-relaxed"
          style={{
            background: '#ffffff',
            color: '#2a2520',
            border: '1px solid rgba(200,140,0,0.12)',
          }}
        >
          {email.body}
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  onDismissRec,
  onCompleteRec,
  onCopyEmail,
}: {
  project: AgentProject;
  onDismissRec: (jobId: string, rec: AgentRecommendation) => void;
  onCompleteRec: (jobId: string, rec: AgentRecommendation) => void;
  onCopyEmail: (subject: string, body: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[project.status] || STATUS_CONFIG.stalled;
  const StatusIcon = config.icon;
  const contactDanger = project.daysSinceContact !== null && project.daysSinceContact > 14;

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: '#ffffff', border: `1px solid ${config.color}30` }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-[#f8f6f3] transition-colors"
      >
        <div className="flex-shrink-0 mt-0.5">
          {expanded ? (
            <ChevronDown size={16} style={{ color: '#8a8078' }} />
          ) : (
            <ChevronRight size={16} style={{ color: '#8a8078' }} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/dashboard/precon/${project.jobId}`}
              className="font-semibold hover:underline"
              style={{ color: '#1a1a1a' }}
              onClick={(e) => e.stopPropagation()}
            >
              {project.jobName}
            </Link>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
              style={{ background: config.bg, color: config.color }}
            >
              <StatusIcon size={10} />
              {config.label}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs" style={{ color: '#8a8078' }}>
            <span>#{project.jobNumber} · {project.clientName}</span>
            {project.currentPhase && <span>Phase: {project.currentPhase}</span>}
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs">
            <span className="flex items-center gap-1" style={{ color: contactDanger ? '#ef4444' : '#8a8078' }}>
              <MessageSquare size={11} />
              {project.daysSinceContact !== null ? `${project.daysSinceContact}d ago` : 'No record'}
            </span>
            <span className="flex items-center gap-1" style={{ color: '#8a8078' }}>
              <CalendarDays size={11} />
              {project.nextMeeting || 'None scheduled'}
            </span>
            <span className="flex items-center gap-1" style={{ color: '#c88c00' }}>
              <Users size={11} />
              {project.nextStepAssignee}
            </span>
          </div>
        </div>

        <div className="flex-shrink-0 text-center">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ border: `2px solid ${config.color}`, color: config.color }}
          >
            {Math.round(project.totalProgress * (project.totalProgress <= 1 ? 100 : 1))}%
          </div>
        </div>
      </button>

      <div
        className="px-4 py-2 text-sm flex items-start gap-2"
        style={{
          background: 'rgba(201,168,76,0.06)',
          borderTop: '1px solid rgba(200,140,0,0.08)',
        }}
      >
        <span className="text-xs font-semibold flex-shrink-0 mt-0.5" style={{ color: '#c88c00' }}>
          NEXT →
        </span>
        <span style={{ color: '#2a2520' }}>{project.nextStep}</span>
      </div>

      {expanded && (
        <div className="px-4 py-3 space-y-3" style={{ borderTop: '1px solid rgba(200,140,0,0.08)' }}>
          {project.alerts.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold mb-1.5" style={{ color: '#ef4444' }}>
                Alerts ({project.alerts.length})
              </h4>
              <div className="space-y-1">
                {project.alerts.map((a, i) => (
                  <div key={i} className="text-xs flex items-start gap-1.5" style={{ color: '#2a2520' }}>
                    <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
                    {a}
                  </div>
                ))}
              </div>
            </div>
          )}
          {project.recommendations.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold mb-1.5" style={{ color: '#c88c00' }}>
                Agent Recommendations
              </h4>
              <div className="space-y-2">
                {project.recommendations.map((rec, i) => {
                  const pConfig = PRIORITY_COLORS[rec.priority] || PRIORITY_COLORS.low;
                  return (
                    <div
                      key={i}
                      className="rounded-md p-2.5"
                      style={{
                        background: '#f8f6f3',
                        border: '1px solid rgba(200,140,0,0.15)',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase"
                          style={{ background: pConfig.bg, color: pConfig.color }}
                        >
                          {rec.priority}
                        </span>
                        <span className="text-xs font-semibold" style={{ color: '#1a1a1a' }}>
                          {rec.action}
                        </span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded ml-auto"
                          style={{ background: 'rgba(201,168,76,0.1)', color: '#c88c00' }}
                        >
                          {rec.actionType}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: '#3a3530' }}>
                        {rec.description}
                      </p>
                      {/* Ignore / Done buttons */}
                      <div className="flex items-center gap-2 mt-2 pt-1.5" style={{ borderTop: '1px solid rgba(200,140,0,0.06)' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onCompleteRec(project.jobId, rec);
                          }}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium hover:opacity-80 transition-opacity"
                          style={{
                            background: 'rgba(34,197,94,0.1)',
                            color: '#22c55e',
                            border: '1px solid rgba(34,197,94,0.2)',
                          }}
                          title="Mark as done — agent will remember this was completed"
                        >
                          <Check size={10} />
                          Done
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDismissRec(project.jobId, rec);
                          }}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium hover:opacity-80 transition-opacity"
                          style={{
                            background: 'rgba(138,128,120,0.1)',
                            color: '#8a8078',
                            border: '1px solid rgba(138,128,120,0.2)',
                          }}
                          title="Ignore — hide this recommendation"
                        >
                          <EyeOff size={10} />
                          Ignore
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stale Outreach Email */}
          {project.suggestedEmail && (
            <EmailDraftSection
              title="Suggested Outreach Email"
              icon={Mail}
              iconColor="#eab308"
              email={project.suggestedEmail}
              onCopy={() =>
                onCopyEmail(project.suggestedEmail!.subject, project.suggestedEmail!.body)
              }
            />
          )}

          {/* Weekly Update Email */}
          {project.weeklyUpdateEmail && (
            <EmailDraftSection
              title="Weekly Client Update"
              icon={FileText}
              iconColor="#c88c00"
              email={project.weeklyUpdateEmail}
              onCopy={() =>
                onCopyEmail(project.weeklyUpdateEmail!.subject, project.weeklyUpdateEmail!.body)
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Schedule Compliance Panel
// ============================================================
function ScheduleCompliancePanel({
  report,
  loading,
  onRefresh,
  onFixJob,
  showToast,
}: {
  report: any;
  loading: boolean;
  onRefresh: () => void;
  onFixJob: (jobId: string) => void;
  showToast: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (loading) {
    return (
      <div
        className="rounded-lg p-4 flex items-center gap-3"
        style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
      >
        <Loader2 size={16} className="animate-spin" style={{ color: '#c88c00' }} />
        <span className="text-sm" style={{ color: '#8a8078' }}>Loading schedule compliance...</span>
      </div>
    );
  }

  if (!report) return null;

  const nonCompliantJobs = report.jobs || [];
  const compliantCount = report.compliantJobs || 0;
  const totalScanned = report.totalJobs || 0;
  const allCompliant = nonCompliantJobs.length === 0;

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-[#f8f6f3] transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown size={16} style={{ color: '#8a8078' }} />
          ) : (
            <ChevronRight size={16} style={{ color: '#8a8078' }} />
          )}
          <Shield size={14} style={{ color: '#c88c00' }} />
          <h3 className="text-sm font-semibold" style={{ color: '#c88c00' }}>
            Schedule Compliance
          </h3>
          {allCompliant && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
              All Compliant
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-3" style={{ borderTop: '1px solid rgba(200,140,0,0.08)' }}>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-2">
            <div
              className="rounded p-2 text-center"
              style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.15)' }}
            >
              <div className="text-xs" style={{ color: '#5a5550' }}>Scanned</div>
              <div className="text-lg font-bold" style={{ color: '#c88c00' }}>
                {totalScanned}
              </div>
            </div>
            <div
              className="rounded p-2 text-center"
              style={{ background: '#f8f6f3', border: '1px solid rgba(34,197,94,0.25)' }}
            >
              <div className="text-xs" style={{ color: '#5a5550' }}>Compliant</div>
              <div className="text-lg font-bold" style={{ color: '#22c55e' }}>
                {compliantCount}
              </div>
            </div>
            <div
              className="rounded p-2 text-center"
              style={{ background: '#f8f6f3', border: '1px solid rgba(239,68,68,0.25)' }}
            >
              <div className="text-xs" style={{ color: '#5a5550' }}>Non-Compliant</div>
              <div className="text-lg font-bold" style={{ color: '#ef4444' }}>
                {nonCompliantJobs.length}
              </div>
            </div>
          </div>

          {/* Compliant message */}
          {allCompliant && (
            <div
              className="p-3 rounded text-center"
              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}
            >
              <p className="text-sm" style={{ color: '#22c55e' }}>
                ✓ All projects have compliant schedules
              </p>
            </div>
          )}

          {/* Non-compliant jobs list */}
          {nonCompliantJobs.length > 0 && (
            <div className="space-y-2">
              {nonCompliantJobs.map((job: any) => (
                <div
                  key={job.jobId}
                  className="p-2.5 rounded"
                  style={{ background: '#f8f6f3', border: '1px solid rgba(239,68,68,0.2)' }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex-1">
                      <p className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
                        {job.jobName}
                      </p>
                      <p className="text-xs" style={{ color: '#5a5550' }}>
                        {job.jobNumber} · {job.clientName}
                      </p>
                    </div>
                    <button
                      onClick={() => onFixJob(job.jobId)}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium hover:opacity-80 transition-opacity flex-shrink-0"
                      style={{
                        background: 'rgba(251,146,60,0.15)',
                        color: '#fb923c',
                        border: '1px solid rgba(251,146,60,0.3)',
                      }}
                    >
                      <Wrench size={10} />
                      Fix
                    </button>
                  </div>
                  <div className="text-xs space-y-1" style={{ color: '#3a3530' }}>
                    {job.missingPhases?.length > 0 && (
                      <div>
                        <span style={{ color: '#ef4444' }}>Missing Phases ({job.missingPhases.length}): </span>
                        {job.missingPhases.map((p: any) => p.name).join(', ')}
                      </div>
                    )}
                    {job.orphanTasks?.length > 0 && (
                      <div>
                        <span style={{ color: '#ef4444' }}>Orphan Tasks: </span>
                        {job.orphanTasks.length}
                      </div>
                    )}
                    {job.misplacedTasks?.length > 0 && (
                      <div>
                        <span style={{ color: '#ef4444' }}>Misplaced Tasks: </span>
                        {job.misplacedTasks.length}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Re-scan button */}
          <button
            onClick={onRefresh}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-medium hover:opacity-80 transition-opacity"
            style={{
              background: 'rgba(201,168,76,0.1)',
              color: '#c88c00',
              border: '1px solid rgba(201,168,76,0.2)',
            }}
          >
            <RefreshCw size={12} />
            Re-scan
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================
export default function PreConDashboard() {
  const [report, setReport] = useState<AgentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [inDesignOpen, setInDesignOpen] = useState(true);
  const [readyOpen, setReadyOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [bulkRunning, setBulkRunning] = useState(false);
  const [complianceReport, setComplianceReport] = useState<any>(null);
  const [complianceLoading, setComplianceLoading] = useState(true);

  // Load cached report on mount (instant)
  async function loadCachedReport() {
    try {
      const res = await fetch('/api/agent/design-manager?cached=true');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setReport(json);
      setError('');
    } catch (err: any) {
      setError(err.message);
    }
  }

  // Run fresh agent analysis (slow — triggers Claude API)
  async function runFreshAnalysis() {
    try {
      const res = await fetch('/api/agent/design-manager');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setReport(json);
      setError('');
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadCachedReport().finally(() => setLoading(false));
    loadComplianceReport();
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await runFreshAnalysis();
    setRefreshing(false);
  }

  // Show a toast message briefly
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // Dismiss (Ignore) a recommendation
  async function handleDismissRec(jobId: string, rec: AgentRecommendation) {
    try {
      const res = await fetch('/api/agent/design-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dismissRecommendation',
          jobId,
          recAction: rec.action,
          recActionType: rec.actionType,
          recDescription: rec.description,
        }),
      });
      const json = await res.json();
      if (json.success) {
        // Remove the recommendation from local state immediately
        setReport((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            projects: prev.projects.map((p) =>
              p.jobId === jobId
                ? {
                    ...p,
                    recommendations: p.recommendations.filter(
                      (r) => !(r.action === rec.action && r.actionType === rec.actionType)
                    ),
                  }
                : p
            ),
          };
        });
        showToast(`Ignored: "${rec.action}"`);
      } else {
        showToast(`Failed to ignore: ${json.message || json.error}`);
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  }

  // Complete (Done) a recommendation
  async function handleCompleteRec(jobId: string, rec: AgentRecommendation) {
    try {
      const res = await fetch('/api/agent/design-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'completeRecommendation',
          jobId,
          recAction: rec.action,
          recActionType: rec.actionType,
          recDescription: rec.description,
        }),
      });
      const json = await res.json();
      if (json.success) {
        // Remove the recommendation from local state immediately
        setReport((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            projects: prev.projects.map((p) =>
              p.jobId === jobId
                ? {
                    ...p,
                    recommendations: p.recommendations.filter(
                      (r) => !(r.action === rec.action && r.actionType === rec.actionType)
                    ),
                  }
                : p
            ),
          };
        });
        showToast(`Completed: "${rec.action}"`);
      } else {
        showToast(`Failed to complete: ${json.message || json.error}`);
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  }

  // Copy email to clipboard
  function handleCopyEmail(subject: string, body: string) {
    const text = `Subject: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(text).then(() => {
      showToast('Email copied to clipboard');
    }).catch(() => {
      showToast('Failed to copy email');
    });
  }

  // Load compliance report
  async function loadComplianceReport() {
    try {
      const res = await fetch('/api/dashboard/schedule-compliance');
      const json = await res.json();
      if (!json.error) setComplianceReport(json);
    } catch {}
    setComplianceLoading(false);
  }

  // Handle bulk standardize
  async function handleBulkStandardize() {
    setBulkRunning(true);
    try {
      const res = await fetch('/api/dashboard/schedule-compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulkStandardize' }),
      });
      const json = await res.json();
      if (json.totals) {
        const t = json.totals;
        showToast(`Standardized ${json.totalJobs} jobs: ${t.phasesCreated} phases created, ${t.orphansMoved + t.misplacedMoved} tasks moved`);
      }
      // Refresh compliance report after bulk standardize
      loadComplianceReport();
    } catch (err: any) {
      showToast(`Bulk standardize failed: ${err.message}`);
    }
    setBulkRunning(false);
  }

  // Handle fix single job
  async function handleFixJob(jobId: string) {
    try {
      const res = await fetch('/api/dashboard/schedule-compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'autoFix', jobId }),
      });
      const json = await res.json();
      if (json.totals) {
        const t = json.totals;
        const jobName = json.jobResults?.[0]?.jobName || 'Job';
        showToast(`Fixed ${jobName}: ${t.phasesCreated} phases created, ${t.orphansMoved + t.misplacedMoved} tasks moved`);
        loadComplianceReport();
      } else {
        showToast(`Fix failed: ${json.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      showToast(`Error fixing job: ${err.message}`);
    }
  }

  // Filter projects by search query (matches job name, job number, or client name)
  const normalizedQuery = searchQuery.trim().toLowerCase();

  function matchesSearch(project: AgentProject): boolean {
    if (!normalizedQuery) return true;
    return (
      project.jobName.toLowerCase().includes(normalizedQuery) ||
      project.jobNumber.toLowerCase().includes(normalizedQuery) ||
      project.clientName.toLowerCase().includes(normalizedQuery)
    );
  }

  // Group projects by category (In-Design vs Ready), filtered by search
  const allInDesign = report?.projects?.filter(p => p.category !== 'Ready') || [];
  const allReady = report?.projects?.filter(p => p.category === 'Ready') || [];
  const inDesignProjects = allInDesign.filter(matchesSearch);
  const readyProjects = allReady.filter(matchesSearch);
  const totalMatches = inDesignProjects.length + readyProjects.length;
  const totalProjects = allInDesign.length + allReady.length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: 'Georgia, serif', color: '#c88c00' }}
          >
            Design Manager Agent
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
            AI-powered oversight of all design-phase projects
            {report && (
              <span>
                {' '}· Last run: {formatTimestamp(report.generatedAt)}
                {report._fromCache && (
                  <span style={{ color: '#c88c00' }}> (cached)</span>
                )}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/dashboard/precon/setup"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
            style={{
              background: 'rgba(201,168,76,0.08)',
              color: '#c88c00',
              border: '1px solid rgba(201,168,76,0.2)',
            }}
          >
            <Wrench size={14} />
            Standardize Schedule
          </Link>
          <button
            onClick={handleBulkStandardize}
            disabled={bulkRunning}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{
              background: 'rgba(34,197,94,0.15)',
              color: '#22c55e',
              border: '1px solid rgba(34,197,94,0.3)',
            }}
          >
            {bulkRunning ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Wrench size={14} />
            )}
            {bulkRunning ? 'Standardizing...' : 'Standardize All'}
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{
              background: 'rgba(201,168,76,0.15)',
              color: '#c88c00',
              border: '1px solid rgba(201,168,76,0.3)',
            }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Running Agent...' : 'Run Agent Now'}
          </button>
        </div>
      </div>

          <OrphanTaskPanel />
          <ScheduleCompliancePanel
            report={complianceReport}
            loading={complianceLoading}
            onRefresh={loadComplianceReport}
            onFixJob={handleFixJob}
            showToast={showToast}
          />
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={28} className="animate-spin" style={{ color: '#c88c00' }} />
          <p className="text-sm" style={{ color: '#8a8078' }}>Loading dashboard...</p>
        </div>
      ) : error && !report ? (
        <div className="p-6 rounded-xl text-center" style={{ background: '#f8f6f3' }}>
          <p className="text-sm" style={{ color: '#ef4444' }}>Agent error: {error}</p>
          <p className="text-xs mt-1" style={{ color: '#8a8078' }}>
            No cached data available. Click &quot;Run Agent Now&quot; to generate a fresh report.
          </p>
          <button
            onClick={handleRefresh}
            className="text-xs mt-2 underline"
            style={{ color: '#c88c00' }}
          >
            Run Agent Now
          </button>
        </div>
      ) : report ? (
        <div className="space-y-4">
          <SummaryCards report={report} />

          <div
            className="rounded-lg p-4"
            style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
          >
            <p className="text-sm leading-relaxed" style={{ color: '#2a2520' }}>
              {report.summary}
            </p>
          </div>

          <TopPriorities priorities={report.topPriorities} />

          {/* ── Search Box ── */}
          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: '#8a8078' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects by name, number, or client..."
              className="w-full rounded-lg pl-9 pr-9 py-2.5 text-sm outline-none placeholder:text-[#5a5550]"
              style={{
                background: '#ffffff',
                border: '1px solid rgba(200,140,0,0.15)',
                color: '#1a1a1a',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'rgba(201,168,76,0.4)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'rgba(200,140,0,0.15)';
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-80"
                style={{ color: '#8a8078' }}
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {normalizedQuery && (
            <p className="text-xs" style={{ color: '#8a8078' }}>
              Showing {totalMatches} of {totalProjects} project{totalProjects !== 1 ? 's' : ''}
              {totalMatches === 0 && (
                <span style={{ color: '#ef4444' }}> — no matches found</span>
              )}
            </p>
          )}

          <div className="space-y-6">
            {/* In-Design Projects */}
            <div>
              <button
                onClick={() => setInDesignOpen(!inDesignOpen)}
                className="w-full text-left text-sm font-semibold mb-3 flex items-center gap-2 hover:opacity-80 transition-opacity"
                style={{ color: '#c88c00' }}
              >
                {inDesignOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Clock size={14} />
                In-Design ({inDesignProjects.length})
              </button>
              {inDesignOpen && (
                <div className="space-y-2">
                  {inDesignProjects.map((project) => (
                    <ProjectCard
                      key={project.jobId}
                      project={project}
                      onDismissRec={handleDismissRec}
                      onCompleteRec={handleCompleteRec}
                      onCopyEmail={handleCopyEmail}
                    />
                  ))}
                  {inDesignProjects.length === 0 && (
                    <p className="text-xs py-2" style={{ color: '#8a8078' }}>
                      {normalizedQuery ? 'No matching projects in design phase' : 'No projects in design phase'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Ready Projects */}
            <div>
              <button
                onClick={() => setReadyOpen(!readyOpen)}
                className="w-full text-left text-sm font-semibold mb-3 flex items-center gap-2 hover:opacity-80 transition-opacity"
                style={{ color: '#22c55e' }}
              >
                {readyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <CheckCircle2 size={14} />
                Ready ({readyProjects.length})
              </button>
              {readyOpen && (
                <div className="space-y-2">
                  {readyProjects.map((project) => (
                    <ProjectCard
                      key={project.jobId}
                      project={project}
                      onDismissRec={handleDismissRec}
                      onCompleteRec={handleCompleteRec}
                      onCopyEmail={handleCopyEmail}
                    />
                  ))}
                  {readyProjects.length === 0 && (
                    <p className="text-xs py-2" style={{ color: '#8a8078' }}>
                      {normalizedQuery ? 'No matching projects ready' : 'No projects ready'}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {refreshing && (
        <div
          className="fixed bottom-4 right-4 rounded-lg px-4 py-3 flex items-center gap-3 shadow-lg"
          style={{
            background: '#ffffff',
            border: '1px solid rgba(201,168,76,0.3)',
            zIndex: 50,
          }}
        >
          <Loader2 size={16} className="animate-spin" style={{ color: '#c88c00' }} />
          <span className="text-sm" style={{ color: '#c88c00' }}>
            Agent is analyzing projects... this may take 30-60 seconds
          </span>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg px-4 py-2.5 shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2"
          style={{
            background: '#f0eeeb',
            border: '1px solid rgba(201,168,76,0.3)',
            zIndex: 60,
          }}
        >
          <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
          <span className="text-sm" style={{ color: '#1a1a1a' }}>{toast}</span>
        </div>
      )}
    </div>
  );
}

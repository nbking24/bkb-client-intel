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
  const onTrack = report.projects.filter(p => p.status === 'on_track').length;
  const atRisk = report.projects.filter(p => p.status === 'at_risk').length;
  const stalled = report.projects.filter(p => p.status === 'stalled' || p.status === 'blocked').length;

  const cards = [
    { label: 'Projects', value: report.projectCount, color: '#C9A84C', icon: BarChart3 },
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
            style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
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
  if (!priorities.length) return null;
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
    >
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#C9A84C' }}>
        <Zap size={14} />
        Agent Top Priorities
      </h3>
      <div className="space-y-2">
        {priorities.map((p, i) => (
          <div key={i} className="flex gap-3 text-sm">
            <span
              className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: 'rgba(201,168,76,0.2)', color: '#C9A84C' }}
            >
              {i + 1}
            </span>
            <span style={{ color: '#d4ccc4' }}>{p}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Project Card
// ============================================================
function ProjectCard({ project }: { project: AgentProject }) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[project.status] || STATUS_CONFIG.stalled;
  const StatusIcon = config.icon;
  const contactDanger = project.daysSinceContact !== null && project.daysSinceContact > 14;

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: '#1a1a1a', border: `1px solid ${config.color}30` }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-[#222] transition-colors"
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
              style={{ color: '#e8e0d8' }}
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
            <span className="flex items-center gap-1" style={{ color: '#C9A84C' }}>
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
          borderTop: '1px solid rgba(205,162,116,0.08)',
        }}
      >
        <span className="text-xs font-semibold flex-shrink-0 mt-0.5" style={{ color: '#C9A84C' }}>
          NEXT →
        </span>
        <span style={{ color: '#d4ccc4' }}>{project.nextStep}</span>
      </div>

      {expanded && (
        <div className="px-4 py-3 space-y-3" style={{ borderTop: '1px solid rgba(205,162,116,0.08)' }}>
          {project.alerts.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold mb-1.5" style={{ color: '#ef4444' }}>
                Alerts ({project.alerts.length})
              </h4>
              <div className="space-y-1">
                {project.alerts.map((a, i) => (
                  <div key={i} className="text-xs flex items-start gap-1.5" style={{ color: '#d4ccc4' }}>
                    <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
                    {a}
                  </div>
                ))}
              </div>
            </div>
          )}
          {project.recommendations.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold mb-1.5" style={{ color: '#C9A84C' }}>
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
                        background: 'rgba(26,26,26,0.8)',
                        border: '1px solid rgba(205,162,116,0.08)',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase"
                          style={{ background: pConfig.bg, color: pConfig.color }}
                        >
                          {rec.priority}
                        </span>
                        <span className="text-xs font-semibold" style={{ color: '#e8e0d8' }}>
                          {rec.action}
                        </span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded ml-auto"
                          style={{ background: 'rgba(201,168,76,0.1)', color: '#C9A84C' }}
                        >
                          {rec.actionType}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: '#8a8078' }}>
                        {rec.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await runFreshAnalysis();
    setRefreshing(false);
  }

  // Group projects by category (In-Design vs Ready), already A-Z sorted from API
  const inDesignProjects = report?.projects?.filter(p => p.category !== 'Ready') || [];
  const readyProjects = report?.projects?.filter(p => p.category === 'Ready') || [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}
          >
            Design Manager Agent
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
            AI-powered oversight of all design-phase projects
            {report && (
              <span>
                {' '}· Last run: {formatTimestamp(report.generatedAt)}
                {report._fromCache && (
                  <span style={{ color: '#C9A84C' }}> (cached)</span>
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
              color: '#C9A84C',
              border: '1px solid rgba(201,168,76,0.2)',
            }}
          >
            <Wrench size={14} />
            Standardize Schedule
          </Link>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{
              background: 'rgba(201,168,76,0.15)',
              color: '#C9A84C',
              border: '1px solid rgba(201,168,76,0.3)',
            }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Running Agent...' : 'Run Agent Now'}
          </button>
        </div>
      </div>

          <OrphanTaskPanel />
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={28} className="animate-spin" style={{ color: '#C9A84C' }} />
          <p className="text-sm" style={{ color: '#8a8078' }}>Loading dashboard...</p>
        </div>
      ) : error && !report ? (
        <div className="p-6 rounded-xl text-center" style={{ background: '#242424' }}>
          <p className="text-sm" style={{ color: '#ef4444' }}>Agent error: {error}</p>
          <p className="text-xs mt-1" style={{ color: '#8a8078' }}>
            No cached data available. Click &quot;Run Agent Now&quot; to generate a fresh report.
          </p>
          <button
            onClick={handleRefresh}
            className="text-xs mt-2 underline"
            style={{ color: '#C9A84C' }}
          >
            Run Agent Now
          </button>
        </div>
      ) : report ? (
        <div className="space-y-4">
          <SummaryCards report={report} />

          <div
            className="rounded-lg p-4"
            style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
          >
            <p className="text-sm leading-relaxed" style={{ color: '#d4ccc4' }}>
              {report.summary}
            </p>
          </div>

          <TopPriorities priorities={report.topPriorities} />

          <div className="space-y-6">
            {/* In-Design Projects */}
            <div>
              <button
                onClick={() => setInDesignOpen(!inDesignOpen)}
                className="w-full text-left text-sm font-semibold mb-3 flex items-center gap-2 hover:opacity-80 transition-opacity"
                style={{ color: '#C9A84C' }}
              >
                {inDesignOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Clock size={14} />
                In-Design ({inDesignProjects.length})
              </button>
              {inDesignOpen && (
                <div className="space-y-2">
                  {inDesignProjects.map((project) => (
                    <ProjectCard key={project.jobId} project={project} />
                  ))}
                  {inDesignProjects.length === 0 && (
                    <p className="text-xs py-2" style={{ color: '#8a8078' }}>No projects in design phase</p>
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
                    <ProjectCard key={project.jobId} project={project} />
                  ))}
                  {readyProjects.length === 0 && (
                    <p className="text-xs py-2" style={{ color: '#8a8078' }}>No projects ready</p>
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
            background: '#1a1a1a',
            border: '1px solid rgba(201,168,76,0.3)',
            zIndex: 50,
          }}
        >
          <Loader2 size={16} className="animate-spin" style={{ color: '#C9A84C' }} />
          <span className="text-sm" style={{ color: '#C9A84C' }}>
            Agent is analyzing projects... this may take 30-60 seconds
          </span>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import {
  AlertTriangle, Clock, CheckCircle2, ArrowRight, Loader2,
  RefreshCw, AlertCircle, Calendar, MessageSquare, Zap,
  DollarSign, ClipboardList, ChevronRight
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import Link from 'next/link';

function getToken() { return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : ''; }

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(d: string | null) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ============================================================
// Types
// ============================================================

interface DashboardAnalysis {
  summary: string;
  urgentItems: Array<{ title: string; description: string; jobName?: string }>;
  upcomingDeadlines: Array<{ title: string; dueDate: string; daysUntilDue: number; jobName?: string }>;
  flaggedMessages: Array<{ preview: string; jobName: string; authorName: string; reason: string }>;
  emailsNeedingReply?: Array<{ from: string; subject: string; snippet: string; reason: string }>;
  actionItems: Array<{ action: string; priority: 'high' | 'medium' | 'low'; jobName?: string }>;
}

interface DashboardData {
  stats: {
    totalTasks: number;
    urgentTasks: number;
    highPriorityTasks: number;
    tasksToday: number;
    recentMessageCount: number;
    activeJobCount: number;
  };
  tasks: Array<{
    id: string; name: string; jobName: string; jobNumber: string;
    endDate: string | null; progress: number; urgency: string; daysUntilDue: number | null;
  }>;
}

interface OverviewResponse {
  analysis: DashboardAnalysis;
  data: DashboardData;
  _cached: boolean;
  _cachedAt?: string;
  _analysisTimeMs?: number;
}

// ============================================================
// Style constants
// ============================================================

const CARD_STYLE = { background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)' };
const URGENCY = {
  urgent: { bg: 'rgba(239,68,68,0.1)', text: '#ef4444', border: 'rgba(239,68,68,0.2)' },
  high: { bg: 'rgba(234,179,8,0.1)', text: '#eab308', border: 'rgba(234,179,8,0.2)' },
  medium: { bg: 'rgba(59,130,246,0.1)', text: '#3b82f6', border: 'rgba(59,130,246,0.2)' },
  low: { bg: 'rgba(34,197,94,0.1)', text: '#22c55e', border: 'rgba(34,197,94,0.2)' },
};

// ============================================================
// Main Dashboard Page
// ============================================================

export default function DashboardOverview() {
  const auth = useAuth();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchOverview(forceRefresh = false) {
    if (!auth.userId) return;
    if (forceRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const param = forceRefresh ? 'refresh=true' : 'cached=true';
      const res = await fetch(`/api/dashboard/overview?userId=${auth.userId}&${param}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Failed to load dashboard');
      const data = await res.json();
      setOverview(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (auth.userId) fetchOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.userId]);

  if (!auth.isAuthenticated || !auth.userId) {
    return <div className="p-8 text-center" style={{ color: '#8a8078' }}>Loading...</div>;
  }

  const analysis = overview?.analysis;
  const stats = overview?.data?.stats;
  const tasks = overview?.data?.tasks || [];

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#e8e0d8' }}>
            {getGreeting()}, {auth.user?.name?.split(' ')[0]}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#8a8078' }}>
            {overview?._cached && overview._cachedAt
              ? `Updated ${timeAgo(overview._cachedAt)}`
              : loading ? 'Loading...' : 'Fresh analysis'}
            {overview?._analysisTimeMs ? ` (${(overview._analysisTimeMs / 1000).toFixed(1)}s)` : ''}
          </p>
        </div>
        <button
          onClick={() => fetchOverview(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ background: 'rgba(205,162,116,0.1)', color: '#CDA274' }}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="px-4 py-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !overview && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin mb-4" style={{ color: '#CDA274' }} />
          <p style={{ color: '#8a8078' }}>Analyzing your dashboard...</p>
        </div>
      )}

      {overview && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={AlertTriangle} label="Urgent" value={stats?.urgentTasks || 0} color="#ef4444" />
            <StatCard icon={AlertCircle} label="High Priority" value={stats?.highPriorityTasks || 0} color="#f97316" />
            <StatCard icon={Calendar} label="Due Today" value={stats?.tasksToday || 0} color="#eab308" />
            <StatCard icon={CheckCircle2} label="Open Tasks" value={stats?.totalTasks || 0} color="#CDA274" />
          </div>

          {/* AI Summary */}
          {analysis?.summary && (
            <div className="px-4 py-3 rounded-lg" style={{ background: 'rgba(205,162,116,0.06)', border: '1px solid rgba(205,162,116,0.12)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Zap size={14} style={{ color: '#CDA274' }} />
                <span className="text-xs font-medium" style={{ color: '#CDA274' }}>AI Briefing</span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: '#e8e0d8' }}>{analysis.summary}</p>
            </div>
          )}

          {/* Two-column layout for insights */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Urgent Items */}
            {(analysis?.urgentItems?.length ?? 0) > 0 && (
              <section className="rounded-lg p-4" style={CARD_STYLE}>
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#ef4444' }}>
                  <AlertTriangle size={14} /> Needs Immediate Attention
                </h2>
                <div className="space-y-2">
                  {analysis!.urgentItems.map((item, i) => (
                    <div key={i} className="px-3 py-2 rounded-lg" style={{ background: URGENCY.urgent.bg, border: `1px solid ${URGENCY.urgent.border}` }}>
                      <p className="text-sm font-medium" style={{ color: '#e8e0d8' }}>{item.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: '#8a8078' }}>{item.description}{item.jobName ? ` — ${item.jobName}` : ''}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Action Items */}
            {(analysis?.actionItems?.length ?? 0) > 0 && (
              <section className="rounded-lg p-4" style={CARD_STYLE}>
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#CDA274' }}>
                  <ClipboardList size={14} /> Action Items
                </h2>
                <div className="space-y-2">
                  {analysis!.actionItems.map((item, i) => {
                    const style = URGENCY[item.priority] || URGENCY.medium;
                    return (
                      <div key={i} className="px-3 py-2 rounded-lg" style={{ background: style.bg, border: `1px solid ${style.border}` }}>
                        <p className="text-sm" style={{ color: '#e8e0d8' }}>{item.action}</p>
                        {item.jobName && <p className="text-xs mt-0.5" style={{ color: '#8a8078' }}>{item.jobName}</p>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Upcoming Deadlines */}
            {(analysis?.upcomingDeadlines?.length ?? 0) > 0 && (
              <section className="rounded-lg p-4" style={CARD_STYLE}>
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#eab308' }}>
                  <Clock size={14} /> Upcoming Deadlines
                </h2>
                <div className="space-y-2">
                  {analysis!.upcomingDeadlines.map((item, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'rgba(234,179,8,0.05)' }}>
                      <div>
                        <p className="text-sm" style={{ color: '#e8e0d8' }}>{item.title}</p>
                        {item.jobName && <p className="text-xs" style={{ color: '#8a8078' }}>{item.jobName}</p>}
                      </div>
                      <span className="text-xs flex-shrink-0 px-2 py-1 rounded" style={{ background: 'rgba(234,179,8,0.1)', color: '#eab308' }}>
                        {item.daysUntilDue === 0 ? 'Today' : item.daysUntilDue === 1 ? 'Tomorrow' : `${item.daysUntilDue}d`}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Flagged Messages */}
            {(analysis?.flaggedMessages?.length ?? 0) > 0 && (
              <section className="rounded-lg p-4" style={CARD_STYLE}>
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#3b82f6' }}>
                  <MessageSquare size={14} /> Messages to Review
                </h2>
                <div className="space-y-2">
                  {analysis!.flaggedMessages.map((msg, i) => (
                    <div key={i} className="px-3 py-2 rounded-lg" style={{ background: 'rgba(59,130,246,0.05)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium" style={{ color: '#3b82f6' }}>{msg.authorName}</span>
                        <span className="text-xs" style={{ color: '#8a8078' }}>on {msg.jobName}</span>
                      </div>
                      <p className="text-xs" style={{ color: '#e8e0d8' }}>{msg.preview}</p>
                      <p className="text-xs mt-1" style={{ color: '#8a8078' }}>{msg.reason}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Task List */}
          <section className="rounded-lg p-4" style={CARD_STYLE}>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#e8e0d8' }}>
              <CheckCircle2 size={14} /> Your Tasks ({tasks.length})
            </h2>
            <div className="space-y-1">
              {tasks.slice(0, 15).map(task => {
                const urgStyle = task.urgency === 'urgent' ? URGENCY.urgent : task.urgency === 'high' ? URGENCY.high : { bg: 'transparent', text: '#8a8078', border: 'transparent' };
                return (
                  <div key={task.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.02]">
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0" style={{ background: urgStyle.bg, color: urgStyle.text }}>
                      {task.urgency === 'urgent' ? 'URG' : task.urgency === 'high' ? 'HIGH' : ''}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: '#e8e0d8' }}>{task.name}</p>
                      <p className="text-xs truncate" style={{ color: '#8a8078' }}>{task.jobName} #{task.jobNumber}</p>
                    </div>
                    <span className="text-xs flex-shrink-0" style={{ color: task.urgency === 'urgent' ? '#ef4444' : '#8a8078' }}>
                      {task.daysUntilDue !== null
                        ? (task.daysUntilDue < 0 ? `${Math.abs(task.daysUntilDue)}d overdue` : task.daysUntilDue === 0 ? 'Today' : `${task.daysUntilDue}d`)
                        : formatDate(task.endDate)}
                    </span>
                  </div>
                );
              })}
              {tasks.length === 0 && !loading && (
                <p className="text-center py-4 text-sm" style={{ color: '#8a8078' }}>No open tasks</p>
              )}
            </div>
          </section>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {auth.permissions?.canViewBills && (
              <QuickAction href="/dashboard/invoicing" icon={DollarSign} label="Invoicing" />
            )}
            <QuickAction href="/dashboard/precon" icon={ClipboardList} label="Pre-Construction" />
            <QuickAction href="/dashboard/ask" icon={MessageSquare} label="Ask Agent" />
            {auth.permissions?.canViewGrid && (
              <QuickAction href="/dashboard/spec-writer" icon={ArrowRight} label="Spec Writer" />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg px-4 py-3" style={CARD_STYLE}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} style={{ color }} />
        <span className="text-xs" style={{ color: '#8a8078' }}>{label}</span>
      </div>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 px-3 py-3 rounded-lg transition-colors hover:bg-white/[0.03]" style={CARD_STYLE}>
      <Icon size={14} style={{ color: '#CDA274' }} />
      <span className="text-sm" style={{ color: '#e8e0d8' }}>{label}</span>
      <ChevronRight size={12} className="ml-auto" style={{ color: '#8a8078' }} />
    </Link>
  );
}

'use client';

import { useState, useEffect } from 'react';
import {
  AlertTriangle, Clock, CheckCircle2, ArrowRight, Loader2,
  RefreshCw, AlertCircle, Calendar, MessageSquare, Zap,
  DollarSign, ClipboardList, ChevronRight, Mail, MapPin
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import Link from 'next/link';

function getToken() { return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : ''; }

function getGreeting(period?: string) {
  if (period === 'morning') return 'Good morning';
  if (period === 'midday') return 'Afternoon check-in';
  if (period === 'evening') return 'Evening prep';
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getSubGreeting(period?: string, tomorrowLabel?: string) {
  if (period === 'morning') return 'Your day ahead';
  if (period === 'midday') return 'What needs attention now';
  if (period === 'evening') return `Preparing for ${tomorrowLabel || 'tomorrow'}`;
  return '';
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

interface TomorrowBriefing {
  headline: string;
  calendarWalkthrough: Array<{ time: string; event: string; prepNote: string }>;
  tasksDue: Array<{ task: string; jobName: string }>;
  prepTonightOrAM: string[];
}

interface SuggestedAction {
  title: string;
  actionType: 'reply-email' | 'complete-task' | 'reschedule-task' | 'follow-up' | 'prep-meeting' | 'review-document';
  context: {
    taskId?: string; taskName?: string; emailSubject?: string;
    recipient?: string; jobName?: string; suggestedDate?: string; suggestedText?: string;
  };
  priority: 'high' | 'medium' | 'low';
}

interface MeetingPrepNote {
  eventSummary: string;
  time: string;
  prepNote: string;
  relatedJobName?: string;
}

interface DashboardAnalysis {
  summary: string;
  urgentItems: Array<{ title: string; description: string; jobName?: string }>;
  upcomingDeadlines: Array<{ title: string; dueDate: string; daysUntilDue: number; jobName?: string }>;
  flaggedMessages: Array<{ preview: string; jobName: string; authorName: string; reason: string }>;
  emailsNeedingReply?: Array<{ from: string; subject: string; snippet: string; reason: string }>;
  actionItems: Array<{ action: string; priority: 'high' | 'medium' | 'low'; jobName?: string }>;
  suggestedActions?: SuggestedAction[];
  meetingPrepNotes?: MeetingPrepNote[];
  tomorrowBriefing?: TomorrowBriefing;
}

interface DashboardData {
  timeContext?: { period: string; tomorrowLabel: string; tomorrowDate: string };
  stats: {
    totalTasks: number;
    urgentTasks: number;
    highPriorityTasks: number;
    tasksToday: number;
    tasksTomorrow: number;
    recentMessageCount: number;
    activeJobCount: number;
    unreadEmailCount: number;
    upcomingEventsCount: number;
    tomorrowEventsCount: number;
  };
  tasks: Array<{
    id: string; name: string; jobName: string; jobNumber: string;
    endDate: string | null; progress: number; urgency: string; daysUntilDue: number | null;
  }>;
  recentEmails: Array<{
    id: string; threadId: string; from: string; subject: string;
    snippet: string; date: string; isUnread: boolean;
  }>;
  calendarEvents: Array<{
    id: string; summary: string; start: string; end: string;
    allDay: boolean; location: string; attendeeCount: number;
  }>;
  activeJobs?: Array<{ id: string; name: string; number: string }>;
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
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [editingDateTaskId, setEditingDateTaskId] = useState<string | null>(null);
  const [pendingDate, setPendingDate] = useState('');
  const [cleanupState, setCleanupState] = useState<'idle' | 'scanning' | 'preview' | 'cleaning' | 'done'>('idle');
  const [cleanupData, setCleanupData] = useState<{ toArchive: Array<{ id: string; from: string; subject: string; reason: string }>; toKeep: any[] } | null>(null);

  async function scanInbox() {
    setCleanupState('scanning');
    try {
      const res = await fetch('/api/dashboard/inbox-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ mode: 'preview' }),
      });
      if (!res.ok) throw new Error('Scan failed');
      const data = await res.json();
      setCleanupData(data);
      setCleanupState('preview');
    } catch {
      setCleanupState('idle');
    }
  }

  async function executeCleanup() {
    setCleanupState('cleaning');
    try {
      const res = await fetch('/api/dashboard/inbox-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ mode: 'execute' }),
      });
      if (!res.ok) throw new Error('Cleanup failed');
      const data = await res.json();
      setCleanupData(data);
      setCleanupState('done');
      // Auto-reset after 5 seconds
      setTimeout(() => { setCleanupState('idle'); setCleanupData(null); }, 5000);
    } catch {
      setCleanupState('idle');
    }
  }

  async function completeTask(taskId: string) {
    setCompletingTaskId(taskId);
    try {
      const res = await fetch('/api/dashboard/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ taskId, action: 'complete' }),
      });
      if (!res.ok) throw new Error('Failed to complete task');
      // Remove from local state immediately
      if (overview) {
        const updatedTasks = overview.data.tasks.filter(t => t.id !== taskId);
        setOverview({
          ...overview,
          data: {
            ...overview.data,
            tasks: updatedTasks,
            stats: { ...overview.data.stats, totalTasks: updatedTasks.length },
          },
        });
      }
    } catch (err: any) {
      console.error('Complete task failed:', err);
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function updateTaskDate(taskId: string, newDate: string) {
    try {
      const res = await fetch('/api/dashboard/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ taskId, action: 'update', endDate: newDate }),
      });
      if (!res.ok) throw new Error('Failed to update task date');
      // Update in local state
      if (overview) {
        const updatedTasks = overview.data.tasks.map(t =>
          t.id === taskId ? { ...t, endDate: newDate, ...recalcUrgency(newDate) } : t
        );
        setOverview({ ...overview, data: { ...overview.data, tasks: updatedTasks } });
      }
    } catch (err: any) {
      console.error('Update task date failed:', err);
    } finally {
      setEditingDateTaskId(null);
      setPendingDate('');
    }
  }

  function recalcUrgency(endDate: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(endDate); due.setHours(0, 0, 0, 0);
    const days = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const urgency = (days < 0 || days <= 2) ? 'urgent' : days <= 5 ? 'high' : 'normal';
    return { urgency, daysUntilDue: days };
  }

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

  // Auto-refresh every 15 minutes during work hours (8am-6pm)
  // Also triggers inbox cleanup silently in the background
  useEffect(() => {
    const interval = setInterval(() => {
      const hour = new Date().getHours();
      if (hour >= 8 && hour < 18 && auth.userId && !refreshing) {
        fetchOverview(true);
        // Trigger inbox cleanup silently (fire-and-forget)
        fetch('/api/cron/inbox-cleanup?internal=true').catch(() => {});
      }
    }, 15 * 60 * 1000); // 15 minutes
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.userId]);

  if (!auth.isAuthenticated || !auth.userId) {
    return <div className="p-8 text-center" style={{ color: '#8a8078' }}>Loading...</div>;
  }

  const analysis = overview?.analysis;
  const stats = overview?.data?.stats;
  const tasks = overview?.data?.tasks || [];
  const emails = overview?.data?.recentEmails || [];
  const calendarEvents = overview?.data?.calendarEvents || [];
  const tc = overview?.data?.timeContext;
  const tomorrowBriefing = analysis?.tomorrowBriefing;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header — time-aware */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#e8e0d8' }}>
            {getGreeting(tc?.period)}, {auth.user?.name?.split(' ')[0]}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#CDA274' }}>
            {getSubGreeting(tc?.period, tc?.tomorrowLabel) || (loading ? 'Loading...' : '')}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#6a6058' }}>
            {overview?._cached && overview._cachedAt
              ? `Updated ${timeAgo(overview._cachedAt)}`
              : loading ? '' : 'Fresh analysis'}
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

          {/* Do Now — AI-suggested quick actions */}
          {(analysis?.suggestedActions?.length ?? 0) > 0 && (
            <section className="rounded-lg p-4" style={{ background: '#1a2218', border: '1px solid rgba(34,197,94,0.15)' }}>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#22c55e' }}>
                <Zap size={14} /> Do Now
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {analysis!.suggestedActions!.map((action, i) => {
                  const iconMap: Record<string, string> = {
                    'reply-email': '✉️', 'complete-task': '✅', 'reschedule-task': '📅',
                    'follow-up': '💬', 'prep-meeting': '📋', 'review-document': '📄',
                  };
                  const icon = iconMap[action.actionType] || '⚡';
                  const priorityColor = action.priority === 'high' ? '#ef4444' : action.priority === 'medium' ? '#eab308' : '#22c55e';

                  const handleAction = () => {
                    if (action.actionType === 'reply-email' && action.context.recipient) {
                      const subject = action.context.emailSubject ? `Re: ${action.context.emailSubject}` : '';
                      const body = action.context.suggestedText || '';
                      window.open(`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(action.context.recipient)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
                    } else if (action.actionType === 'complete-task' && action.context.taskName) {
                      const task = tasks.find(t => t.name.toLowerCase().includes(action.context.taskName!.toLowerCase()));
                      if (task) completeTask(task.id);
                    } else if (action.actionType === 'follow-up' && action.context.recipient) {
                      const body = action.context.suggestedText || '';
                      window.open(`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(action.context.recipient)}&body=${encodeURIComponent(body)}`, '_blank');
                    } else if (action.actionType === 'prep-meeting' || action.actionType === 'review-document') {
                      // Open JT job if we have a job name
                      const job = overview?.data?.activeJobs?.find((j: any) =>
                        action.context.jobName && j.name.toLowerCase().includes(action.context.jobName.toLowerCase())
                      );
                      if (job) window.open(`https://app.jobtread.com/jobs/${job.id}`, '_blank');
                    }
                  };

                  return (
                    <button
                      key={i}
                      onClick={handleAction}
                      className="flex items-start gap-3 px-4 py-3 md:px-3 md:py-2.5 rounded-lg text-left transition-all hover:bg-white/[0.05] active:bg-white/[0.08]"
                      style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.1)' }}
                    >
                      <span className="text-base flex-shrink-0 mt-0.5">{icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium" style={{ color: '#e8e0d8' }}>{action.title}</p>
                        {action.context.jobName && (
                          <p className="text-xs mt-0.5" style={{ color: '#8a8078' }}>{action.context.jobName}</p>
                        )}
                      </div>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2" style={{ background: priorityColor }} />
                    </button>
                  );
                })}
              </div>
            </section>
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

          {/* Tomorrow Preview — prominent in evening, collapsed in morning/midday */}
          {tomorrowBriefing && (tomorrowBriefing.headline || tomorrowBriefing.calendarWalkthrough?.length > 0 || tomorrowBriefing.prepTonightOrAM?.length > 0) && (
            <section className="rounded-lg p-4" style={{ background: tc?.period === 'evening' ? '#1a2332' : '#1e1e1e', border: tc?.period === 'evening' ? '1px solid rgba(139,92,246,0.2)' : '1px solid rgba(205,162,116,0.08)' }}>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#8b5cf6' }}>
                <Calendar size={14} /> {tc?.tomorrowLabel ? `${tc.tomorrowLabel.charAt(0).toUpperCase() + tc.tomorrowLabel.slice(1)}'s Preview` : "Tomorrow's Preview"}
              </h2>
              {tomorrowBriefing.headline && (
                <p className="text-sm mb-3" style={{ color: '#e8e0d8' }}>{tomorrowBriefing.headline}</p>
              )}
              <div className="grid md:grid-cols-2 gap-4">
                {/* Calendar walkthrough */}
                {tomorrowBriefing.calendarWalkthrough?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-2" style={{ color: '#8a8078' }}>SCHEDULE</p>
                    <div className="space-y-2">
                      {tomorrowBriefing.calendarWalkthrough.map((item, i) => (
                        <div key={i} className="flex gap-3 px-2 py-1.5 rounded" style={{ background: 'rgba(139,92,246,0.05)' }}>
                          <span className="text-xs font-medium flex-shrink-0 pt-0.5" style={{ color: '#8b5cf6', minWidth: '60px' }}>{item.time}</span>
                          <div className="min-w-0">
                            <p className="text-sm" style={{ color: '#e8e0d8' }}>{item.event}</p>
                            {item.prepNote && <p className="text-xs mt-0.5" style={{ color: '#8a8078' }}>{item.prepNote}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Prep tasks */}
                {(tomorrowBriefing.prepTonightOrAM?.length > 0 || tomorrowBriefing.tasksDue?.length > 0) && (
                  <div>
                    {tomorrowBriefing.prepTonightOrAM?.length > 0 && (
                      <>
                        <p className="text-xs font-medium mb-2" style={{ color: '#8a8078' }}>
                          {tc?.period === 'evening' ? 'PREP TONIGHT' : 'PREP FOR TOMORROW'}
                        </p>
                        <div className="space-y-1.5">
                          {tomorrowBriefing.prepTonightOrAM.map((item, i) => (
                            <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded" style={{ background: 'rgba(234,179,8,0.05)' }}>
                              <CheckCircle2 size={12} className="flex-shrink-0 mt-0.5" style={{ color: '#eab308' }} />
                              <p className="text-sm" style={{ color: '#e8e0d8' }}>{item}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {tomorrowBriefing.tasksDue?.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-medium mb-2" style={{ color: '#8a8078' }}>TASKS DUE</p>
                        <div className="space-y-1">
                          {tomorrowBriefing.tasksDue.map((item, i) => (
                            <div key={i} className="px-2 py-1 text-sm" style={{ color: '#a09890' }}>
                              {item.task} <span style={{ color: '#6a6058' }}>— {item.jobName}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Calendar & Email — two-column layout */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Upcoming Schedule with AI prep notes */}
            {calendarEvents.length > 0 && (
              <section className="rounded-lg p-4" style={CARD_STYLE}>
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#8b5cf6' }}>
                  <Calendar size={14} /> Upcoming Schedule ({calendarEvents.length})
                </h2>
                <div className="space-y-2">
                  {calendarEvents.slice(0, 8).map((event) => {
                    const start = new Date(event.start);
                    const isToday = start.toDateString() === new Date().toDateString();
                    const isTomorrow = start.toDateString() === new Date(Date.now() + 86400000).toDateString();
                    const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    const timeLabel = event.allDay ? 'All day' : start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    // Find matching prep note from AI
                    const prepNote = analysis?.meetingPrepNotes?.find(p =>
                      event.summary.toLowerCase().includes(p.eventSummary.toLowerCase()) ||
                      p.eventSummary.toLowerCase().includes(event.summary.toLowerCase().slice(0, 15))
                    );
                    return (
                      <div key={event.id} className="flex items-start gap-3 px-3 py-2 rounded-lg" style={{ background: isToday ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.03)' }}>
                        <div className="flex-shrink-0 text-center pt-0.5" style={{ minWidth: '48px' }}>
                          <p className="text-[10px] font-medium" style={{ color: isToday ? '#8b5cf6' : '#8a8078' }}>{dayLabel}</p>
                          {!event.allDay && <p className="text-xs font-semibold" style={{ color: '#e8e0d8' }}>{timeLabel}</p>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate" style={{ color: '#e8e0d8' }}>{event.summary}</p>
                          {event.location && (
                            <p className="text-xs truncate flex items-center gap-1 mt-0.5" style={{ color: '#8a8078' }}>
                              <MapPin size={10} /> {event.location.slice(0, 50)}
                            </p>
                          )}
                          {prepNote && (
                            <p className="text-xs mt-1 px-2 py-1 rounded" style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa' }}>
                              {prepNote.prepNote}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Recent Emails with AI Cleanup */}
            {emails.length > 0 && (
              <section className="rounded-lg p-4" style={CARD_STYLE}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: '#22c55e' }}>
                    <Mail size={14} /> Inbox ({stats?.unreadEmailCount ?? 0} unread)
                  </h2>
                  {cleanupState === 'idle' && (
                    <button
                      onClick={scanInbox}
                      className="text-[10px] px-2 py-1 rounded hover:bg-white/10 active:bg-white/20 flex items-center gap-1"
                      style={{ color: '#8a8078', border: '1px solid rgba(205,162,116,0.15)' }}
                    >
                      <Zap size={10} /> Clean Inbox
                    </button>
                  )}
                  {cleanupState === 'scanning' && (
                    <span className="text-[10px] flex items-center gap-1" style={{ color: '#8a8078' }}>
                      <Loader2 size={10} className="animate-spin" /> AI scanning...
                    </span>
                  )}
                  {cleanupState === 'done' && (
                    <span className="text-[10px]" style={{ color: '#22c55e' }}>
                      Cleaned {cleanupData?.toArchive?.length || 0} emails
                    </span>
                  )}
                </div>

                {/* Cleanup Preview */}
                {cleanupState === 'preview' && cleanupData && (
                  <div className="mb-3 p-3 rounded-lg" style={{ background: 'rgba(234,179,8,0.05)', border: '1px solid rgba(234,179,8,0.15)' }}>
                    <p className="text-xs font-medium mb-2" style={{ color: '#eab308' }}>
                      AI found {cleanupData.toArchive.length} emails to archive:
                    </p>
                    <div className="space-y-1 mb-2 max-h-32 overflow-y-auto">
                      {cleanupData.toArchive.map((e, i) => (
                        <p key={i} className="text-xs truncate" style={{ color: '#a09890' }}>
                          {e.from}: {e.subject}
                        </p>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={executeCleanup}
                        className="text-xs px-3 py-1.5 rounded font-medium active:bg-green-700"
                        style={{ background: '#22c55e', color: '#1a1a1a' }}
                      >
                        Archive {cleanupData.toArchive.length} emails
                      </button>
                      <button
                        onClick={() => { setCleanupState('idle'); setCleanupData(null); }}
                        className="text-xs px-3 py-1.5 rounded"
                        style={{ color: '#8a8078' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {cleanupState === 'cleaning' && (
                  <div className="mb-3 p-3 rounded-lg flex items-center gap-2" style={{ background: 'rgba(34,197,94,0.05)' }}>
                    <Loader2 size={12} className="animate-spin" style={{ color: '#22c55e' }} />
                    <span className="text-xs" style={{ color: '#22c55e' }}>Archiving emails...</span>
                  </div>
                )}
                <div className="space-y-1">
                  {emails.slice(0, 8).map((email) => {
                    // Extract just the name from "Name <email>" format
                    const fromName = email.from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
                    return (
                      <div key={email.id} className="flex items-start gap-3 px-3 py-3 md:py-2 rounded-lg hover:bg-white/[0.02]" style={email.isUnread ? { background: 'rgba(34,197,94,0.05)' } : {}}>
                        {email.isUnread && (
                          <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: '#22c55e' }} />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-medium truncate" style={{ color: email.isUnread ? '#e8e0d8' : '#8a8078' }}>{fromName}</p>
                          </div>
                          <p className="text-sm truncate" style={{ color: email.isUnread ? '#e8e0d8' : '#a09890' }}>{email.subject}</p>
                          <p className="text-xs truncate mt-0.5" style={{ color: '#6a6058' }}>{email.snippet.slice(0, 80)}</p>
                        </div>
                      </div>
                    );
                  })}
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
                const isCompleting = completingTaskId === task.id;
                const isEditingDate = editingDateTaskId === task.id;
                return (
                  <div key={task.id} className="flex items-center gap-2 md:gap-3 px-2 md:px-3 py-3 md:py-2 rounded-lg hover:bg-white/[0.02] group" style={isCompleting ? { opacity: 0.4 } : {}}>
                    {/* Complete button */}
                    <button
                      onClick={() => completeTask(task.id)}
                      disabled={isCompleting}
                      className="flex-shrink-0 w-7 h-7 md:w-5 md:h-5 rounded-full border flex items-center justify-center hover:bg-green-500/20 active:bg-green-500/30 transition-colors"
                      style={{ borderColor: 'rgba(205,162,116,0.25)' }}
                      title="Mark complete"
                    >
                      {isCompleting
                        ? <Loader2 size={12} className="animate-spin" style={{ color: '#8a8078' }} />
                        : <CheckCircle2 size={12} className="md:opacity-0 md:group-hover:opacity-100 transition-opacity" style={{ color: '#22c55e' }} />
                      }
                    </button>
                    {/* Urgency badge */}
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0" style={{ background: urgStyle.bg, color: urgStyle.text }}>
                      {task.urgency === 'urgent' ? 'URG' : task.urgency === 'high' ? 'HIGH' : ''}
                    </span>
                    {/* Task info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: '#e8e0d8' }}>{task.name}</p>
                      <p className="text-xs truncate" style={{ color: '#8a8078' }}>{task.jobName} #{task.jobNumber}</p>
                    </div>
                    {/* Due date — clickable to edit */}
                    {isEditingDate ? (
                      <input
                        type="date"
                        autoFocus
                        defaultValue={task.endDate || ''}
                        onChange={(e) => setPendingDate(e.target.value)}
                        onBlur={() => {
                          if (pendingDate && pendingDate !== task.endDate) {
                            updateTaskDate(task.id, pendingDate);
                          } else {
                            setEditingDateTaskId(null);
                            setPendingDate('');
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && pendingDate) updateTaskDate(task.id, pendingDate);
                          if (e.key === 'Escape') { setEditingDateTaskId(null); setPendingDate(''); }
                        }}
                        className="text-xs px-2 py-1 rounded outline-none w-32 flex-shrink-0"
                        style={{ background: '#2a2a2a', border: '1px solid rgba(205,162,116,0.3)', color: '#e8e0d8' }}
                      />
                    ) : (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Quick reschedule buttons for overdue tasks */}
                        {task.daysUntilDue !== null && task.daysUntilDue < 0 && (
                          <button
                            onClick={() => {
                              const next = new Date();
                              next.setDate(next.getDate() + 1);
                              updateTaskDate(task.id, next.toISOString().split('T')[0]);
                            }}
                            className="text-[10px] md:text-[10px] px-2 py-1 md:px-1.5 md:py-0.5 rounded hover:bg-white/10 active:bg-white/20"
                            style={{ color: '#eab308', border: '1px solid rgba(234,179,8,0.2)' }}
                            title="Reschedule to tomorrow"
                          >
                            +1d
                          </button>
                        )}
                        <button
                          onClick={() => { setEditingDateTaskId(task.id); setPendingDate(task.endDate || ''); }}
                          className="text-xs px-2 py-1 md:px-0 md:py-0 rounded hover:underline cursor-pointer"
                          style={{ color: task.urgency === 'urgent' ? '#ef4444' : '#8a8078' }}
                          title="Click to change due date"
                        >
                          {task.daysUntilDue !== null
                            ? (task.daysUntilDue < 0 ? `${Math.abs(task.daysUntilDue)}d overdue` : task.daysUntilDue === 0 ? 'Today' : `${task.daysUntilDue}d`)
                            : task.endDate ? formatDate(task.endDate) : 'No date'}
                        </button>
                      </div>
                    )}
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

'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, Clock, CheckCircle2, Loader2,
  RefreshCw, Calendar, MessageSquare, Zap,
  DollarSign, ClipboardList, ChevronRight, Mail, MapPin,
  ChevronUp, ChevronDown, TrendingUp, TrendingDown, Minus,
  Target, Clock3, Activity, CalendarDays, Building2,
  FileCheck, FileWarning, FileClock, XCircle
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import { useScreenSize } from '@/app/hooks/useScreenSize';
import Link from 'next/link';

function getToken() { return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : ''; }

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
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
// Main Dashboard Page
// ============================================================

export default function DashboardOverview() {
  const auth = useAuth();
  const screen = useScreenSize();
  const isMobile = screen === 'mobile';
  const isTouch = screen !== 'desktop';
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [editingDateTaskId, setEditingDateTaskId] = useState<string | null>(null);
  const [pendingDate, setPendingDate] = useState('');
  const [showSection, setShowSection] = useState<string | false>(false);
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

  useEffect(() => {
    const interval = setInterval(() => {
      const hour = new Date().getHours();
      if (hour >= 8 && hour < 18 && auth.userId && !refreshing) {
        fetchOverview(true);
        fetch('/api/cron/inbox-cleanup?internal=true').catch(() => {});
      }
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.userId]);

  if (!auth.isAuthenticated || !auth.userId) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <Loader2 size={20} className="animate-spin" style={{ color: '#CDA274' }} />
    </div>;
  }

  const analysis = overview?.analysis;
  const stats = overview?.data?.stats;
  const tasks = overview?.data?.tasks || [];
  const emails = overview?.data?.recentEmails || [];
  const calendarEvents = overview?.data?.calendarEvents || [];
  const tc = overview?.data?.timeContext;
  const tomorrowBriefing = analysis?.tomorrowBriefing;
  const firstName = auth.user?.name?.split(' ')[0] || '';

  // Categorize tasks
  const urgentTasks = tasks.filter(t => t.urgency === 'urgent');
  const highTasks = tasks.filter(t => t.urgency === 'high');
  const normalTasks = tasks.filter(t => t.urgency === 'normal');
  const todayStr = new Date().toISOString().split('T')[0];
  const overdueTasks = tasks.filter(t => t.daysUntilDue !== null && t.daysUntilDue < 0);

  if (loading && !overview) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <Loader2 size={20} className="animate-spin" style={{ color: '#CDA274' }} />
    </div>
  );

  if (error && !overview) return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error}</p>
      <button onClick={() => fetchOverview()} style={{ background: '#CDA274', color: '#1a1a1a', fontSize: 12, padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer' }}>Retry</button>
    </div>
  );

  if (!overview) return null;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: isMobile ? '0 12px' : '0 8px' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isTouch ? 10 : 6 }}>
        <div>
          <h1 style={{ color: '#e8e0d8', fontSize: isTouch ? 22 : 18, fontWeight: 700, margin: 0 }}>{getGreeting()}, {firstName}</h1>
          {overview._cached && overview._cachedAt && (
            <span style={{ fontSize: 10, color: '#5a5550' }}>Updated {timeAgo(overview._cachedAt)}</span>
          )}
        </div>
        <button onClick={() => fetchOverview(true)} disabled={refreshing} style={{ padding: 5, borderRadius: 6, background: 'rgba(205,162,116,0.08)', border: 'none', cursor: 'pointer', lineHeight: 0 }}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} style={{ color: '#CDA274' }} />
        </button>
      </div>

      {/* KPI GRID — placeholder, will be customized */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(5, 1fr)', gap: isTouch ? 6 : 4, marginBottom: isTouch ? 10 : 6 }}>
        {/* KPI 1: Active Jobs */}
        <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: '3px solid #CDA274' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
            <Building2 size={9} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>ACTIVE JOBS</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#CDA274', lineHeight: 1 }}>
            {stats?.activeJobCount || 0}
          </div>
        </div>

        {/* KPI 2: Urgent Tasks */}
        <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${urgentTasks.length > 0 ? '#ef4444' : '#22c55e'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
            <AlertTriangle size={9} style={{ color: urgentTasks.length > 0 ? '#ef4444' : '#22c55e' }} />
            <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>URGENT</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: urgentTasks.length > 0 ? '#ef4444' : '#22c55e', lineHeight: 1 }}>
            {urgentTasks.length}
          </div>
        </div>

        {/* KPI 3: Overdue */}
        <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${overdueTasks.length > 0 ? '#f59e0b' : '#22c55e'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
            <Clock3 size={9} style={{ color: overdueTasks.length > 0 ? '#f59e0b' : '#22c55e' }} />
            <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>OVERDUE</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: overdueTasks.length > 0 ? '#f59e0b' : '#22c55e', lineHeight: 1 }}>
            {overdueTasks.length}
          </div>
        </div>

        {/* KPI 4: Due Today */}
        <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: '3px solid #3b82f6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
            <Target size={9} style={{ color: '#3b82f6' }} />
            <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>DUE TODAY</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6', lineHeight: 1 }}>
            {stats?.tasksToday || 0}
          </div>
        </div>

        {/* KPI 5: Unread Emails */}
        <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${(stats?.unreadEmailCount || 0) > 0 ? '#22c55e' : '#5a5550'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
            <Mail size={9} style={{ color: (stats?.unreadEmailCount || 0) > 0 ? '#22c55e' : '#5a5550' }} />
            <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>UNREAD</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: (stats?.unreadEmailCount || 0) > 0 ? '#22c55e' : '#5a5550', lineHeight: 1 }}>
            {stats?.unreadEmailCount || 0}
          </div>
        </div>
      </div>

      {/* AI BRIEFING — compact, matches field dashboard style */}
      {analysis?.summary && (
        <div style={{ background: 'rgba(205,162,116,0.06)', border: '1px solid rgba(205,162,116,0.12)', borderRadius: 8, padding: '8px 10px', marginBottom: isTouch ? 10 : 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Zap size={10} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 9, fontWeight: 600, color: '#CDA274' }}>AI BRIEFING</span>
          </div>
          <p style={{ fontSize: 12, color: '#e8e0d8', lineHeight: 1.5, margin: 0 }}>{analysis.summary}</p>
        </div>
      )}

      {/* DO NOW — AI-suggested quick actions */}
      {(analysis?.suggestedActions?.length ?? 0) > 0 && (
        <div style={{ background: '#1a2218', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 8, padding: '8px 10px', marginBottom: isTouch ? 10 : 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
            <Zap size={10} style={{ color: '#22c55e' }} />
            <span style={{ fontSize: 9, fontWeight: 600, color: '#22c55e' }}>DO NOW</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 4 }}>
            {analysis!.suggestedActions!.slice(0, 6).map((action, i) => {
              const iconMap: Record<string, string> = {
                'reply-email': '✉️', 'complete-task': '✅', 'reschedule-task': '📅',
                'follow-up': '💬', 'prep-meeting': '📋', 'review-document': '📄',
              };
              const icon = iconMap[action.actionType] || '⚡';
              const priorityColor = action.priority === 'high' ? '#ef4444' : action.priority === 'medium' ? '#eab308' : '#22c55e';

              const handleAction = async () => {
                if ((action.actionType === 'reply-email' || action.actionType === 'follow-up') && action.context.recipient) {
                  try {
                    const subject = action.context.emailSubject ? `Re: ${action.context.emailSubject}` : (action.context.jobName ? `Re: ${action.context.jobName}` : '');
                    const body = action.context.suggestedText || '';
                    const res = await fetch('/api/dashboard/quick-action', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                      body: JSON.stringify({ actionType: 'draft-email', to: action.context.recipient, subject, body }),
                    });
                    const data = await res.json();
                    if (data.gmailUrl) window.open(data.gmailUrl, '_blank');
                    else window.open(`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(action.context.recipient)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
                  } catch {
                    const subject = action.context.emailSubject ? `Re: ${action.context.emailSubject}` : '';
                    const body = action.context.suggestedText || '';
                    window.open(`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(action.context.recipient)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
                  }
                } else if (action.actionType === 'complete-task' && action.context.taskName) {
                  const task = tasks.find(t => t.name.toLowerCase().includes(action.context.taskName!.toLowerCase()));
                  if (task) completeTask(task.id);
                } else if (action.actionType === 'prep-meeting' || action.actionType === 'review-document') {
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
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.1)',
                    background: 'rgba(34,197,94,0.05)', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 500, color: '#e8e0d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{action.title}</p>
                    {action.context.jobName && (
                      <p style={{ fontSize: 9, color: '#6a6058', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{action.context.jobName}</p>
                    )}
                  </div>
                  <div style={{ width: 5, height: 5, borderRadius: 3, background: priorityColor, flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* COLLAPSIBLE CARDS ROW — Urgent / Overdue / Total Tasks / Emails */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {/* Urgent Tasks */}
        <button
          onClick={() => setShowSection(showSection === 'urgent' ? false : 'urgent')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: urgentTasks.length > 0 ? 'rgba(239,68,68,0.08)' : '#1e1e1e',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: urgentTasks.length > 0 ? 'rgba(239,68,68,0.18)' : 'rgba(205,162,116,0.06)',
            textAlign: 'left',
          }}
        >
          <AlertTriangle size={11} style={{ color: urgentTasks.length > 0 ? '#ef4444' : '#5a5550', flexShrink: 0 }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: urgentTasks.length > 0 ? '#ef4444' : '#5a5550', lineHeight: 1 }}>{urgentTasks.length}</span>
          <span style={{ fontSize: 8, color: '#6a6058' }}>Urgent</span>
        </button>

        {/* Overdue */}
        <button
          onClick={() => setShowSection(showSection === 'overdue' ? false : 'overdue')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: overdueTasks.length > 0 ? 'rgba(245,158,11,0.08)' : '#1e1e1e',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: overdueTasks.length > 0 ? 'rgba(245,158,11,0.18)' : 'rgba(205,162,116,0.06)',
            textAlign: 'left',
          }}
        >
          <Clock size={11} style={{ color: overdueTasks.length > 0 ? '#f59e0b' : '#5a5550', flexShrink: 0 }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: overdueTasks.length > 0 ? '#f59e0b' : '#5a5550', lineHeight: 1 }}>{overdueTasks.length}</span>
          <span style={{ fontSize: 8, color: '#6a6058' }}>Overdue</span>
        </button>

        {/* All Open Tasks */}
        <button
          onClick={() => setShowSection(showSection === 'tasks' ? false : 'tasks')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#1e1e1e',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: 'rgba(205,162,116,0.06)',
            textAlign: 'left',
          }}
        >
          <CheckCircle2 size={11} style={{ color: '#CDA274', flexShrink: 0 }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: '#CDA274', lineHeight: 1 }}>{tasks.length}</span>
          <span style={{ fontSize: 8, color: '#6a6058' }}>Open</span>
        </button>
      </div>

      {/* EXPANDED TASK LIST — shows when any card is clicked */}
      {showSection && ['urgent', 'overdue', 'tasks'].includes(showSection) && (() => {
        const sectionTasks = showSection === 'urgent' ? urgentTasks
          : showSection === 'overdue' ? overdueTasks
          : tasks;
        const sectionLabel = showSection === 'urgent' ? 'Urgent Tasks'
          : showSection === 'overdue' ? 'Overdue Tasks'
          : 'All Open Tasks';
        const sectionColor = showSection === 'urgent' ? '#ef4444'
          : showSection === 'overdue' ? '#f59e0b'
          : '#CDA274';

        return (
          <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 6, maxHeight: 300, overflowY: 'auto' }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: sectionColor, marginBottom: 4, letterSpacing: '0.04em' }}>{sectionLabel}</div>
            {sectionTasks.length === 0 && (
              <p style={{ color: '#5a5550', fontSize: 11, textAlign: 'center', padding: 8 }}>None</p>
            )}
            {sectionTasks.slice(0, 20).map(task => {
              const isCompleting = completingTaskId === task.id;
              const isEditingDate = editingDateTaskId === task.id;
              return (
                <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: '1px solid rgba(205,162,116,0.04)', opacity: isCompleting ? 0.4 : 1 }}>
                  <button
                    onClick={() => completeTask(task.id)}
                    disabled={isCompleting}
                    style={{ width: isTouch ? 24 : 18, height: isTouch ? 24 : 18, borderRadius: '50%', border: '1px solid rgba(205,162,116,0.25)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    {isCompleting
                      ? <Loader2 size={10} className="animate-spin" style={{ color: '#8a8078' }} />
                      : <CheckCircle2 size={10} style={{ color: '#22c55e' }} />
                    }
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, color: '#e8e0d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name}</p>
                    <p style={{ fontSize: 9, color: '#6a6058', margin: 0 }}>{task.jobName} #{task.jobNumber}</p>
                  </div>
                  {isEditingDate ? (
                    <input
                      type="date"
                      autoFocus
                      defaultValue={task.endDate || ''}
                      onChange={(e) => setPendingDate(e.target.value)}
                      onBlur={() => {
                        if (pendingDate && pendingDate !== task.endDate) updateTaskDate(task.id, pendingDate);
                        else { setEditingDateTaskId(null); setPendingDate(''); }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && pendingDate) updateTaskDate(task.id, pendingDate);
                        if (e.key === 'Escape') { setEditingDateTaskId(null); setPendingDate(''); }
                      }}
                      style={{ fontSize: 10, padding: '2px 4px', borderRadius: 4, background: '#2a2a2a', border: '1px solid rgba(205,162,116,0.3)', color: '#e8e0d8', width: 110, flexShrink: 0 }}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {task.daysUntilDue !== null && task.daysUntilDue < 0 && (
                        <button
                          onClick={() => {
                            const next = new Date();
                            next.setDate(next.getDate() + 1);
                            updateTaskDate(task.id, next.toISOString().split('T')[0]);
                          }}
                          style={{ fontSize: 9, color: '#eab308', background: 'rgba(234,179,8,0.1)', padding: '1px 4px', borderRadius: 3, border: '1px solid rgba(234,179,8,0.2)', cursor: 'pointer' }}
                        >
                          +1d
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingDateTaskId(task.id); setPendingDate(task.endDate || ''); }}
                        style={{ fontSize: 10, color: task.urgency === 'urgent' ? '#ef4444' : '#6a6058', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        {task.daysUntilDue !== null
                          ? (task.daysUntilDue < 0 ? `${Math.abs(task.daysUntilDue)}d overdue` : task.daysUntilDue === 0 ? 'Today' : `${task.daysUntilDue}d`)
                          : 'No date'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* TWO-COLUMN: Calendar + Email */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 6, marginBottom: 6 }}>
        {/* Upcoming Schedule */}
        {calendarEvents.length > 0 && (
          <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              <Calendar size={10} style={{ color: '#8b5cf6' }} />
              <span style={{ fontSize: 9, fontWeight: 600, color: '#8b5cf6' }}>SCHEDULE ({calendarEvents.length})</span>
            </div>
            {calendarEvents.slice(0, 6).map((event) => {
              const start = new Date(event.start);
              const isToday = start.toDateString() === new Date().toDateString();
              const isTomorrow = start.toDateString() === new Date(Date.now() + 86400000).toDateString();
              const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              const timeLabel = event.allDay ? 'All day' : start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
              const prepNote = analysis?.meetingPrepNotes?.find(p =>
                event.summary.toLowerCase().includes(p.eventSummary.toLowerCase()) ||
                p.eventSummary.toLowerCase().includes(event.summary.toLowerCase().slice(0, 15))
              );
              return (
                <div key={event.id} style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid rgba(205,162,116,0.04)' }}>
                  <div style={{ minWidth: 48, flexShrink: 0 }}>
                    <p style={{ fontSize: 8, fontWeight: 600, color: isToday ? '#8b5cf6' : '#5a5550', margin: 0 }}>{dayLabel}</p>
                    {!event.allDay && <p style={{ fontSize: 11, fontWeight: 600, color: '#e8e0d8', margin: 0 }}>{timeLabel}</p>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, color: '#e8e0d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.summary}</p>
                    {event.location && (
                      <p style={{ fontSize: 9, color: '#5a5550', margin: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <MapPin size={8} /> {event.location.slice(0, 40)}
                      </p>
                    )}
                    {prepNote && (
                      <p style={{ fontSize: 9, color: '#a78bfa', background: 'rgba(139,92,246,0.1)', padding: '2px 4px', borderRadius: 3, margin: '2px 0 0' }}>{prepNote.prepNote}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Inbox */}
        {emails.length > 0 && (
          <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Mail size={10} style={{ color: '#22c55e' }} />
                <span style={{ fontSize: 9, fontWeight: 600, color: '#22c55e' }}>INBOX ({stats?.unreadEmailCount ?? 0} unread)</span>
              </div>
              {cleanupState === 'idle' && (
                <button
                  onClick={scanInbox}
                  style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: 'transparent', border: '1px solid rgba(205,162,116,0.15)', color: '#6a6058', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
                >
                  <Zap size={8} /> Clean
                </button>
              )}
              {cleanupState === 'scanning' && (
                <span style={{ fontSize: 8, color: '#6a6058', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Loader2 size={8} className="animate-spin" /> Scanning...
                </span>
              )}
              {cleanupState === 'done' && (
                <span style={{ fontSize: 8, color: '#22c55e' }}>Cleaned {cleanupData?.toArchive?.length || 0}</span>
              )}
            </div>

            {/* Cleanup Preview */}
            {cleanupState === 'preview' && cleanupData && (
              <div style={{ background: 'rgba(234,179,8,0.05)', border: '1px solid rgba(234,179,8,0.15)', borderRadius: 6, padding: '6px 8px', marginBottom: 6 }}>
                <p style={{ fontSize: 9, fontWeight: 600, color: '#eab308', margin: '0 0 4px' }}>
                  AI found {cleanupData.toArchive.length} emails to archive:
                </p>
                <div style={{ maxHeight: 80, overflowY: 'auto', marginBottom: 4 }}>
                  {cleanupData.toArchive.map((e, i) => (
                    <p key={i} style={{ fontSize: 9, color: '#8a8078', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.from}: {e.subject}
                    </p>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={executeCleanup} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: '#22c55e', color: '#1a1a1a', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                    Archive {cleanupData.toArchive.length}
                  </button>
                  <button onClick={() => { setCleanupState('idle'); setCleanupData(null); }} style={{ fontSize: 10, color: '#6a6058', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {cleanupState === 'cleaning' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 6, background: 'rgba(34,197,94,0.05)', borderRadius: 4, marginBottom: 4 }}>
                <Loader2 size={10} className="animate-spin" style={{ color: '#22c55e' }} />
                <span style={{ fontSize: 9, color: '#22c55e' }}>Archiving...</span>
              </div>
            )}

            {emails.slice(0, 6).map((email) => {
              const fromName = email.from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
              return (
                <div key={email.id} style={{ display: 'flex', alignItems: 'start', gap: 6, padding: '4px 0', borderBottom: '1px solid rgba(205,162,116,0.04)' }}>
                  {email.isUnread && <div style={{ width: 5, height: 5, borderRadius: 3, background: '#22c55e', flexShrink: 0, marginTop: 4 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 10, fontWeight: email.isUnread ? 600 : 400, color: email.isUnread ? '#e8e0d8' : '#6a6058', margin: 0 }}>{fromName}</p>
                    <p style={{ fontSize: 11, color: email.isUnread ? '#e8e0d8' : '#8a8078', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email.subject}</p>
                    <p style={{ fontSize: 9, color: '#4a4a4a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email.snippet.slice(0, 70)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* INSIGHTS ROW — Urgent Items + Action Items side by side */}
      {((analysis?.urgentItems?.length ?? 0) > 0 || (analysis?.actionItems?.length ?? 0) > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 6, marginBottom: 6 }}>
          {(analysis?.urgentItems?.length ?? 0) > 0 && (
            <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <AlertTriangle size={10} style={{ color: '#ef4444' }} />
                <span style={{ fontSize: 9, fontWeight: 600, color: '#ef4444' }}>NEEDS ATTENTION</span>
              </div>
              {analysis!.urgentItems.map((item, i) => (
                <div key={i} style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)', borderRadius: 6, padding: '5px 8px', marginBottom: 3 }}>
                  <p style={{ fontSize: 11, fontWeight: 500, color: '#e8e0d8', margin: 0 }}>{item.title}</p>
                  <p style={{ fontSize: 9, color: '#6a6058', margin: 0 }}>{item.description}{item.jobName ? ` — ${item.jobName}` : ''}</p>
                </div>
              ))}
            </div>
          )}

          {(analysis?.actionItems?.length ?? 0) > 0 && (
            <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <ClipboardList size={10} style={{ color: '#CDA274' }} />
                <span style={{ fontSize: 9, fontWeight: 600, color: '#CDA274' }}>ACTION ITEMS</span>
              </div>
              {analysis!.actionItems.slice(0, 6).map((item, i) => {
                const color = item.priority === 'high' ? '#ef4444' : item.priority === 'medium' ? '#eab308' : '#22c55e';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'start', gap: 6, padding: '4px 0', borderBottom: '1px solid rgba(205,162,116,0.04)' }}>
                    <div style={{ width: 4, height: 4, borderRadius: 2, background: color, flexShrink: 0, marginTop: 5 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 11, color: '#e8e0d8', margin: 0 }}>{item.action}</p>
                      {item.jobName && <p style={{ fontSize: 9, color: '#5a5550', margin: 0 }}>{item.jobName}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TOMORROW PREVIEW */}
      {tomorrowBriefing && (tomorrowBriefing.headline || tomorrowBriefing.calendarWalkthrough?.length > 0 || tomorrowBriefing.prepTonightOrAM?.length > 0) && (
        <div style={{
          background: tc?.period === 'evening' ? '#1a2332' : '#1e1e1e',
          border: tc?.period === 'evening' ? '1px solid rgba(139,92,246,0.2)' : '1px solid rgba(205,162,116,0.08)',
          borderRadius: 8, padding: '8px 10px', marginBottom: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
            <Calendar size={10} style={{ color: '#8b5cf6' }} />
            <span style={{ fontSize: 9, fontWeight: 600, color: '#8b5cf6' }}>
              {tc?.tomorrowLabel ? `${tc.tomorrowLabel.charAt(0).toUpperCase() + tc.tomorrowLabel.slice(1)}'s Preview` : "Tomorrow's Preview"}
            </span>
          </div>
          {tomorrowBriefing.headline && (
            <p style={{ fontSize: 12, color: '#e8e0d8', margin: '0 0 6px' }}>{tomorrowBriefing.headline}</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
            {tomorrowBriefing.calendarWalkthrough?.length > 0 && (
              <div>
                <p style={{ fontSize: 8, fontWeight: 600, color: '#5a5550', marginBottom: 4, letterSpacing: '0.04em' }}>SCHEDULE</p>
                {tomorrowBriefing.calendarWalkthrough.map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, padding: '3px 0' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#8b5cf6', minWidth: 50, flexShrink: 0 }}>{item.time}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 11, color: '#e8e0d8', margin: 0 }}>{item.event}</p>
                      {item.prepNote && <p style={{ fontSize: 9, color: '#6a6058', margin: 0 }}>{item.prepNote}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(tomorrowBriefing.prepTonightOrAM?.length > 0 || tomorrowBriefing.tasksDue?.length > 0) && (
              <div>
                {tomorrowBriefing.prepTonightOrAM?.length > 0 && (
                  <>
                    <p style={{ fontSize: 8, fontWeight: 600, color: '#5a5550', marginBottom: 4, letterSpacing: '0.04em' }}>
                      {tc?.period === 'evening' ? 'PREP TONIGHT' : 'PREP FOR TOMORROW'}
                    </p>
                    {tomorrowBriefing.prepTonightOrAM.map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'start', gap: 4, padding: '2px 0' }}>
                        <CheckCircle2 size={9} style={{ color: '#eab308', flexShrink: 0, marginTop: 2 }} />
                        <p style={{ fontSize: 11, color: '#e8e0d8', margin: 0 }}>{item}</p>
                      </div>
                    ))}
                  </>
                )}
                {tomorrowBriefing.tasksDue?.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <p style={{ fontSize: 8, fontWeight: 600, color: '#5a5550', marginBottom: 4, letterSpacing: '0.04em' }}>TASKS DUE</p>
                    {tomorrowBriefing.tasksDue.map((item, i) => (
                      <p key={i} style={{ fontSize: 11, color: '#8a8078', margin: '2px 0' }}>
                        {item.task} <span style={{ color: '#5a5550' }}>— {item.jobName}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* QUICK NAVIGATION */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 4 }}>
        {auth.permissions?.canViewBills && (
          <Link href="/dashboard/invoicing" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.06)', textDecoration: 'none' }}>
            <DollarSign size={12} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 11, color: '#e8e0d8' }}>Invoicing</span>
            <ChevronRight size={10} style={{ color: '#5a5550', marginLeft: 'auto' }} />
          </Link>
        )}
        <Link href="/dashboard/precon" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.06)', textDecoration: 'none' }}>
          <ClipboardList size={12} style={{ color: '#CDA274' }} />
          <span style={{ fontSize: 11, color: '#e8e0d8' }}>Pre-Con</span>
          <ChevronRight size={10} style={{ color: '#5a5550', marginLeft: 'auto' }} />
        </Link>
        <Link href="/dashboard/ask" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.06)', textDecoration: 'none' }}>
          <MessageSquare size={12} style={{ color: '#CDA274' }} />
          <span style={{ fontSize: 11, color: '#e8e0d8' }}>Ask Agent</span>
          <ChevronRight size={10} style={{ color: '#5a5550', marginLeft: 'auto' }} />
        </Link>
        {auth.permissions?.canViewGrid && (
          <Link href="/dashboard/spec-writer" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 8, background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.06)', textDecoration: 'none' }}>
            <ChevronRight size={12} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 11, color: '#e8e0d8' }}>Spec Writer</span>
            <ChevronRight size={10} style={{ color: '#5a5550', marginLeft: 'auto' }} />
          </Link>
        )}
      </div>
    </div>
  );
}

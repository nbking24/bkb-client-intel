'use client';

import { useState, useEffect } from 'react';
import {
  AlertTriangle, Clock, CheckCircle2, Loader2,
  RefreshCw, Calendar, MessageSquare, Zap,
  DollarSign, ClipboardList, ChevronRight,
  ChevronUp, ChevronDown, TrendingUp, TrendingDown, Minus,
  Target, Clock3, Activity, CalendarDays, Building2,
  FileCheck, FileWarning, FileClock, XCircle, Send,
  X, ExternalLink, Check
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
// Terri accesses dashboard on desktop only — no responsive hook needed
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

interface ArAutoRecord {
  date: string;
  tier: string;
}

interface OutstandingInvoice {
  id: string;
  documentNumber: string;
  jobName: string;
  jobId: string;
  amount: number;
  createdAt: string;
  daysPending: number;
  arAutoSent?: ArAutoRecord[];
  arHold?: boolean;
}

interface ChangeOrderSummary {
  jobId: string;
  jobName: string;
  coName: string;
  status: 'approved' | 'pending';
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
    outstandingInvoiceCount: number;
    outstandingInvoiceTotal: number;
    pendingCOCount: number;
    approvedCOCount: number;
  };
  tasks: Array<{
    id: string; name: string; jobId: string; jobName: string; jobNumber: string;
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
  outstandingInvoices?: OutstandingInvoice[];
  changeOrders?: ChangeOrderSummary[];
}

interface OverviewResponse {
  analysis: DashboardAnalysis;
  data: DashboardData;
  _cached: boolean;
  _cachedAt?: string;
  _analysisTimeMs?: number;
}

// ============================================================
// Helpers
// ============================================================

const PALETTE = [
  '#CDA274', '#3b82f6', '#22c55e', '#a855f7',
  '#ec4899', '#f59e0b', '#14b8a6', '#ef4444',
  '#6366f1', '#84cc16', '#f97316', '#06b6d4',
];
function jobColor(n: string): string {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = h * 31 + n.charCodeAt(i);
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function jtScheduleUrl(jobId: string): string {
  return `https://app.jobtread.com/jobs/${jobId}/schedule`;
}

// ============================================================
// Main Dashboard Page
// ============================================================

export default function DashboardOverview() {
  const auth = useAuth();
  const isMobile = false; // Desktop-only dashboard
  const isTouch = false;
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [editingDateTaskId, setEditingDateTaskId] = useState<string | null>(null);
  const [pendingDate, setPendingDate] = useState('');
  const [showSection, setShowSection] = useState<string | false>(false);
  const [collapsedJobs, setCollapsedJobs] = useState<Set<string>>(new Set());
  // Calendar task popup
  const [selectedCalTask, setSelectedCalTask] = useState<{ id: string; name: string; jobId: string; jobName: string; jobNumber: string; endDate: string | null; progress: number } | null>(null);
  const [calEditingDate, setCalEditingDate] = useState('');
  const [calSavingDate, setCalSavingDate] = useState(false);
  const [calCompleting, setCalCompleting] = useState(false);
  // AR Stats
  const [arStats, setArStats] = useState<{
    totalRemindersSent: number;
    jobsWithReminders: number;
    jobsOnHold: number;
    activeJobs: number;
    recentReminders: Array<{ jobName: string; tier: string; date: string }>;
  } | null>(null);

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

  // Calendar popup actions
  async function completeCalTask() {
    if (!selectedCalTask) return;
    setCalCompleting(true);
    try {
      const res = await fetch('/api/dashboard/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ taskId: selectedCalTask.id, action: 'complete' }),
      });
      if (!res.ok) throw new Error('Failed');
      if (overview) {
        const updatedTasks = overview.data.tasks.filter(t => t.id !== selectedCalTask.id);
        setOverview({ ...overview, data: { ...overview.data, tasks: updatedTasks, stats: { ...overview.data.stats, totalTasks: updatedTasks.length } } });
      }
      setSelectedCalTask(null);
    } catch (err: any) {
      console.error('Complete cal task failed:', err);
    } finally {
      setCalCompleting(false);
    }
  }

  async function saveCalDate() {
    if (!selectedCalTask || !calEditingDate) return;
    setCalSavingDate(true);
    try {
      const res = await fetch('/api/dashboard/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ taskId: selectedCalTask.id, action: 'update', endDate: calEditingDate }),
      });
      if (!res.ok) throw new Error('Failed');
      if (overview) {
        const updatedTasks = overview.data.tasks.map(t =>
          t.id === selectedCalTask.id ? { ...t, endDate: calEditingDate, ...recalcUrgency(calEditingDate) } : t
        );
        setOverview({ ...overview, data: { ...overview.data, tasks: updatedTasks } });
      }
      setSelectedCalTask(null);
    } catch (err: any) {
      console.error('Save cal date failed:', err);
    } finally {
      setCalSavingDate(false);
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
    if (auth.userId) {
      fetchOverview();
      fetch('/api/dashboard/invoicing/ar-stats').then(r => r.ok ? r.json() : null).then(d => { if (d) setArStats(d); }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.userId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const hour = new Date().getHours();
      if (hour >= 8 && hour < 18 && auth.userId && !refreshing) {
        fetchOverview(true);
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
  const outstandingInvoices = overview?.data?.outstandingInvoices || [];
  const changeOrders = overview?.data?.changeOrders || [];
  const tc = overview?.data?.timeContext;
  const tomorrowBriefing = analysis?.tomorrowBriefing;
  const firstName = auth.user?.name?.split(' ')[0] || '';

  // Categorize tasks
  const urgentTasks = tasks.filter(t => t.urgency === 'urgent');
  const highTasks = tasks.filter(t => t.urgency === 'high');
  const normalTasks = tasks.filter(t => t.urgency === 'normal');
  const todayStr = new Date().toISOString().split('T')[0];
  const overdueTasks = tasks.filter(t => t.daysUntilDue !== null && t.daysUntilDue < 0);

  // Two-week calendar grid
  const weeks = (() => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(12, 0, 0, 0);
    const dn = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return [0, 1].map(w => ({
      label: w === 0 ? 'This Week' : 'Next Week',
      days: Array.from({ length: 7 }, (_, d) => {
        const dt = new Date(monday);
        dt.setDate(monday.getDate() + w * 7 + d);
        return {
          date: dt.toISOString().split('T')[0],
          dayName: dn[d],
          dayNum: dt.getDate(),
          month: dt.toLocaleDateString('en-US', { month: 'short' }),
          isWeekend: d >= 5,
        };
      }),
    }));
  })();

  const tasksByDate: Record<string, typeof tasks> = {};
  for (const t of tasks) {
    const d = t.endDate;
    if (!d) continue;
    if (!tasksByDate[d]) tasksByDate[d] = [];
    tasksByDate[d].push(t);
  }

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

      {/* KPI GRID */}
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

        {/* KPI 2: Open Tasks — clickable */}
        <button
          onClick={() => setShowSection(showSection === 'tasks' ? false : 'tasks')}
          style={{ background: showSection === 'tasks' ? 'rgba(59,130,246,0.1)' : '#1e1e1e', borderRadius: 6, padding: '6px 7px', border: 'none', borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: tasks.length > 0 ? '#3b82f6' : '#5a5550', cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
            <ClipboardList size={9} style={{ color: tasks.length > 0 ? '#3b82f6' : '#5a5550' }} />
            <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>OPEN TASKS</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: tasks.length > 0 ? '#3b82f6' : '#5a5550', lineHeight: 1 }}>
            {tasks.length}
          </div>
        </button>

        {/* KPI 3: Overdue — clickable */}
        <button
          onClick={() => setShowSection(showSection === 'overdue' ? false : 'overdue')}
          style={{ background: showSection === 'overdue' ? 'rgba(239,68,68,0.1)' : '#1e1e1e', borderRadius: 6, padding: '6px 7px', border: 'none', borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: overdueTasks.length > 0 ? '#ef4444' : '#22c55e', cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
            <AlertTriangle size={9} style={{ color: overdueTasks.length > 0 ? '#ef4444' : '#22c55e' }} />
            <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>OVERDUE</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: overdueTasks.length > 0 ? '#ef4444' : '#22c55e', lineHeight: 1 }}>
            {overdueTasks.length}
          </div>
        </button>

        {/* KPI 4: Outstanding Invoices (AR) — clickable */}
        {(() => {
          const invCount = stats?.outstandingInvoiceCount || 0;
          const invTotal = stats?.outstandingInvoiceTotal || 0;
          const hasOutstanding = invCount > 0;
          const isActive = showSection === 'invoices';
          return (
            <button
              onClick={() => setShowSection(isActive ? false : 'invoices')}
              style={{ background: isActive ? 'rgba(245,158,11,0.1)' : '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${hasOutstanding ? '#f59e0b' : '#22c55e'}`, border: 'none', borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: hasOutstanding ? '#f59e0b' : '#22c55e', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <DollarSign size={9} style={{ color: hasOutstanding ? '#f59e0b' : '#22c55e' }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>OUTSTANDING AR</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: hasOutstanding ? '#f59e0b' : '#22c55e', lineHeight: 1 }}>
                {invCount}
              </div>
              {hasOutstanding && (
                <div style={{ fontSize: 8, color: '#6a6058', marginTop: 2 }}>
                  ${invTotal >= 1000 ? `${(invTotal / 1000).toFixed(1)}k` : invTotal.toFixed(0)}
                </div>
              )}
            </button>
          );
        })()}

        {/* KPI 5: Pending Change Orders — clickable */}
        {(() => {
          const pending = stats?.pendingCOCount || 0;
          const approved = stats?.approvedCOCount || 0;
          const hasPending = pending > 0;
          const isActive = showSection === 'changeorders';
          return (
            <button
              onClick={() => setShowSection(isActive ? false : 'changeorders')}
              style={{ background: isActive ? 'rgba(245,158,11,0.1)' : '#1e1e1e', borderRadius: 6, padding: '6px 7px', border: 'none', borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: hasPending ? '#f59e0b' : '#22c55e', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <FileWarning size={9} style={{ color: hasPending ? '#f59e0b' : '#22c55e' }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>PENDING COs</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: hasPending ? '#f59e0b' : '#22c55e', lineHeight: 1 }}>
                {pending}
              </div>
              {(pending + approved) > 0 && (
                <div style={{ fontSize: 8, color: '#6a6058', marginTop: 2 }}>
                  {approved} approved
                </div>
              )}
            </button>
          );
        })()}
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

      {/* OUTSTANDING INVOICES — expandable from KPI card click */}
      {showSection === 'invoices' && (
        <div style={{ background: '#1e1e1e', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, padding: '8px 10px', marginBottom: isTouch ? 10 : 6, maxHeight: 340, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <DollarSign size={10} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: 9, fontWeight: 600, color: '#f59e0b', letterSpacing: '0.04em' }}>
                OUTSTANDING INVOICES ({outstandingInvoices.length})
              </span>
            </div>
            {outstandingInvoices.length > 0 && (
              <span style={{ fontSize: 9, color: '#6a6058' }}>
                Total: ${(stats?.outstandingInvoiceTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            )}
          </div>
          {outstandingInvoices.length === 0 ? (
            <p style={{ color: '#22c55e', fontSize: 11, textAlign: 'center', padding: 8 }}>All invoices paid</p>
          ) : (
            outstandingInvoices.map((inv) => {
              const isOverdue = inv.daysPending > 30;
              const isWarning = inv.daysPending > 14;
              const statusColor = isOverdue ? '#ef4444' : isWarning ? '#f59e0b' : '#6a6058';
              const hasArAuto = inv.arAutoSent && inv.arAutoSent.length > 0;
              const lastArSent = hasArAuto ? inv.arAutoSent![0] : null;
              const isHeld = inv.arHold === true;
              return (
                <div key={inv.id} style={{ padding: '5px 0', borderBottom: '1px solid rgba(205,162,116,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 5, height: 5, borderRadius: 3, background: statusColor, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 11, color: '#e8e0d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inv.jobName.replace(/^#\d+\s*/, '')}
                      </p>
                      <p style={{ fontSize: 9, color: '#6a6058', margin: 0 }}>
                        Invoice #{inv.documentNumber}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#e8e0d8', margin: 0 }}>
                        ${inv.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                      <p style={{ fontSize: 9, color: statusColor, margin: 0, fontWeight: isOverdue ? 600 : 400 }}>
                        {inv.daysPending}d pending
                      </p>
                    </div>
                  </div>
                  {/* AR Auto-Reminder Status */}
                  {(hasArAuto || isHeld) && (
                    <div style={{ marginLeft: 13, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {isHeld && (
                        <span style={{ fontSize: 8, background: 'rgba(239,68,68,0.12)', color: '#f87171', padding: '1px 5px', borderRadius: 3, fontWeight: 500 }}>
                          AR-HOLD
                        </span>
                      )}
                      {hasArAuto && (
                        <span style={{ fontSize: 8, background: 'rgba(34,197,94,0.1)', color: '#4ade80', padding: '1px 5px', borderRadius: 3 }}
                          title={`${inv.arAutoSent!.length} reminder(s) sent. Last: ${lastArSent!.tier} on ${new Date(lastArSent!.date).toLocaleDateString()}`}>
                          Reminder sent {new Date(lastArSent!.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ({lastArSent!.tier})
                        </span>
                      )}
                      {hasArAuto && inv.arAutoSent!.length > 1 && (
                        <span style={{ fontSize: 8, color: '#6a6058' }}>
                          +{inv.arAutoSent!.length - 1} prior
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* AR AUTOMATED REMINDERS — compact status bar */}
      {arStats && arStats.totalRemindersSent > 0 && (
        <div style={{ background: '#1e1e1e', border: '1px solid rgba(34,197,94,0.12)', borderRadius: 8, padding: '6px 10px', marginBottom: isTouch ? 10 : 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Send size={10} style={{ color: '#4ade80' }} />
              <span style={{ fontSize: 9, fontWeight: 600, color: '#4ade80', letterSpacing: '0.04em' }}>
                AR REMINDERS
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#e8e0d8' }}>{arStats.totalRemindersSent}</span>
              <span style={{ fontSize: 9, color: '#6a6058' }}>sent</span>
            </div>
            <div style={{ width: 1, height: 14, background: 'rgba(205,162,116,0.08)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#4ade80' }}>{arStats.activeJobs}</span>
              <span style={{ fontSize: 9, color: '#6a6058' }}>active</span>
            </div>
            {arStats.jobsOnHold > 0 && (
              <>
                <div style={{ width: 1, height: 14, background: 'rgba(205,162,116,0.08)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#f87171' }}>{arStats.jobsOnHold}</span>
                  <span style={{ fontSize: 9, color: '#6a6058' }}>paused</span>
                </div>
              </>
            )}
            {arStats.recentReminders.length > 0 && (
              <>
                <div style={{ width: 1, height: 14, background: 'rgba(205,162,116,0.08)' }} />
                <span style={{ fontSize: 9, color: '#6a6058' }}>
                  Last: {new Date(arStats.recentReminders[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {arStats.recentReminders[0].jobName.replace(/^#\d+\s*/, '').split(' ').slice(0, 3).join(' ')} ({arStats.recentReminders[0].tier})
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* PENDING CHANGE ORDERS — expandable from KPI card click */}
      {showSection === 'changeorders' && (
        <div style={{ background: '#1e1e1e', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, padding: '8px 10px', marginBottom: isTouch ? 10 : 6, maxHeight: 340, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <FileWarning size={10} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: 9, fontWeight: 600, color: '#f59e0b', letterSpacing: '0.04em' }}>
                CHANGE ORDERS ({changeOrders.length})
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontSize: 9, color: '#f59e0b' }}>{changeOrders.filter(co => co.status === 'pending').length} pending</span>
              <span style={{ fontSize: 9, color: '#22c55e' }}>{changeOrders.filter(co => co.status === 'approved').length} approved</span>
            </div>
          </div>
          {changeOrders.length === 0 ? (
            <p style={{ color: '#5a5550', fontSize: 11, textAlign: 'center', padding: 8 }}>No change orders</p>
          ) : (() => {
            const jobGroups = new Map<string, typeof changeOrders>();
            for (const co of changeOrders) {
              const key = co.jobName;
              if (!jobGroups.has(key)) jobGroups.set(key, []);
              jobGroups.get(key)!.push(co);
            }
            return Array.from(jobGroups.entries()).map(([jobName, cos]) => {
              const pendingCount = cos.filter(c => c.status === 'pending').length;
              const approvedCount = cos.filter(c => c.status === 'approved').length;
              return (
                <div key={jobName} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(205,162,116,0.08)' }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: '#e8e0d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {jobName.replace(/^#\d+\s*/, '')}
                    </p>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {pendingCount > 0 && (
                        <span style={{ fontSize: 9, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '1px 5px', borderRadius: 3 }}>
                          {pendingCount} pending
                        </span>
                      )}
                      {approvedCount > 0 && (
                        <span style={{ fontSize: 9, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '1px 5px', borderRadius: 3 }}>
                          {approvedCount} approved
                        </span>
                      )}
                    </div>
                  </div>
                  {cos.map((co, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0 3px 12px' }}>
                      {co.status === 'approved'
                        ? <FileCheck size={10} style={{ color: '#22c55e', flexShrink: 0 }} />
                        : <FileWarning size={10} style={{ color: '#f59e0b', flexShrink: 0 }} />
                      }
                      <p style={{ fontSize: 10, color: co.status === 'approved' ? '#6a6058' : '#e8e0d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {co.coName}
                      </p>
                    </div>
                  ))}
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* EXPANDED TASK LIST — shows when KPI card is clicked */}
      {showSection && ['overdue', 'tasks'].includes(showSection) && (() => {
        const sectionTasks = showSection === 'overdue' ? overdueTasks : tasks;
        const sectionLabel = showSection === 'overdue' ? 'Overdue Tasks' : 'All Open Tasks';
        const sectionColor = showSection === 'overdue' ? '#ef4444' : '#3b82f6';

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

      {/* TWO-WEEK TASK CALENDAR */}
      {weeks.map((week, wi) => (
        <div key={wi} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <Calendar size={11} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#5a5550' }}>{week.label.toUpperCase()}</span>
            <span style={{ fontSize: 10, color: '#3f3f3f' }}>{week.days[0].month} {week.days[0].dayNum} – {week.days[6].month} {week.days[6].dayNum}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, borderRadius: 8, overflow: 'hidden' }}>
            {week.days.map(day => {
              const isToday = day.date === todayStr;
              const dayTasks = tasksByDate[day.date] || [];
              const incomplete = dayTasks.filter(t => t.progress < 1);
              const complete = dayTasks.filter(t => t.progress >= 1);

              return (
                <div key={day.date} style={{
                  background: isToday ? 'rgba(205,162,116,0.1)' : '#1a1a1a',
                  minHeight: 80, display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '3px 5px 2px' }}>
                    <span style={{ fontSize: 9, fontWeight: 500, color: day.isWeekend ? '#3a3a3a' : '#6a6058' }}>{day.dayName}</span>
                    <span style={{
                      fontSize: 13, fontWeight: 700,
                      color: isToday ? '#CDA274' : day.isWeekend ? '#3a3a3a' : '#7a7068',
                      ...(isToday ? { background: 'rgba(205,162,116,0.25)', borderRadius: 4, padding: '0 4px' } : {}),
                    }}>{day.dayNum}</span>
                  </div>
                  <div style={{ flex: 1, padding: '1px 2px 3px', display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                    {incomplete.map(task => {
                      const c = jobColor(task.jobNumber);
                      const isSelected = selectedCalTask?.id === task.id;
                      return (
                        <div
                          key={task.id}
                          onClick={() => {
                            setSelectedCalTask(task);
                            setCalEditingDate(task.endDate || '');
                          }}
                          style={{
                            padding: '2px 3px', borderRadius: 3, cursor: 'pointer',
                            borderLeft: `3px solid ${c}`,
                            background: isSelected ? `${c}50` : `${c}18`,
                            fontSize: 9, lineHeight: '12px', color: '#e8e0d8',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                          title={`${task.name} — ${task.jobName}`}
                        >
                          {task.name}
                        </div>
                      );
                    })}
                    {complete.length > 0 && (
                      <div style={{ fontSize: 8, color: '#3a3a3a', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <CheckCircle2 size={7} style={{ color: '#22c55e' }} /> {complete.length} done
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* ALL TASKS — grouped by job, collapsible */}
      {tasks.length > 0 && (() => {
        const jobGroups = new Map<string, typeof tasks>();
        for (const t of tasks) {
          const key = t.jobName || 'Unassigned';
          if (!jobGroups.has(key)) jobGroups.set(key, []);
          jobGroups.get(key)!.push(t);
        }
        // Sort jobs by number of urgent/overdue tasks descending
        const sortedJobs = Array.from(jobGroups.entries()).sort((a, b) => {
          const aUrgent = a[1].filter(t => t.urgency === 'urgent').length;
          const bUrgent = b[1].filter(t => t.urgency === 'urgent').length;
          return bUrgent - aUrgent || b[1].length - a[1].length;
        });
        return (
          <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ClipboardList size={10} style={{ color: '#CDA274' }} />
                <span style={{ fontSize: 9, fontWeight: 600, color: '#CDA274', letterSpacing: '0.04em' }}>ALL TASKS ({tasks.length})</span>
              </div>
              <button
                onClick={() => {
                  if (collapsedJobs.size === sortedJobs.length) {
                    setCollapsedJobs(new Set());
                  } else {
                    setCollapsedJobs(new Set(sortedJobs.map(([name]) => name)));
                  }
                }}
                style={{ fontSize: 8, color: '#6a6058', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
              >
                {collapsedJobs.size === sortedJobs.length ? 'Expand All' : 'Collapse All'}
              </button>
            </div>
            {sortedJobs.map(([jobName, jobTasks]) => {
              const isCollapsed = collapsedJobs.has(jobName);
              const c = jobColor(jobTasks[0].jobNumber);
              const urgentCount = jobTasks.filter(t => t.urgency === 'urgent').length;
              const toggleCollapse = () => {
                setCollapsedJobs(prev => {
                  const next = new Set(prev);
                  if (next.has(jobName)) next.delete(jobName); else next.add(jobName);
                  return next;
                });
              };
              return (
                <div key={jobName} style={{ marginBottom: 4 }}>
                  <button
                    onClick={toggleCollapse}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                      padding: '5px 4px', borderRadius: 4, border: 'none', cursor: 'pointer',
                      background: 'rgba(205,162,116,0.04)', textAlign: 'left',
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: c, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#e8e0d8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {jobName.replace(/^#\d+\s*/, '')}
                    </span>
                    <span style={{ fontSize: 9, color: '#6a6058', flexShrink: 0 }}>{jobTasks.length}</span>
                    {urgentCount > 0 && (
                      <span style={{ fontSize: 8, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>
                        {urgentCount} overdue
                      </span>
                    )}
                    {isCollapsed ? <ChevronDown size={10} style={{ color: '#5a5550', flexShrink: 0 }} /> : <ChevronUp size={10} style={{ color: '#5a5550', flexShrink: 0 }} />}
                  </button>
                  {!isCollapsed && (
                    <div style={{ paddingLeft: 12 }}>
                      {jobTasks.sort((a, b) => {
                        if (a.daysUntilDue === null && b.daysUntilDue === null) return 0;
                        if (a.daysUntilDue === null) return 1;
                        if (b.daysUntilDue === null) return -1;
                        return a.daysUntilDue - b.daysUntilDue;
                      }).map(task => {
                        const isCompleting = completingTaskId === task.id;
                        const isEditingDate = editingDateTaskId === task.id;
                        const statusColor = task.urgency === 'urgent' ? '#ef4444' : task.urgency === 'high' ? '#eab308' : '#6a6058';
                        return (
                          <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid rgba(205,162,116,0.04)', opacity: isCompleting ? 0.4 : 1 }}>
                            <button
                              onClick={() => completeTask(task.id)}
                              disabled={isCompleting}
                              style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid rgba(205,162,116,0.25)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                            >
                              {isCompleting
                                ? <Loader2 size={10} className="animate-spin" style={{ color: '#8a8078' }} />
                                : <Check size={10} style={{ color: '#22c55e' }} />
                              }
                            </button>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: 11, color: '#e8e0d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name}</p>
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
                                style={{ fontSize: 10, padding: '2px 4px', borderRadius: 4, background: '#2a2a2a', border: '1px solid rgba(205,162,116,0.3)', color: '#e8e0d8', width: 110, flexShrink: 0, colorScheme: 'dark' }}
                              />
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                <button
                                  onClick={() => { setEditingDateTaskId(task.id); setPendingDate(task.endDate || ''); }}
                                  style={{ fontSize: 10, color: statusColor, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                                >
                                  {task.daysUntilDue !== null
                                    ? (task.daysUntilDue < 0 ? `${Math.abs(task.daysUntilDue)}d overdue` : task.daysUntilDue === 0 ? 'Today' : `${task.daysUntilDue}d`)
                                    : 'No date'}
                                </button>
                                {task.jobId && (
                                  <a
                                    href={jtScheduleUrl(task.jobId)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ lineHeight: 0, flexShrink: 0 }}
                                    title="View in JobTread"
                                  >
                                    <ExternalLink size={10} style={{ color: '#5a5550' }} />
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* CALENDAR TASK POPUP */}
      {selectedCalTask && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => setSelectedCalTask(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#252525', borderRadius: 12, padding: 16, minWidth: 280, maxWidth: 360,
            border: '1px solid rgba(205,162,116,0.15)', boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e8e0d8', lineHeight: '18px' }}>{selectedCalTask.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: jobColor(selectedCalTask.jobNumber), flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: '#8a8078' }}>#{selectedCalTask.jobNumber} {selectedCalTask.jobName}</span>
                </div>
              </div>
              <button onClick={() => setSelectedCalTask(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                <X size={14} style={{ color: '#6a6058' }} />
              </button>
            </div>

            {/* Date edit */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 4 }}>DUE DATE</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="date"
                  value={calEditingDate}
                  onChange={e => setCalEditingDate(e.target.value)}
                  style={{
                    flex: 1, background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 6,
                    color: '#e8e0d8', fontSize: 12, padding: '5px 8px',
                    colorScheme: 'dark',
                  }}
                />
                {calEditingDate !== (selectedCalTask.endDate || '') && (
                  <button onClick={saveCalDate} disabled={calSavingDate}
                    style={{
                      background: '#CDA274', color: '#1a1a1a', fontSize: 11, fontWeight: 600,
                      padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      opacity: calSavingDate ? 0.5 : 1,
                    }}>
                    {calSavingDate ? 'Saving...' : 'Save'}
                  </button>
                )}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={completeCalTask}
                disabled={calCompleting}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: 'rgba(34,197,94,0.1)', color: '#22c55e',
                  opacity: calCompleting ? 0.5 : 1,
                }}>
                {calCompleting
                  ? <Loader2 size={13} className="animate-spin" />
                  : <><Check size={13} /> Mark Complete</>
                }
              </button>
              <a
                href={selectedCalTask.jobId ? jtScheduleUrl(selectedCalTask.jobId) : '#'}
                target="_blank" rel="noopener noreferrer"
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '7px 0', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none',
                  background: 'rgba(205,162,116,0.1)', color: '#CDA274',
                }}>
                <ExternalLink size={13} /> View in JobTread
              </a>
            </div>
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

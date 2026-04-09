'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, Building2, CalendarDays, CheckCircle2,
  ChevronDown, ChevronUp, Clock, DollarSign, FileWarning,
  Loader2, Mail, Receipt, RefreshCw, ExternalLink,
  Check, X, Bot, ChevronRight, ListTodo
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import {
  type OverviewResponse, type DashboardTask,
  getToken, getGreeting, timeAgo, recalcUrgency,
  formatDateLabel, getDateColor, isWaitingOn, stripWoPrefix,
} from '@/app/lib/dashboard-types';

// ============================================================
// Mobile Dashboard — shares data layer with desktop /dashboard
// All data comes from the same /api/dashboard/* endpoints.
// ============================================================

type Section = 'tasks' | 'overdue' | 'calendar' | 'invoices' | 'changeorders' | 'jobs' | false;

export default function MobileDashboard() {
  const auth = useAuth();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<Section>(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [calWeek, setCalWeek] = useState<0 | 1>(0);

  // ── Data Fetching (same API as desktop) ──────────────────
  const fetchOverview = useCallback(async (forceRefresh = false) => {
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
  }, [auth.userId]);

  useEffect(() => {
    if (auth.userId) fetchOverview();
  }, [auth.userId, fetchOverview]);

  // Refresh on window focus
  useEffect(() => {
    const handler = () => fetchOverview(true);
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [fetchOverview]);

  // ── Task Actions ─────────────────────────────────────────
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

  // ── Derived Data ─────────────────────────────────────────
  const stats = overview?.data?.stats;
  const tasks = overview?.data?.tasks || [];
  const outstandingInvoices = overview?.data?.outstandingInvoices || [];
  const changeOrders = overview?.data?.changeOrders || [];
  const calendarEvents = overview?.data?.calendarEvents || [];
  const activeJobs = overview?.data?.activeJobs || [];
  const firstName = auth.user?.name?.split(' ')[0] || '';

  const overdueTasks = tasks.filter(t => t.daysUntilDue !== null && t.daysUntilDue < 0);
  const todayTasks = tasks.filter(t => t.daysUntilDue !== null && t.daysUntilDue === 0);
  const upcomingTasks = tasks.filter(t => t.daysUntilDue !== null && t.daysUntilDue > 0);
  const regularTasks = tasks.filter(t => !isWaitingOn(t.name));
  const waitingOnTasks = tasks.filter(t => isWaitingOn(t.name));

  // Today's calendar events
  const todayStr = new Date().toISOString().split('T')[0];
  const todayEvents = calendarEvents.filter(ev => ev.start?.slice(0, 10) === todayStr);
  const tomorrowStr = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })();
  const tomorrowEvents = calendarEvents.filter(ev => ev.start?.slice(0, 10) === tomorrowStr);

  // ── Two-Week Calendar Data ──────────────────────────────
  const PALETTE = [
    '#c88c00', '#3b82f6', '#22c55e', '#a855f7',
    '#ec4899', '#f59e0b', '#14b8a6', '#ef4444',
    '#6366f1', '#84cc16', '#f97316', '#06b6d4',
  ];
  function jobColor(n: string): string {
    let h = 0;
    for (let i = 0; i < n.length; i++) h = h * 31 + n.charCodeAt(i);
    return PALETTE[Math.abs(h) % PALETTE.length];
  }

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

  const calEventsByDate: Record<string, typeof calendarEvents> = {};
  for (const ev of calendarEvents) {
    const d = ev.start?.slice(0, 10);
    if (!d) continue;
    if (!calEventsByDate[d]) calEventsByDate[d] = [];
    calEventsByDate[d].push(ev);
  }

  // ── Toggle Section ───────────────────────────────────────
  const toggle = (s: Section) => setExpandedSection(expandedSection === s ? false : (s || false));

  // ── Loading / Error States ───────────────────────────────
  if (loading && !overview) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={28} style={{ color: '#c88c00', animation: 'spin 1s linear infinite' }} />
          <p style={{ color: '#5a5550', fontSize: 14, marginTop: 12 }}>Loading dashboard...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <AlertTriangle size={28} style={{ color: '#ef4444', marginBottom: 12 }} />
          <p style={{ color: '#ef4444', fontSize: 14, marginBottom: 16 }}>{error}</p>
          <button onClick={() => fetchOverview()} style={{ background: '#c88c00', color: '#fff', fontSize: 14, padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#ffffff', paddingBottom: 'env(safe-area-inset-bottom, 20px)' }}>
      {/* ── HEADER ──────────────────────────────────────── */}
      <div style={{ padding: '16px 16px 12px', background: '#68050a', color: '#ffffff', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{getGreeting()}, {firstName}</div>
            {overview?._cachedAt && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
                Updated {timeAgo(overview._cachedAt)}
              </div>
            )}
          </div>
          <button
            onClick={() => fetchOverview(true)}
            disabled={refreshing}
            style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer', lineHeight: 0 }}
          >
            <RefreshCw size={18} style={{ color: '#ffffff', animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      <div style={{ padding: '12px 12px 24px' }}>
        {/* ── KPI GRID (2x3) ────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
          <KpiCard
            icon={<Building2 size={14} />}
            label="Active Jobs"
            value={stats?.activeJobCount || 0}
            color="#c88c00"
            active={expandedSection === 'jobs'}
            onClick={() => toggle('jobs')}
          />
          <KpiCard
            icon={<Mail size={14} />}
            label="Unread Emails"
            value={stats?.unreadEmailCount || 0}
            color={stats?.unreadEmailCount ? '#8b5cf6' : '#5a5550'}
          />
          <KpiCard
            icon={<CalendarDays size={14} />}
            label="Due Today"
            value={todayTasks.length}
            color={todayTasks.length > 0 ? '#3b82f6' : '#5a5550'}
            active={expandedSection === 'tasks'}
            onClick={() => toggle('tasks')}
          />
          <KpiCard
            icon={<AlertTriangle size={14} />}
            label="Overdue"
            value={overdueTasks.length}
            color={overdueTasks.length > 0 ? '#ef4444' : '#22c55e'}
            active={expandedSection === 'overdue'}
            onClick={() => toggle('overdue')}
          />
          <KpiCard
            icon={<FileWarning size={14} />}
            label="Pending COs"
            value={stats?.pendingCOCount || 0}
            color={(stats?.pendingCOCount || 0) > 0 ? '#f59e0b' : '#22c55e'}
            subtitle={stats?.approvedCOCount ? `${stats.approvedCOCount} approved` : undefined}
            active={expandedSection === 'changeorders'}
            onClick={() => toggle('changeorders')}
          />
          <KpiCard
            icon={<Receipt size={14} />}
            label="Unpaid Inv"
            value={outstandingInvoices.length}
            color={outstandingInvoices.length > 0 ? '#f59e0b' : '#22c55e'}
            active={expandedSection === 'invoices'}
            onClick={() => toggle('invoices')}
          />
        </div>

        {/* ── EXPANDED SECTIONS ─────────────────────────── */}

        {/* Active Jobs */}
        {expandedSection === 'jobs' && (
          <ExpandablePanel title="Active Jobs" onClose={() => toggle('jobs')}>
            {activeJobs.length === 0
              ? <EmptyState text="No active jobs" />
              : activeJobs.map(j => (
                <div key={j.id} style={{ padding: '10px 12px', borderBottom: '1px solid #f0eeeb', fontSize: 14, color: '#2a2520' }}>
                  <span style={{ color: '#c88c00', fontWeight: 600 }}>#{j.number}</span>{' '}{j.name}
                </div>
              ))
            }
          </ExpandablePanel>
        )}

        {/* All Tasks — always visible, collapsible */}
        {expandedSection === 'tasks' && (
          <div style={{ background: '#f8f6f3', borderRadius: 8, marginBottom: 12, overflow: 'hidden', border: '1px solid rgba(200,140,0,0.08)' }}>
            <button
              onClick={() => toggle('tasks')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px', borderBottom: tasksExpanded ? '1px solid #f0eeeb' : 'none',
                background: 'none', border: 'none', borderBottomWidth: tasksExpanded ? 1 : 0,
                borderBottomStyle: 'solid', borderBottomColor: '#f0eeeb', cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ListTodo size={14} style={{ color: '#c88c00' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#c88c00', letterSpacing: '0.04em' }}>
                  All Tasks ({regularTasks.length})
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setTasksExpanded(!tasksExpanded); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0 }}
                >
                  {tasksExpanded ? <ChevronUp size={16} style={{ color: '#5a5550' }} /> : <ChevronDown size={16} style={{ color: '#5a5550' }} />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); toggle('tasks'); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0 }}
                >
                  <X size={16} style={{ color: '#5a5550' }} />
                </button>
              </div>
            </button>
            {tasksExpanded && (
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {regularTasks.length === 0
                  ? <EmptyState text="No tasks" />
                  : regularTasks
                      .sort((a, b) => (a.daysUntilDue ?? 999) - (b.daysUntilDue ?? 999))
                      .map(task => (
                        <TaskRow key={task.id} task={task} completing={completingTaskId === task.id} onComplete={completeTask} />
                      ))
                }
                {waitingOnTasks.length > 0 && (
                  <>
                    <div style={{ padding: '10px 12px 6px', fontSize: 12, fontWeight: 600, color: '#c88c00', letterSpacing: '0.04em', borderTop: '2px solid #f0eeeb', marginTop: 4 }}>
                      WAITING ON ({waitingOnTasks.length})
                    </div>
                    {waitingOnTasks.map(task => (
                      <TaskRow key={task.id} task={task} completing={completingTaskId === task.id} onComplete={completeTask} isWaitingOn />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Overdue Tasks */}
        {expandedSection === 'overdue' && (
          <ExpandablePanel title={`Overdue (${overdueTasks.length})`} onClose={() => toggle('overdue')}>
            {overdueTasks.length === 0
              ? <EmptyState text="No overdue tasks" />
              : overdueTasks
                  .sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0))
                  .map(task => (
                    <TaskRow key={task.id} task={task} completing={completingTaskId === task.id} onComplete={completeTask} />
                  ))
            }
          </ExpandablePanel>
        )}

        {/* Change Orders */}
        {expandedSection === 'changeorders' && (
          <ExpandablePanel title="Change Orders" onClose={() => toggle('changeorders')}>
            {changeOrders.length === 0
              ? <EmptyState text="No change orders" />
              : changeOrders.map((co, i) => (
                <div key={i} style={{ padding: '10px 12px', borderBottom: '1px solid #f0eeeb' }}>
                  <div style={{ fontSize: 14, color: '#2a2520', fontWeight: 500 }}>{co.coName}</div>
                  <div style={{ fontSize: 12, color: '#5a5550', marginTop: 2 }}>{co.jobName}</div>
                  <span style={{
                    display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                    background: co.status === 'approved' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                    color: co.status === 'approved' ? '#16a34a' : '#d97706',
                  }}>
                    {co.status === 'approved' ? 'Approved' : 'Pending'}
                  </span>
                </div>
              ))
            }
          </ExpandablePanel>
        )}

        {/* Outstanding Invoices */}
        {expandedSection === 'invoices' && (
          <ExpandablePanel title="Outstanding Invoices" onClose={() => toggle('invoices')}>
            {outstandingInvoices.length === 0
              ? <EmptyState text="No outstanding invoices" />
              : outstandingInvoices
                  .sort((a, b) => b.daysPending - a.daysPending)
                  .map(inv => (
                    <div key={inv.id} style={{ padding: '10px 12px', borderBottom: '1px solid #f0eeeb' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <div style={{ fontSize: 14, color: '#2a2520', fontWeight: 500 }}>
                          #{inv.documentNumber}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#c88c00' }}>
                          ${inv.amount.toLocaleString()}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: '#5a5550', marginTop: 2 }}>{inv.jobName}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 11, color: '#8a8078' }}>
                        <span>{inv.daysPending}d pending</span>
                        {inv.arAutoSent && inv.arAutoSent.length > 0 && (
                          <span style={{ color: '#3b82f6' }}>{inv.arAutoSent.length} follow-up{inv.arAutoSent.length > 1 ? 's' : ''}</span>
                        )}
                        {inv.arHold && <span style={{ color: '#ef4444' }}>On hold</span>}
                      </div>
                    </div>
                  ))
            }
          </ExpandablePanel>
        )}

        {/* ── TODAY'S SCHEDULE ──────────────────────────── */}
        <SectionHeader title="Today's Schedule" count={todayEvents.length} />
        {todayEvents.length === 0 ? (
          <div style={{ padding: '16px 12px', textAlign: 'center', color: '#8a8078', fontSize: 13, background: '#f8f6f3', borderRadius: 8, marginBottom: 12 }}>
            No events today
          </div>
        ) : (
          <div style={{ background: '#f8f6f3', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
            {todayEvents.map(ev => (
              <div key={ev.id} style={{ padding: '10px 12px', borderBottom: '1px solid #f0eeeb' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ fontSize: 12, color: '#c88c00', fontWeight: 600, minWidth: 60, paddingTop: 1 }}>
                    {ev.allDay ? 'All day' : formatEventTime(ev.start)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: '#2a2520', fontWeight: 500 }}>{ev.summary}</div>
                    {ev.location && <div style={{ fontSize: 12, color: '#5a5550', marginTop: 2 }}>{ev.location}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── TOMORROW'S SCHEDULE ───────────────────────── */}
        {tomorrowEvents.length > 0 && (
          <>
            <SectionHeader title="Tomorrow" count={tomorrowEvents.length} />
            <div style={{ background: '#f8f6f3', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
              {tomorrowEvents.map(ev => (
                <div key={ev.id} style={{ padding: '10px 12px', borderBottom: '1px solid #f0eeeb' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ fontSize: 12, color: '#c88c00', fontWeight: 600, minWidth: 60, paddingTop: 1 }}>
                      {ev.allDay ? 'All day' : formatEventTime(ev.start)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, color: '#2a2520', fontWeight: 500 }}>{ev.summary}</div>
                      {ev.location && <div style={{ fontSize: 12, color: '#5a5550', marginTop: 2 }}>{ev.location}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── TWO-WEEK CALENDAR ─────────────────────────── */}
        <SectionHeader title="Calendar" />
        <div style={{ background: '#f8f6f3', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
          {/* Week tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #f0eeeb' }}>
            {weeks.map((w, wi) => (
              <button
                key={wi}
                onClick={() => setCalWeek(wi as 0 | 1)}
                style={{
                  flex: 1, padding: '8px 0', background: 'none', border: 'none',
                  borderBottom: calWeek === wi ? '2px solid #c88c00' : '2px solid transparent',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  color: calWeek === wi ? '#c88c00' : '#8a8078',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {w.label}
              </button>
            ))}
          </div>
          {/* Day columns — horizontal scroll */}
          <div style={{ display: 'flex', overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollSnapType: 'x mandatory' }}>
            {weeks[calWeek].days.map(day => {
              const isToday = day.date === todayStr;
              const dayTasks = tasksByDate[day.date] || [];
              const dayEvents = calEventsByDate[day.date] || [];
              const completedCount = dayTasks.filter(t => t.progress >= 1).length;
              const activeTasks = dayTasks.filter(t => t.progress < 1);
              return (
                <div
                  key={day.date}
                  style={{
                    minWidth: 120, flex: '0 0 auto', scrollSnapAlign: 'start',
                    borderRight: '1px solid #f0eeeb', padding: '8px 6px',
                    background: isToday ? 'rgba(200,140,0,0.06)' : day.isWeekend ? 'rgba(0,0,0,0.015)' : 'transparent',
                  }}
                >
                  {/* Day header */}
                  <div style={{ textAlign: 'center', marginBottom: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: isToday ? '#c88c00' : '#8a8078', letterSpacing: '0.03em' }}>{day.dayName}</div>
                    <div style={{
                      fontSize: 16, fontWeight: 700, color: isToday ? '#c88c00' : '#3a3530', lineHeight: 1.3,
                      ...(isToday ? { background: '#c88c00', color: '#fff', borderRadius: '50%', width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } : {}),
                    }}>
                      {day.dayNum}
                    </div>
                  </div>
                  {/* Google Calendar events */}
                  {dayEvents.map(ev => (
                    <div key={ev.id} style={{
                      fontSize: 10, padding: '3px 5px', marginBottom: 3, borderRadius: 4,
                      background: 'rgba(59,130,246,0.08)', borderLeft: '2px solid #3b82f6',
                      color: '#2a2520', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {ev.allDay ? '📅' : formatEventTime(ev.start).replace(' ', '')} {ev.summary}
                    </div>
                  ))}
                  {/* Tasks */}
                  {activeTasks.map(t => (
                    <div key={t.id} style={{
                      fontSize: 10, padding: '3px 5px', marginBottom: 3, borderRadius: 4,
                      background: `${jobColor(t.jobNumber)}10`,
                      borderLeft: `2px solid ${jobColor(t.jobNumber)}`,
                      color: '#2a2520', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.name}
                    </div>
                  ))}
                  {completedCount > 0 && (
                    <div style={{ fontSize: 10, color: '#8a8078', textAlign: 'center', marginTop: 2 }}>
                      ✓ {completedCount} done
                    </div>
                  )}
                  {dayTasks.length === 0 && dayEvents.length === 0 && (
                    <div style={{ fontSize: 10, color: '#c4bfba', textAlign: 'center', marginTop: 8 }}>—</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── OVERDUE ALERT BANNER ──────────────────────── */}
        {overdueTasks.length > 0 && expandedSection !== 'overdue' && (
          <button
            onClick={() => toggle('overdue')}
            style={{
              width: '100%', padding: '12px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
              borderRadius: 8, marginBottom: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} style={{ color: '#ef4444' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#ef4444' }}>
                {overdueTasks.length} overdue task{overdueTasks.length > 1 ? 's' : ''}
              </span>
            </div>
            <ChevronRight size={16} style={{ color: '#ef4444' }} />
          </button>
        )}

        {/* ── QUICK LINKS ──────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <a
            href="/dashboard"
            style={{
              flex: 1, padding: '12px 14px', background: '#f8f6f3', borderRadius: 8,
              textDecoration: 'none', textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#68050a',
              border: '1px solid rgba(104,5,10,0.1)',
            }}
          >
            Full Dashboard
          </a>
          <a
            href="/m/ask"
            style={{
              flex: 1, padding: '12px 14px', background: 'rgba(200,140,0,0.08)', borderRadius: 8,
              textDecoration: 'none', textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#c88c00',
              border: '1px solid rgba(200,140,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Bot size={14} /> Ask Agent
          </a>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// ============================================================
// Shared Sub-Components
// ============================================================

function KpiCard({ icon, label, value, color, subtitle, active, onClick }: {
  icon: React.ReactNode; label: string; value: number; color: string;
  subtitle?: string; active?: boolean; onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      style={{
        background: active ? `${color}11` : '#f8f6f3',
        borderRadius: 8, padding: '10px 10px 8px', border: 'none',
        borderLeft: `3px solid ${color}`, cursor: onClick ? 'pointer' : 'default',
        textAlign: 'left', WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, color }}>
        {icon}
        <span style={{ fontSize: 9, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>{label.toUpperCase()}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: '#6a6058', marginTop: 3 }}>{subtitle}</div>}
    </Wrapper>
  );
}

function TaskRow({ task, completing, onComplete, isWaitingOn: wo }: {
  task: DashboardTask; completing: boolean; onComplete: (id: string) => void; isWaitingOn?: boolean;
}) {
  const dateLabel = formatDateLabel(task.daysUntilDue);
  const dateColor = getDateColor(task.daysUntilDue);
  const displayName = wo ? stripWoPrefix(task.name) : task.name;

  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid #f0eeeb', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      {/* Complete button */}
      <button
        onClick={() => onComplete(task.id)}
        disabled={completing}
        style={{
          flexShrink: 0, width: 28, height: 28, borderRadius: '50%', border: `2px solid ${dateColor}`,
          background: completing ? dateColor : 'transparent', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {completing ? <Loader2 size={14} style={{ color: '#fff', animation: 'spin 1s linear infinite' }} />
          : <Check size={14} style={{ color: dateColor, opacity: 0.4 }} />}
      </button>
      {/* Task info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: '#2a2520', fontWeight: 500, lineHeight: 1.3 }}>
          {wo && <span style={{ color: '#c88c00' }}>⏳ </span>}
          {displayName}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 12, color: '#8a8078', flexWrap: 'wrap' }}>
          <span style={{ color: '#c88c00' }}>{task.jobName}</span>
          <span style={{ color: dateColor, fontWeight: task.daysUntilDue !== null && task.daysUntilDue < 0 ? 600 : 400 }}>{dateLabel}</span>
        </div>
      </div>
    </div>
  );
}

function ExpandablePanel({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ background: '#f8f6f3', borderRadius: 8, marginBottom: 12, overflow: 'hidden', border: '1px solid rgba(200,140,0,0.08)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: '1px solid #f0eeeb',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#c88c00', letterSpacing: '0.04em' }}>{title}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0 }}>
          <ChevronUp size={16} style={{ color: '#5a5550' }} />
        </button>
      </div>
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, paddingLeft: 2 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#3a3530', letterSpacing: '0.02em' }}>{title}</span>
      {count !== undefined && count > 0 && (
        <span style={{ fontSize: 11, fontWeight: 600, color: '#c88c00', background: 'rgba(200,140,0,0.08)', padding: '1px 6px', borderRadius: 10 }}>{count}</span>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ padding: '16px 12px', textAlign: 'center', color: '#8a8078', fontSize: 13 }}>{text}</div>;
}

// ── Helpers ────────────────────────────────────────────────

function formatEventTime(start: string): string {
  try {
    const d = new Date(start);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return start.slice(11, 16);
  }
}

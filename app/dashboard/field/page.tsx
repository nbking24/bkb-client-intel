// @ts-nocheck
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  AlertTriangle, Loader2, RefreshCw, Calendar,
  Check, MessageSquare, ChevronDown, ChevronUp,
  Zap, ClipboardList, Circle, CheckCircle2,
  X, Briefcase, CalendarDays, ExternalLink,
  Send, Bot, User, CheckCircle, XCircle,
  TrendingUp, TrendingDown, Minus, Target, Clock3, Activity,
  Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudLightning, CloudFog, Droplets,
  FileWarning, FileCheck, FileClock
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import {
  formatContent,
  type ChatMessage,
  type TaskConfirmData,
} from '@/app/hooks/useAskAgent';

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}
function getAuthToken() {
  const pin = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_APP_PIN || '') : '';
  return btoa(pin + ':');
}
function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/* ── Inline Ask Agent Chat ── */
function RenderContent({ content }: { content: string }) {
  const elements = formatContent(content);
  return (
    <>
      {(elements as any[]).map((el: any) => {
        if (el.type === 'code') {
          return (
            <pre key={el.key} style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)', borderRadius: 6, padding: '6px 8px', fontSize: 11, color: '#c8c0b8', overflowX: 'auto', whiteSpace: 'pre-wrap', margin: '4px 0', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{el.content}</pre>
          );
        }
        if (el.type === 'h2') return <div key={el.key} style={{ fontWeight: 700, color: '#CDA274', fontSize: 13, marginTop: 6, marginBottom: 2 }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'h3') return <div key={el.key} style={{ fontWeight: 600, color: '#e8e0d8', fontSize: 12, marginTop: 4, marginBottom: 1 }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'bullet') return <div key={el.key} style={{ marginLeft: 10 }} dangerouslySetInnerHTML={{ __html: '&bull; ' + el.html }} />;
        if (el.type === 'numbered') return <div key={el.key} style={{ marginLeft: 10 }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'hr') return <hr key={el.key} style={{ border: 'none', borderTop: '1px solid rgba(205,162,116,0.1)', margin: '6px 0' }} />;
        if (el.type === 'spacer') return <div key={el.key} style={{ height: 4 }} />;
        return <div key={el.key} dangerouslySetInnerHTML={{ __html: el.html }} />;
      })}
    </>
  );
}

function InlineAskAgent({ pmJobs }: { pmJobs: { id: string; name: string; number: string }[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastAgent, setLastAgent] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [phaseEdit, setPhaseEdit] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Auto-focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const selectedJob = useMemo(() => pmJobs.find(j => j.id === selectedJobId) || null, [pmJobs, selectedJobId]);

  const sendMessage = useCallback(async (userMsg: string) => {
    if (!userMsg.trim() || loading) return;

    let messageForApi = userMsg;
    if (selectedJob) {
      messageForApi = `[Context: The user has selected job "${selectedJob.name}" (#${selectedJob.number}, ID: ${selectedJob.id}). Use this as the target job for their question.]\n\n${userMsg}`;
    }

    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const allMessages = [
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: messageForApi },
      ];

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: allMessages,
          lastAgent: lastAgent || undefined,
          ...(selectedJob ? { jtJobId: selectedJob.id } : {}),
        }),
      });

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`;
        try { const errData = await response.json(); errorMsg = errData.error || errorMsg; } catch {
          try { const text = await response.text(); errorMsg = text.includes('FUNCTION_INVOCATION_TIMEOUT') ? 'Request timed out — try a more specific question.' : (text.substring(0, 200) || 'Request failed'); } catch { errorMsg = 'Request failed'; }
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      setLastAgent(data.agent || null);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || 'No response generated.',
          agent: data.agent,
          needsConfirmation: data.needsConfirmation || false,
          taskConfirm: data.taskConfirm || undefined,
        },
      ]);
    } catch (err) {
      const errMsg = 'Sorry, I ran into an error: ' + (err instanceof Error ? err.message : 'Unknown error');
      setMessages(prev => [...prev, { role: 'assistant', content: errMsg }]);
    } finally {
      setLoading(false);
    }
  }, [loading, messages, lastAgent, selectedJob]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;
    const msg = query.trim();
    setQuery('');
    sendMessage(msg);
  };

  const handleConfirm = async (edits?: Partial<TaskConfirmData>) => {
    const lastMsg = messages[messages.length - 1];
    const taskData = lastMsg?.taskConfirm;
    setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, needsConfirmation: false } : m));
    let confirmMsg = 'Yes, proceed.';
    if (edits) {
      const changes: string[] = [];
      if (edits.phase) changes.push(`put the task under the "${edits.phase}" phase instead`);
      if (changes.length > 0) confirmMsg = 'Yes, proceed but ' + changes.join(', and ') + '.';
    }
    if (taskData) {
      const mergedData = edits ? { ...taskData, ...edits } : taskData;
      if (edits?.phase && edits.phase !== taskData.phase) { delete (mergedData as any).phaseId; (mergedData as any).phaseChanged = true; }
      confirmMsg += '\n\n[APPROVED TASK DATA — execute this now using create_phase_task tool]\n' + JSON.stringify(mergedData);
    }
    await sendMessage(confirmMsg);
  };

  const handleDecline = () => {
    setMessages(prev => [
      ...prev.map((m, i) => i === prev.length - 1 ? { ...m, needsConfirmation: false } : m),
      { role: 'user', content: 'No, cancel that.' },
      { role: 'assistant', content: 'No problem — action cancelled.' },
    ]);
  };

  const lastMsgNeedsConfirm = messages.length > 0 && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].needsConfirmation && !loading;

  const suggestions = [
    'What specs are approved for this job?',
    'Show me all overdue tasks',
    'Create a task for inspections',
    "What's the schedule look like?",
  ];

  return (
    <div style={{ marginBottom: 6, borderRadius: 8, border: '1px solid rgba(205,162,116,0.12)', overflow: 'hidden', background: '#1a1a1a' }}>
      {/* Toggle Bar */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 10px', background: open ? 'rgba(205,162,116,0.08)' : 'transparent',
          border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ width: 22, height: 22, borderRadius: 11, background: 'rgba(205,162,116,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Bot size={12} style={{ color: '#CDA274' }} />
        </div>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#CDA274' }}>Ask Agent</span>
        <span style={{ fontSize: 9, color: '#5a5550' }}>Tasks · Specs · Schedule</span>
        {open ? <ChevronUp size={12} style={{ color: '#5a5550' }} /> : <ChevronDown size={12} style={{ color: '#5a5550' }} />}
      </button>

      {/* Chat Body */}
      {open && (
        <div style={{ borderTop: '1px solid rgba(205,162,116,0.08)' }}>
          {/* Job Selector */}
          <div style={{ padding: '6px 10px', borderBottom: '1px solid rgba(205,162,116,0.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#5a5550', flexShrink: 0 }}>Job:</span>
            <select
              value={selectedJobId}
              onChange={e => setSelectedJobId(e.target.value)}
              style={{
                flex: 1, background: '#242424', border: '1px solid rgba(205,162,116,0.1)',
                borderRadius: 4, color: selectedJobId ? '#CDA274' : '#5a5550',
                fontSize: 10, padding: '3px 6px', outline: 'none', cursor: 'pointer',
              }}
            >
              <option value="">All jobs (no filter)</option>
              {pmJobs.map(j => (
                <option key={j.id} value={j.id}>#{j.number} {j.name}</option>
              ))}
            </select>
            {messages.length > 0 && (
              <button onClick={() => { setMessages([]); setLastAgent(null); }} style={{ fontSize: 9, color: '#5a5550', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
            )}
          </div>

          {/* Messages */}
          <div style={{ maxHeight: 300, overflowY: 'auto', padding: '6px 10px' }}>
            {messages.length === 0 && !loading && (
              <div style={{ padding: '8px 0' }}>
                <p style={{ fontSize: 10, color: '#5a5550', marginBottom: 6, textAlign: 'center' }}>Ask about tasks, specs, or schedules</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                  {suggestions.map(s => (
                    <button key={s} onClick={() => { setQuery(s); inputRef.current?.focus(); }}
                      style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, background: 'rgba(205,162,116,0.06)', border: '1px solid rgba(205,162,116,0.08)', color: '#8a8078', cursor: 'pointer' }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 6, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {msg.role === 'assistant' && (
                    <div style={{ width: 18, height: 18, borderRadius: 9, background: 'rgba(205,162,116,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                      <Bot size={10} style={{ color: '#CDA274' }} />
                    </div>
                  )}
                  <div style={{
                    maxWidth: '85%', padding: '5px 8px', borderRadius: 6, fontSize: 11, lineHeight: '16px',
                    ...(msg.role === 'user'
                      ? { background: '#1B3A5C', color: '#e8e0d8' }
                      : { background: '#242424', color: '#e8e0d8', border: '1px solid rgba(205,162,116,0.06)' }),
                  }}>
                    {msg.role === 'assistant' ? <RenderContent content={msg.content} /> : msg.content}
                  </div>
                  {msg.role === 'user' && (
                    <div style={{ width: 18, height: 18, borderRadius: 9, background: 'rgba(27,58,92,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                      <User size={10} style={{ color: '#e8e0d8' }} />
                    </div>
                  )}
                </div>

                {/* Confirmation buttons */}
                {msg.needsConfirmation && i === messages.length - 1 && !loading && (
                  <div style={{ marginLeft: 24, marginTop: 4, display: 'flex', gap: 6 }}>
                    <button onClick={() => { handleConfirm(phaseEdit ? { phase: phaseEdit } : undefined); setPhaseEdit(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: 'none', cursor: 'pointer' }}>
                      <CheckCircle size={12} /> Approve
                    </button>
                    <button onClick={() => { handleDecline(); setPhaseEdit(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'none', cursor: 'pointer' }}>
                      <XCircle size={12} /> Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0' }}>
                <div style={{ width: 18, height: 18, borderRadius: 9, background: 'rgba(205,162,116,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Bot size={10} style={{ color: '#CDA274' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, background: '#242424', border: '1px solid rgba(205,162,116,0.06)' }}>
                  <Loader2 size={12} className="animate-spin" style={{ color: '#CDA274' }} />
                  <span style={{ fontSize: 10, color: '#5a5550' }}>Searching your data...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderTop: '1px solid rgba(205,162,116,0.06)' }}>
            <textarea
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px'; }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (query.trim() && !loading) handleSubmit(e as any); } }}
              placeholder={selectedJob ? `Ask about #${selectedJob.number} ${selectedJob.name}...` : 'Ask about tasks, specs, or schedules...'}
              rows={1}
              disabled={loading}
              style={{
                flex: 1, background: '#242424', border: '1px solid rgba(205,162,116,0.1)',
                borderRadius: 6, color: '#e8e0d8', fontSize: 11, padding: '6px 8px',
                outline: 'none', resize: 'none', minHeight: 30, maxHeight: 80, overflowY: 'auto',
                fontFamily: 'inherit',
              }}
            />
            <button type="submit" disabled={!query.trim() || loading}
              style={{
                width: 28, height: 28, borderRadius: 6, border: 'none', cursor: query.trim() && !loading ? 'pointer' : 'default',
                background: query.trim() && !loading ? 'rgba(205,162,116,0.15)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
              <Send size={13} style={{ color: query.trim() && !loading ? '#CDA274' : '#3a3a3a' }} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

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

// Types
interface CalTask {
  id: string; name: string; date: string;
  startDate: string | null; endDate: string | null;
  progress: number | null; isComplete: boolean;
  jobId: string; jobName: string; jobNumber: string;
  isAssignedToMe: boolean;
}
interface OdTask {
  id: string; name: string; date: string; progress: number | null;
  jobId: string; jobName: string; jobNumber: string;
  isAssignedToMe: boolean;
}
interface UpcomingTask {
  id: string; name: string; endDate: string | null; progress: number | null;
  jobName: string; jobNumber: string; jobId: string;
}
interface PmJob {
  id: string; name: string; number: string;
}
interface KPIs {
  scheduleAdherence: number | null;
  totalCompletedLast30: number;
  avgDaysOverdue: number;
  overdueTaskCount: number;
  staleTaskCount: number;
  completedThisWeek: number;
  completedLastWeek: number;
  completionTrend: number;
  tasksNext7: number;
  tasksNext30: number;
}
interface WeatherDay {
  date: string; high: number; low: number;
  precipChance: number; code: number;
}
interface ChangeOrder {
  jobId: string;
  jobName: string;
  jobNumber: string;
  coName: string;
  coGroupId: string | null;
  hasDocument: boolean;
  documentStatus: 'needs_document' | 'draft' | 'sent' | 'approved' | 'declined';
  documentId: string | null;
  documentNumber?: string;
  isStale: boolean;
}
interface Data {
  userName: string; briefing: string;
  week1Start: string; todayDate: string;
  jobOverdueTasks: OdTask[]; myOverdueTasks: OdTask[];
  myUpcomingTasks: UpcomingTask[];
  calendarTasks: CalTask[];
  activeJobCount: number;
  pmJobs: PmJob[];
  kpis: KPIs;
  changeOrders: ChangeOrder[];
  weather: WeatherDay[];
}

export default function FieldDashboardPage() {
  const auth = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showTasks, setShowTasks] = useState<string | false>(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [selectedTask, setSelectedTask] = useState<CalTask | null>(null);
  const [editingDate, setEditingDate] = useState('');
  const [savingDate, setSavingDate] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/field-dashboard', { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error('Failed to load');
      setData(await res.json());
    } catch (e: any) { setError(e.message || 'Failed'); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const toggleComplete = async (taskId: string, currentlyComplete: boolean) => {
    setCompleting(prev => new Set(prev).add(taskId));
    try {
      const res = await fetch('/api/field-dashboard', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ taskId, complete: !currentlyComplete }),
      });
      if (!res.ok) throw new Error('Failed');
      if (data) {
        setData({
          ...data,
          calendarTasks: data.calendarTasks.map(t =>
            t.id === taskId ? { ...t, isComplete: !currentlyComplete, progress: !currentlyComplete ? 1 : 0 } : t
          ),
          myUpcomingTasks: !currentlyComplete
            ? data.myUpcomingTasks.filter(t => t.id !== taskId)
            : data.myUpcomingTasks,
          myOverdueTasks: !currentlyComplete
            ? data.myOverdueTasks.filter(t => t.id !== taskId)
            : data.myOverdueTasks,
          jobOverdueTasks: !currentlyComplete
            ? data.jobOverdueTasks.filter(t => t.id !== taskId)
            : data.jobOverdueTasks,
        });
      }
      // Close popup if completing from it
      if (selectedTask?.id === taskId) setSelectedTask(null);
    } catch { /* silent */ }
    finally { setCompleting(prev => { const s = new Set(prev); s.delete(taskId); return s; }); }
  };

  const saveDate = async () => {
    if (!selectedTask || !editingDate) return;
    setSavingDate(true);
    try {
      const res = await fetch('/api/field-dashboard', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ taskId: selectedTask.id, endDate: editingDate }),
      });
      if (!res.ok) throw new Error('Failed');
      // Update local state
      if (data) {
        setData({
          ...data,
          calendarTasks: data.calendarTasks.map(t =>
            t.id === selectedTask.id ? { ...t, date: editingDate, endDate: editingDate } : t
          ),
        });
      }
      setSelectedTask(null);
    } catch { /* silent */ }
    finally { setSavingDate(false); }
  };

  // Close popup on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setSelectedTask(null);
      }
    }
    if (selectedTask) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [selectedTask]);

  useEffect(() => { fetchData(); }, []);

  // Week grids
  const weeks = useMemo(() => {
    if (!data?.week1Start) return [];
    const start = new Date(data.week1Start + 'T12:00:00');
    const dn = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return [0, 1].map(w => ({
      label: w === 0 ? 'Upcoming Week' : 'Following Week',
      days: Array.from({ length: 7 }, (_, d) => {
        const dt = new Date(start);
        dt.setDate(start.getDate() + w * 7 + d);
        return {
          date: dt.toISOString().split('T')[0],
          dayName: dn[d],
          dayNum: dt.getDate(),
          month: dt.toLocaleDateString('en-US', { month: 'short' }),
          isWeekend: d >= 5,
        };
      }),
    }));
  }, [data?.week1Start]);

  const tasksByDate = useMemo(() => {
    if (!data?.calendarTasks) return {};
    const m: Record<string, CalTask[]> = {};
    for (const t of data.calendarTasks) { if (!m[t.date]) m[t.date] = []; m[t.date].push(t); }
    return m;
  }, [data?.calendarTasks]);

  const week1End = useMemo(() => {
    if (!data?.week1Start) return '';
    const d = new Date(data.week1Start + 'T12:00:00');
    d.setDate(d.getDate() + 6);
    return d.toISOString().split('T')[0];
  }, [data?.week1Start]);

  // Tasks assigned to Evan in the next 7 days
  const myNext7Days = useMemo(() => {
    if (!data?.calendarTasks || !data?.todayDate) return [];
    const today = new Date(data.todayDate + 'T12:00:00');
    const in7 = new Date(today.getTime() + 7 * 86400000);
    const in7Str = in7.toISOString().split('T')[0];
    return data.calendarTasks
      .filter(t => t.isAssignedToMe && !t.isComplete && t.date >= data.todayDate && t.date <= in7Str)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data?.calendarTasks, data?.todayDate]);

  const firstName = data?.userName?.split(' ')[0] || auth.user?.name?.split(' ')[0] || '';
  const jobOverdueCount = data?.jobOverdueTasks?.length || 0;
  const myOverdueCount = data?.myOverdueTasks?.length || 0;
  const myUpcomingCount = data?.myUpcomingTasks?.length || 0;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <Loader2 size={20} className="animate-spin" style={{ color: '#CDA274' }} />
    </div>
  );
  if (error || !data) return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error || 'Something went wrong'}</p>
      <button onClick={() => fetchData()} style={{ background: '#CDA274', color: '#1a1a1a', fontSize: 12, padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer' }}>Retry</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 8px', position: 'relative' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ color: '#e8e0d8', fontSize: 18, fontWeight: 700, margin: 0 }}>{getGreeting()}, {firstName}</h1>
        <button onClick={() => fetchData(true)} disabled={refreshing} style={{ padding: 5, borderRadius: 6, background: 'rgba(205,162,116,0.08)', border: 'none', cursor: 'pointer', lineHeight: 0 }}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} style={{ color: '#CDA274' }} />
        </button>
      </div>

      {/* INLINE ASK AGENT */}
      <InlineAskAgent pmJobs={data.pmJobs || []} />

      {/* KPI METRICS */}
      {data.kpis && (() => {
        const k = data.kpis;
        const adherenceColor = k.scheduleAdherence === null ? '#5a5550' : k.scheduleAdherence >= 75 ? '#22c55e' : k.scheduleAdherence >= 50 ? '#eab308' : '#ef4444';
        const avgOdColor = k.avgDaysOverdue <= 7 ? '#22c55e' : k.avgDaysOverdue <= 21 ? '#eab308' : '#ef4444';
        const staleColor = k.staleTaskCount === 0 ? '#22c55e' : k.staleTaskCount <= 3 ? '#eab308' : '#ef4444';
        const trendIcon = k.completionTrend > 0 ? <TrendingUp size={9} /> : k.completionTrend < 0 ? <TrendingDown size={9} /> : <Minus size={9} />;
        const trendColor = k.completionTrend > 0 ? '#22c55e' : k.completionTrend < 0 ? '#ef4444' : '#5a5550';
        const densityPct = k.tasksNext30 > 0 ? Math.round((k.tasksNext7 / k.tasksNext30) * 100) : 0;
        const densityColor = densityPct > 60 ? '#ef4444' : densityPct > 35 ? '#eab308' : '#22c55e';

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 6 }}>
            {/* KPI 1: Schedule Adherence */}
            <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${adherenceColor}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <Target size={9} style={{ color: adherenceColor }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>ON-TRACK</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: adherenceColor, lineHeight: 1 }}>
                {k.scheduleAdherence !== null ? `${k.scheduleAdherence}%` : '—'}
              </div>
              <div style={{ fontSize: 7, color: '#4a4a4a', marginTop: 2 }}>
                {k.totalCompletedLast30} tasks complete
              </div>
            </div>

            {/* KPI 2: Avg Days Overdue */}
            <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${avgOdColor}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <Clock3 size={9} style={{ color: avgOdColor }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>AVG OVERDUE</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: avgOdColor, lineHeight: 1 }}>
                {k.avgDaysOverdue > 0 ? `${k.avgDaysOverdue}d` : '0'}
              </div>
              <div style={{ fontSize: 7, color: '#4a4a4a', marginTop: 2 }}>
                across {k.overdueTaskCount} tasks
              </div>
            </div>

            {/* KPI 3: Stale Tasks */}
            <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${staleColor}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <AlertTriangle size={9} style={{ color: staleColor }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>STALE</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: staleColor, lineHeight: 1 }}>
                {k.staleTaskCount}
              </div>
              <div style={{ fontSize: 7, color: '#4a4a4a', marginTop: 2 }}>
                30+ days, no progress
              </div>
            </div>

            {/* KPI 4: Completed This Week */}
            <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid #3b82f6` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <Activity size={9} style={{ color: '#3b82f6' }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>DONE / WK</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6', lineHeight: 1 }}>
                {k.completedThisWeek}
              </div>
              <div style={{ fontSize: 7, color: trendColor, marginTop: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                {trendIcon} {k.completionTrend > 0 ? '+' : ''}{k.completionTrend} vs last wk
              </div>
            </div>

            {/* KPI 5: Upcoming Density */}
            <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${densityColor}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <CalendarDays size={9} style={{ color: densityColor }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>DENSITY</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: densityColor, lineHeight: 1 }}>
                {k.tasksNext7}
              </div>
              <div style={{ fontSize: 7, color: '#4a4a4a', marginTop: 2 }}>
                of {k.tasksNext30} due in 30d
              </div>
            </div>
          </div>
        );
      })()}

      {/* CHANGE ORDER TRACKER */}
      {data.changeOrders && data.changeOrders.length > 0 && (
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 600, margin: 0 }}>
              Change Order Tracker
            </h3>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>
              {data.changeOrders.filter(co => co.documentStatus !== 'approved').length} pending
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.changeOrders.map((co, idx) => {
              const statusConfig: Record<string, { label: string; color: string; bg: string; icon: any }> = {
                needs_document: { label: 'Needs Document', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: FileWarning },
                draft: { label: 'Draft', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', icon: FileClock },
                sent: { label: 'Sent', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', icon: Send },
                approved: { label: 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.1)', icon: FileCheck },
                declined: { label: 'Declined', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', icon: XCircle },
              };
              const config = statusConfig[co.documentStatus] || statusConfig.draft;
              const IconComp = config.icon;
              return (
                <div key={idx} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: co.isStale && co.documentStatus !== 'approved' ? 'rgba(245,158,11,0.05)' : '#0f172a',
                  borderRadius: 8, padding: '10px 14px',
                  borderLeft: `3px solid ${config.color}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {co.coName}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                      {co.jobName} #{co.jobNumber}
                    </div>
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: config.bg, borderRadius: 12, padding: '4px 10px',
                    ...(co.isStale && co.documentStatus !== 'approved' && co.documentStatus !== 'sent' ? { animation: 'pulse 2s infinite' } : {}),
                  }}>
                    <IconComp size={12} color={config.color} />
                    <span style={{ color: config.color, fontSize: 11, fontWeight: 600 }}>{config.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* THREE TASK CARDS: Job Overdue | My Overdue | Open Tasks */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {/* Job Overdue */}
        <button
          onClick={() => jobOverdueCount > 0 && setShowTasks(showTasks === 'jobOverdue' ? false : 'jobOverdue')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 8px', borderRadius: 8, border: 'none', cursor: jobOverdueCount > 0 ? 'pointer' : 'default',
            background: jobOverdueCount > 0 ? 'rgba(249,115,22,0.07)' : '#1e1e1e',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: jobOverdueCount > 0 ? 'rgba(249,115,22,0.18)' : 'rgba(205,162,116,0.06)',
            textAlign: 'left',
          }}
        >
          <Briefcase size={12} style={{ color: jobOverdueCount > 0 ? '#f97316' : '#3a3a3a', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: jobOverdueCount > 0 ? '#f97316' : '#3a3a3a', lineHeight: 1 }}>{jobOverdueCount}</div>
            <div style={{ fontSize: 8, color: '#6a6058', marginTop: 1, whiteSpace: 'nowrap' }}>Job Overdue</div>
          </div>
          {jobOverdueCount > 0 && (showTasks === 'jobOverdue' ? <ChevronUp size={11} style={{ color: '#6a6058' }} /> : <ChevronDown size={11} style={{ color: '#6a6058' }} />)}
        </button>

        {/* My Overdue */}
        <button
          onClick={() => myOverdueCount > 0 && setShowTasks(showTasks === 'myOverdue' ? false : 'myOverdue')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 8px', borderRadius: 8, border: 'none', cursor: myOverdueCount > 0 ? 'pointer' : 'default',
            background: myOverdueCount > 0 ? 'rgba(239,68,68,0.07)' : '#1e1e1e',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: myOverdueCount > 0 ? 'rgba(239,68,68,0.18)' : 'rgba(205,162,116,0.06)',
            textAlign: 'left',
          }}
        >
          <AlertTriangle size={12} style={{ color: myOverdueCount > 0 ? '#ef4444' : '#3a3a3a', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: myOverdueCount > 0 ? '#ef4444' : '#3a3a3a', lineHeight: 1 }}>{myOverdueCount}</div>
            <div style={{ fontSize: 8, color: '#6a6058', marginTop: 1, whiteSpace: 'nowrap' }}>My Overdue</div>
          </div>
          {myOverdueCount > 0 && (showTasks === 'myOverdue' ? <ChevronUp size={11} style={{ color: '#6a6058' }} /> : <ChevronDown size={11} style={{ color: '#6a6058' }} />)}
        </button>

        {/* My Upcoming */}
        <button
          onClick={() => myUpcomingCount > 0 && setShowTasks(showTasks === 'upcoming' ? false : 'upcoming')}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 8px', borderRadius: 8, border: 'none', cursor: myUpcomingCount > 0 ? 'pointer' : 'default',
            background: '#1e1e1e', textAlign: 'left',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: 'rgba(205,162,116,0.08)',
          }}
        >
          <ClipboardList size={12} style={{ color: '#CDA274', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#CDA274', lineHeight: 1 }}>{myUpcomingCount}</div>
            <div style={{ fontSize: 8, color: '#6a6058', marginTop: 1, whiteSpace: 'nowrap' }}>My Upcoming</div>
          </div>
          {myUpcomingCount > 0 && (showTasks === 'upcoming' ? <ChevronUp size={11} style={{ color: '#6a6058' }} /> : <ChevronDown size={11} style={{ color: '#6a6058' }} />)}
        </button>
      </div>

      {/* Expanded task list */}
      {showTasks && (
        <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 6, maxHeight: 200, overflowY: 'auto' }}>
          {showTasks === 'jobOverdue' && data.jobOverdueTasks.map(t => {
            const days = Math.floor((new Date(data.todayDate + 'T12:00:00').getTime() - new Date(t.date + 'T12:00:00').getTime()) / 86400000);
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid rgba(205,162,116,0.04)', fontSize: 11 }}>
                <button onClick={() => toggleComplete(t.id, false)} disabled={completing.has(t.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, flexShrink: 0 }}>
                  {completing.has(t.id)
                    ? <Loader2 size={13} className="animate-spin" style={{ color: '#6a6058' }} />
                    : <Circle size={13} style={{ color: '#f97316' }} />
                  }
                </button>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: jobColor(t.jobNumber), flexShrink: 0 }} />
                <a href={jtScheduleUrl(t.jobId)} target="_blank" rel="noopener noreferrer" style={{ flex: 1, overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column', textDecoration: 'none' }}>
                  <div style={{ color: '#e8e0d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '14px' }}>{t.name}</div>
                  <div style={{ color: '#5a5550', fontSize: 9, lineHeight: '12px' }}>{t.jobName}{t.isAssignedToMe ? ' · assigned to you' : ''}</div>
                </a>
                <span style={{ color: '#f97316', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{days}d</span>
              </div>
            );
          })}
          {showTasks === 'myOverdue' && data.myOverdueTasks.map(t => {
            const days = Math.floor((new Date(data.todayDate + 'T12:00:00').getTime() - new Date(t.date + 'T12:00:00').getTime()) / 86400000);
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid rgba(205,162,116,0.04)', fontSize: 11 }}>
                <button onClick={() => toggleComplete(t.id, false)} disabled={completing.has(t.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, flexShrink: 0 }}>
                  {completing.has(t.id)
                    ? <Loader2 size={13} className="animate-spin" style={{ color: '#6a6058' }} />
                    : <Circle size={13} style={{ color: '#ef4444' }} />
                  }
                </button>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: jobColor(t.jobNumber), flexShrink: 0 }} />
                <a href={jtScheduleUrl(t.jobId)} target="_blank" rel="noopener noreferrer" style={{ flex: 1, overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column', textDecoration: 'none' }}>
                  <div style={{ color: '#e8e0d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '14px' }}>{t.name}</div>
                  <div style={{ color: '#5a5550', fontSize: 9, lineHeight: '12px' }}>{t.jobName}</div>
                </a>
                <span style={{ color: '#ef4444', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{days}d</span>
              </div>
            );
          })}
          {showTasks === 'upcoming' && data.myUpcomingTasks.map(t => {
            const lbl = !t.endDate ? '' : t.endDate === data.todayDate ? 'Today'
              : (() => { const d = Math.floor((new Date(t.endDate + 'T12:00:00').getTime() - new Date(data.todayDate + 'T12:00:00').getTime()) / 86400000); return d === 1 ? 'Tomorrow' : d <= 0 ? 'Today' : `${d}d`; })();
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid rgba(205,162,116,0.04)', fontSize: 11 }}>
                <button onClick={() => toggleComplete(t.id, false)} disabled={completing.has(t.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, flexShrink: 0 }}>
                  {completing.has(t.id)
                    ? <Loader2 size={13} className="animate-spin" style={{ color: '#6a6058' }} />
                    : <Circle size={13} style={{ color: '#CDA274' }} />
                  }
                </button>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: jobColor(t.jobNumber), flexShrink: 0 }} />
                <a href={jtScheduleUrl(t.jobId)} target="_blank" rel="noopener noreferrer" style={{ flex: 1, overflow: 'hidden', minWidth: 0, display: 'flex', flexDirection: 'column', textDecoration: 'none' }}>
                  <div style={{ color: '#e8e0d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '14px' }}>{t.name}</div>
                  <div style={{ color: '#5a5550', fontSize: 9, lineHeight: '12px' }}>{t.jobName}</div>
                </a>
                <span style={{ color: t.endDate === data.todayDate ? '#eab308' : '#5a5550', fontSize: 10, fontWeight: 500, flexShrink: 0 }}>{lbl}</span>
              </div>
            );
          })}
          {((showTasks === 'jobOverdue' && jobOverdueCount === 0) || (showTasks === 'myOverdue' && myOverdueCount === 0) || (showTasks === 'upcoming' && myUpcomingCount === 0)) && (
            <p style={{ color: '#5a5550', fontSize: 11, textAlign: 'center', padding: 8 }}>None</p>
          )}
        </div>
      )}

      {/* ASSIGNED TASKS - NEXT 7 DAYS HIGHLIGHT */}
      {myNext7Days.length > 0 && (
        <div style={{
          background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
          borderRadius: 8, padding: '8px 10px', marginBottom: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
            <CalendarDays size={11} style={{ color: '#3b82f6' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: '#3b82f6', letterSpacing: '0.06em' }}>YOUR TASKS THIS WEEK</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {myNext7Days.map(t => {
              const c = jobColor(t.jobNumber);
              const dayLabel = t.date === data.todayDate ? 'Today'
                : t.date === new Date(new Date(data.todayDate + 'T12:00:00').getTime() + 86400000).toISOString().split('T')[0] ? 'Tomorrow'
                : new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              return (
                <a key={t.id} href={jtScheduleUrl(t.jobId)} target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 6px', borderRadius: 5,
                    background: 'rgba(59,130,246,0.06)',
                    textDecoration: 'none', fontSize: 11,
                  }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: c, flexShrink: 0 }} />
                  <span style={{ color: '#e8e0d8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <span style={{ color: '#6a8ab5', fontSize: 9, flexShrink: 0 }}>{t.jobName.replace(/^#\d+\s*/, '')}</span>
                  <span style={{ color: '#3b82f6', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{dayLabel}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* WEATHER FORECAST STRIP */}
      {data.weather && data.weather.length > 0 && (() => {
        // WMO weather code to icon + label
        function weatherIcon(code: number, size = 12) {
          if (code <= 1) return <Sun size={size} style={{ color: '#eab308' }} />;
          if (code <= 3) return <Cloud size={size} style={{ color: '#9ca3af' }} />;
          if (code <= 48) return <CloudFog size={size} style={{ color: '#9ca3af' }} />;
          if (code <= 57) return <CloudDrizzle size={size} style={{ color: '#60a5fa' }} />;
          if (code <= 67) return <CloudRain size={size} style={{ color: '#3b82f6' }} />;
          if (code <= 77) return <CloudSnow size={size} style={{ color: '#c4b5fd' }} />;
          if (code <= 82) return <CloudRain size={size} style={{ color: '#2563eb' }} />;
          if (code <= 86) return <CloudSnow size={size} style={{ color: '#a78bfa' }} />;
          if (code <= 99) return <CloudLightning size={size} style={{ color: '#f59e0b' }} />;
          return <Cloud size={size} style={{ color: '#9ca3af' }} />;
        }
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        return (
          <div style={{ marginBottom: 6, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(205,162,116,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'rgba(205,162,116,0.04)' }}>
              <Sun size={10} style={{ color: '#eab308' }} />
              <span style={{ fontSize: 8, fontWeight: 700, color: '#5a5550', letterSpacing: '0.06em' }}>PERKASIE FORECAST</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(data.weather.length, 10)}, 1fr)`, gap: 0 }}>
              {data.weather.slice(0, 10).map((w, i) => {
                const dt = new Date(w.date + 'T12:00:00');
                const isToday = w.date === data.todayDate;
                const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
                const rainWarning = w.precipChance >= 50;
                return (
                  <div key={w.date} style={{
                    padding: '5px 2px', textAlign: 'center',
                    background: isToday ? 'rgba(205,162,116,0.1)' : rainWarning ? 'rgba(59,130,246,0.04)' : '#1a1a1a',
                    borderRight: i < data.weather.length - 1 ? '1px solid rgba(205,162,116,0.04)' : 'none',
                  }}>
                    <div style={{ fontSize: 8, fontWeight: 600, color: isToday ? '#CDA274' : isWeekend ? '#3a3a3a' : '#5a5550', marginBottom: 2 }}>
                      {isToday ? 'Today' : dayNames[dt.getDay()]}
                    </div>
                    <div style={{ margin: '2px 0' }}>{weatherIcon(w.code, 14)}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#e8e0d8', lineHeight: 1.2 }}>{w.high}°</div>
                    <div style={{ fontSize: 8, color: '#4a4a4a' }}>{w.low}°</div>
                    {w.precipChance > 10 && (
                      <div style={{ fontSize: 7, color: w.precipChance >= 50 ? '#3b82f6' : '#5a5550', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, marginTop: 1 }}>
                        <Droplets size={6} /> {w.precipChance}%
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* WEEK CALENDARS — shown before My Jobs */}
      {weeks.map((week, wi) => (
        <div key={wi} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <Calendar size={11} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#5a5550' }}>{week.label.toUpperCase()}</span>
            <span style={{ fontSize: 10, color: '#3f3f3f' }}>{week.days[0].month} {week.days[0].dayNum} – {week.days[6].month} {week.days[6].dayNum}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, borderRadius: 8, overflow: 'hidden' }}>
            {week.days.map(day => {
              const isToday = day.date === data.todayDate;
              const tasks = tasksByDate[day.date] || [];
              const incomplete = tasks.filter(t => !t.isComplete);
              const complete = tasks.filter(t => t.isComplete);
              const isWeek1 = wi === 0;

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
                      const highlighted = task.isAssignedToMe && isWeek1;
                      const isBeingCompleted = completing.has(task.id);
                      const isSelected = selectedTask?.id === task.id;
                      return (
                        <div key={task.id} style={{ position: 'relative' }}>
                          <div
                            onClick={() => {
                              setSelectedTask(isSelected ? null : task);
                              setEditingDate(task.endDate || task.date);
                            }}
                            style={{
                              padding: '2px 3px', borderRadius: 3, cursor: 'pointer',
                              borderLeft: `3px solid ${c}`,
                              background: isSelected ? `${c}50` : highlighted ? `${c}35` : `${c}18`,
                              fontSize: 9, lineHeight: '12px', color: '#e8e0d8',
                              display: 'flex', alignItems: 'center', gap: 2,
                              opacity: isBeingCompleted ? 0.4 : 1,
                              ...(highlighted ? { boxShadow: `inset 0 0 0 1px ${c}50` } : {}),
                            }}>
                            {task.isAssignedToMe && (
                              <button onClick={(e) => { e.stopPropagation(); toggleComplete(task.id, false); }} disabled={isBeingCompleted}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, flexShrink: 0 }}>
                                {isBeingCompleted
                                  ? <Loader2 size={9} className="animate-spin" style={{ color: '#6a6058' }} />
                                  : <Circle size={9} style={{ color: c }} />
                                }
                              </button>
                            )}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{task.name}</span>
                          </div>
                        </div>
                      );
                    })}
                    {complete.length > 0 && (
                      <div style={{ fontSize: 8, color: '#3a3a3a', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Check size={7} style={{ color: '#22c55e' }} /> {complete.length} done
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* PM JOBS - condensed clickable list */}
      {data.pmJobs && data.pmJobs.length > 0 && (
        <div style={{ background: 'rgba(205,162,116,0.04)', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <Briefcase size={10} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: '#CDA274', letterSpacing: '0.06em' }}>MY JOBS</span>
            <span style={{ fontSize: 9, color: '#4a4a4a' }}>({data.pmJobs.length})</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {data.pmJobs.map(job => (
              <a
                key={job.id}
                href={jtScheduleUrl(job.id)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 7px', borderRadius: 5,
                  background: 'rgba(205,162,116,0.06)',
                  border: '1px solid rgba(205,162,116,0.1)',
                  textDecoration: 'none', fontSize: 10, color: '#c0b8a8',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(205,162,116,0.15)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(205,162,116,0.06)')}
              >
                <span style={{ width: 5, height: 5, borderRadius: 3, background: jobColor(job.number), flexShrink: 0 }} />
                <span style={{ whiteSpace: 'nowrap' }}>{job.name.replace(/^#\d+\s*/, '')}</span>
                <ExternalLink size={8} style={{ color: '#5a5550', flexShrink: 0 }} />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* TASK DETAIL POPUP */}
      {selectedTask && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => setSelectedTask(null)}>
          <div ref={popupRef} onClick={e => e.stopPropagation()} style={{
            background: '#252525', borderRadius: 12, padding: 16, minWidth: 280, maxWidth: 360,
            border: '1px solid rgba(205,162,116,0.15)', boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e8e0d8', lineHeight: '18px' }}>{selectedTask.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: jobColor(selectedTask.jobNumber), flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: '#8a8078' }}>#{selectedTask.jobNumber} {selectedTask.jobName}</span>
                </div>
              </div>
              <button onClick={() => setSelectedTask(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                <X size={14} style={{ color: '#6a6058' }} />
              </button>
            </div>

            {/* Date edit */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 4 }}>DUE DATE</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="date"
                  value={editingDate}
                  onChange={e => setEditingDate(e.target.value)}
                  style={{
                    flex: 1, background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 6,
                    color: '#e8e0d8', fontSize: 12, padding: '5px 8px',
                    colorScheme: 'dark',
                  }}
                />
                {editingDate !== (selectedTask.endDate || selectedTask.date) && (
                  <button onClick={saveDate} disabled={savingDate}
                    style={{
                      background: '#CDA274', color: '#1a1a1a', fontSize: 11, fontWeight: 600,
                      padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      opacity: savingDate ? 0.5 : 1,
                    }}>
                    {savingDate ? 'Saving...' : 'Save'}
                  </button>
                )}
              </div>
            </div>

            {/* Assignment info */}
            {selectedTask.isAssignedToMe && (
              <div style={{ fontSize: 10, color: '#CDA274', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={10} /> Assigned to you
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => toggleComplete(selectedTask.id, selectedTask.isComplete)}
                disabled={completing.has(selectedTask.id)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: selectedTask.isComplete ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                  color: selectedTask.isComplete ? '#ef4444' : '#22c55e',
                  opacity: completing.has(selectedTask.id) ? 0.5 : 1,
                }}>
                {completing.has(selectedTask.id)
                  ? <Loader2 size={13} className="animate-spin" />
                  : selectedTask.isComplete
                    ? <><X size={13} /> Reopen</>
                    : <><Check size={13} /> Mark Complete</>
                }
              </button>
              <a
                href={jtScheduleUrl(selectedTask.jobId)}
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

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

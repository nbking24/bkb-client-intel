'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  AlertTriangle, Clock, CheckCircle2, Loader2,
  RefreshCw, Calendar, MessageSquare, Zap,
  DollarSign, ClipboardList,
  ChevronUp, ChevronDown, TrendingUp, TrendingDown, Minus,
  Target, Clock3, Activity, CalendarDays, Building2,
  FileCheck, FileWarning, FileClock, XCircle, Send,
  X, ExternalLink, Check, Bot, User, CheckCircle,
  Paperclip, ImageIcon, X as XIcon, Plus, Search,
  Hourglass, ChevronRight, Mail, Receipt
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import {
  formatContent,
  type ChatMessage,
  type TaskConfirmData,
  type COProposalData,
  type ActionConfirmData,
} from '@/app/hooks/useAskAgent';


function getToken() { return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : ''; }
function getAuthToken() {
  const pin = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_APP_PIN || '') : '';
  return btoa(pin + ':');
}

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
    id: string; name: string; description?: string; jobId: string; jobName: string; jobNumber: string;
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
// Searchable Job Dropdown (type-ahead, A-Z sorted)
// ============================================================

function JobSearchDropdown({ jobs, value, onChange, placeholder = 'Search jobs...', formatLabel }: {
  jobs: Array<{ id: string; name: string; number: string }>;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  formatLabel?: (j: { id: string; name: string; number: string }) => string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const label = formatLabel || ((j: { id: string; name: string; number: string }) => `#${j.number} ${j.name}`);

  // Sort jobs A-Z by name, then filter by search
  const sorted = useMemo(() =>
    [...(jobs || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [jobs]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(j => j.name.toLowerCase().includes(q) || j.number.toLowerCase().includes(q));
  }, [sorted, search]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedJob = sorted.find(j => j.id === value);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 50); }}
        style={{
          width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)',
          borderRadius: 5, color: value ? '#c88c00' : '#5a5550', fontSize: 13,
          padding: '7px 8px', cursor: 'pointer', boxSizing: 'border-box' as const,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
          minHeight: 32,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
          {selectedJob ? label(selectedJob) : placeholder.replace('Search ', 'Select ')}
        </span>
        <ChevronDown size={13} style={{ color: '#5a5550', flexShrink: 0 }} />
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
          background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.2)',
          borderRadius: 6, marginTop: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          maxHeight: 220, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(200,140,0,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Search size={13} style={{ color: '#5a5550', flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={placeholder}
              autoFocus
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: '#2a2520', fontSize: 13, padding: 0,
              }}
            />
            {search && (
              <button onClick={(e) => { e.stopPropagation(); setSearch(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0 }}>
                <X size={12} style={{ color: '#5a5550' }} />
              </button>
            )}
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 180 }}>
            {value && (
              <div
                onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
                style={{
                  padding: '6px 10px', fontSize: 13, color: '#5a5550', cursor: 'pointer',
                  borderBottom: '1px solid rgba(200,140,0,0.05)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(200,140,0,0.06)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Clear selection
              </div>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: '12px 10px', fontSize: 13, color: '#5a5550', textAlign: 'center' as const }}>
                No jobs match &ldquo;{search}&rdquo;
              </div>
            ) : (
              filtered.map(j => (
                <div
                  key={j.id}
                  onClick={() => { onChange(j.id); setOpen(false); setSearch(''); }}
                  style={{
                    padding: '6px 10px', fontSize: 13, cursor: 'pointer',
                    color: j.id === value ? '#c88c00' : '#3a3530',
                    background: j.id === value ? 'rgba(200,140,0,0.08)' : 'transparent',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(200,140,0,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.background = j.id === value ? 'rgba(200,140,0,0.08)' : 'transparent')}
                >
                  {label(j)}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Inline Ask Agent Chat
// ============================================================

function RenderContent({ content }: { content: string }) {
  const elements = formatContent(content);
  return (
    <>
      {(elements as any[]).map((el: any) => {
        if (el.type === 'code') {
          return (
            <pre key={el.key} style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)', borderRadius: 6, padding: '6px 8px', fontSize: 13, color: '#3a3530', overflowX: 'auto', whiteSpace: 'pre-wrap', margin: '4px 0', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{el.content}</pre>
          );
        }
        if (el.type === 'h2') return <div key={el.key} style={{ fontWeight: 700, color: '#c88c00', fontSize: 15, marginTop: 6, marginBottom: 2 }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'h3') return <div key={el.key} style={{ fontWeight: 600, color: '#1a1a1a', fontSize: 14, marginTop: 4, marginBottom: 1 }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'bullet') return <div key={el.key} style={{ marginLeft: 10 }} dangerouslySetInnerHTML={{ __html: '&bull; ' + el.html }} />;
        if (el.type === 'numbered') return <div key={el.key} style={{ marginLeft: 10 }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'hr') return <hr key={el.key} style={{ border: 'none', borderTop: '1px solid rgba(200,140,0,0.1)', margin: '6px 0' }} />;
        if (el.type === 'spacer') return <div key={el.key} style={{ height: 4 }} />;
        return <div key={el.key} dangerouslySetInnerHTML={{ __html: el.html }} />;
      })}
    </>
  );
}

function InlineAskAgent({ pmJobs, screen, hideToggle, defaultOpen }: { pmJobs: { id: string; name: string; number: string }[]; screen: 'mobile' | 'tablet' | 'desktop'; hideToggle?: boolean; defaultOpen?: boolean }) {
  const isMobile = screen === 'mobile';
  const isTouch = screen !== 'desktop';
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastAgent, setLastAgent] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [agentMode, setAgentMode] = useState<'general' | 'change-order' | 'specs'>('general');
  const [phaseEdit, setPhaseEdit] = useState<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<Array<{ file: File; preview: string }>>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Only auto-scroll when there are actual messages (not on initial render)
  const hasMessages = messages.length > 0 || loading;
  useEffect(() => {
    if (hasMessages) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [messages, loading, hasMessages]);

  // Focus input without scrolling the page
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 100);
  }, [open]);

  const selectedJob = useMemo(() => pmJobs.find(j => j.id === selectedJobId) || null, [pmJobs, selectedJobId]);

  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newImages = files.slice(0, 10 - attachedImages.length).map(file => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setAttachedImages(prev => [...prev, ...newImages]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (idx: number) => {
    setAttachedImages(prev => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const sendMessage = useCallback(async (userMsg: string) => {
    if (!userMsg.trim() || loading) return;

    let allImageUrls = [...uploadedUrls];
    if (attachedImages.length > 0) {
      setUploading(true);
      try {
        const formData = new FormData();
        for (const img of attachedImages) formData.append('files', img.file);
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${getAuthToken()}` },
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          const newUrls = (data.uploaded || []).map((u: any) => u.url);
          allImageUrls = [...allImageUrls, ...newUrls];
          setUploadedUrls(allImageUrls);
        }
      } catch (err) {
        console.error('Image upload error:', err);
      } finally {
        attachedImages.forEach(img => URL.revokeObjectURL(img.preview));
        setAttachedImages([]);
        setUploading(false);
      }
    }

    let messageForApi = userMsg;
    const contextParts: string[] = [];
    if (agentMode === 'change-order') {
      contextParts.push('MODE: CHANGE ORDER SUBMISSION. The user is submitting a change order. Follow the CO submission flow â ask targeted questions, gather all details, then output a @@CO_PROPOSAL@@ for approval.');
    } else if (agentMode === 'specs') {
      contextParts.push('MODE: SPECS ONLY. The user is asking about approved specifications. ONLY answer based on approved documents and specs for this job. Do NOT offer to create change orders, tasks, or modifications â just provide spec information from approved documents.');
    }
    if (selectedJob) {
      contextParts.push(`The user has selected job "${selectedJob.name}" (#${selectedJob.number}, ID: ${selectedJob.id}). Use this as the target job for their question.`);
    }
    if (allImageUrls.length > 0) {
      contextParts.push(`The user has uploaded ${allImageUrls.length} photo(s) for this change order. Image URLs: ${JSON.stringify(allImageUrls)}. Include these as imageUrls in any @@CO_PROPOSAL@@ you create.`);
    }
    if (contextParts.length > 0) {
      messageForApi = `[Context: ${contextParts.join(' ')}]\n\n${userMsg}`;
    }

    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const allMessages = [
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: messageForApi },
      ];

      // Map UI agent mode to API agent name for forced routing
      const forcedAgentMap: Record<string, string> = {
        'general': 'know-it-all',
        'change-order': 'know-it-all',  // CO mode uses context injection, same base agent
        'specs': 'project-details',
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: allMessages,
          lastAgent: lastAgent || undefined,
          forcedAgent: forcedAgentMap[agentMode] || 'know-it-all',
          ...(selectedJob ? { jtJobId: selectedJob.id } : {}),
        }),
      });

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`;
        try { const errData = await response.json(); errorMsg = errData.error || errorMsg; } catch {
          try { const text = await response.text(); errorMsg = text.includes('FUNCTION_INVOCATION_TIMEOUT') ? 'Request timed out â try a more specific question.' : (text.substring(0, 200) || 'Request failed'); } catch { errorMsg = 'Request failed'; }
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
          coProposal: data.coProposal || undefined,
          actionConfirm: data.actionConfirm || undefined,
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
      confirmMsg += '\n\n[APPROVED TASK DATA â execute this now using create_phase_task tool]\n' + JSON.stringify(mergedData);
    }
    await sendMessage(confirmMsg);
  };

  const handleDecline = () => {
    setMessages(prev => [
      ...prev.map((m, i) => i === prev.length - 1 ? { ...m, needsConfirmation: false } : m),
      { role: 'user', content: 'No, cancel that.' },
      { role: 'assistant', content: 'No problem â action cancelled.' },
    ]);
  };

  /* Approve a generic JobTread write (comment, daily log, update, delete, etc.) proposed via @@ACTION_CONFIRM@@. */
  const handleActionApprove = async () => {
    const lastMsg = messages[messages.length - 1];
    const action = lastMsg?.actionConfirm;
    setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, needsConfirmation: false } : m));
    if (!action) return;
    const confirmMsg =
      'Approved.\n\n[APPROVED ACTION - execute tool "' + action.tool + '" with the payload below]\n' +
      JSON.stringify({ tool: action.tool, title: action.title, summary: action.summary, payload: action.payload });
    await sendMessage(confirmMsg);
  };

  const lastMsgNeedsConfirm = messages.length > 0 && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].needsConfirmation && !loading;

  const handleModeChange = (mode: 'general' | 'change-order' | 'specs') => {
    setAgentMode(mode);
    setMessages([]);
    setLastAgent(null);
    setUploadedUrls([]);
    attachedImages.forEach(img => URL.revokeObjectURL(img.preview));
    setAttachedImages([]);
    setQuery('');
  };

  return (
    <div style={{ marginBottom: 6, borderRadius: 8, border: '1px solid rgba(200,140,0,0.12)', overflow: 'hidden', background: '#ffffff' }}>
      {/* Toggle Bar */}
      {!hideToggle && <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: isTouch ? 8 : 6,
          padding: isTouch ? '10px 12px' : '7px 10px', background: open ? 'rgba(200,140,0,0.08)' : 'transparent',
          border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ width: isTouch ? 28 : 22, height: isTouch ? 28 : 22, borderRadius: 14, background: 'rgba(200,140,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Bot size={isTouch ? 15 : 12} style={{ color: '#c88c00' }} />
        </div>
        <span style={{ flex: 1, fontSize: isTouch ? 14 : 12, fontWeight: 600, color: '#c88c00' }}>Ask Agent</span>
        {!isMobile && <span style={{ fontSize: isTouch ? 11 : 9, color: '#5a5550' }}>Tasks Â· Specs Â· Change Orders</span>}
        {open ? <ChevronUp size={isTouch ? 16 : 12} style={{ color: '#5a5550' }} /> : <ChevronDown size={isTouch ? 16 : 12} style={{ color: '#5a5550' }} />}
      </button>}

      {/* Chat Body */}
      {open && (
        <div style={{ borderTop: '1px solid rgba(200,140,0,0.08)' }}>
          {/* Mode Selector + Job Selector */}
          <div style={{ padding: isTouch ? '8px 12px' : '8px 12px', borderBottom: '1px solid rgba(200,140,0,0.06)', display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap', alignItems: 'center', gap: isTouch ? 8 : 8 }}>
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(200,140,0,0.15)', flexShrink: 0, ...(isMobile ? { width: '100%' } : {}) }}>
              {([
                { key: 'general', label: 'Agent' },
                { key: 'change-order', label: 'Change Order' },
                { key: 'specs', label: 'Specs' },
              ] as const).map((mode, idx) => (
                <button
                  key={mode.key}
                  onClick={() => handleModeChange(mode.key)}
                  style={{
                    padding: isTouch ? '8px 14px' : '6px 14px',
                    fontSize: isTouch ? 13 : 12,
                    fontWeight: 600, border: 'none', cursor: 'pointer',
                    ...(isMobile ? { flex: 1 } : {}),
                    ...(idx > 0 ? { borderLeft: '1px solid rgba(200,140,0,0.15)' } : {}),
                    background: agentMode === mode.key ? 'rgba(200,140,0,0.2)' : 'transparent',
                    color: agentMode === mode.key ? '#c88c00' : '#5a5550',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, ...(isMobile ? { width: '100%' } : {}) }}>
              <JobSearchDropdown
                jobs={pmJobs}
                value={selectedJobId}
                onChange={setSelectedJobId}
                placeholder="Search jobs..."
                formatLabel={j => `#${j.number} ${j.name}`}
              />
            </div>
            {messages.length > 0 && (
              <button onClick={() => { setMessages([]); setLastAgent(null); setUploadedUrls([]); }} style={{ fontSize: isTouch ? 12 : 9, color: '#5a5550', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: isTouch ? '6px 4px' : 0 }}>Clear</button>
            )}
          </div>

          {/* Messages */}
          <div style={{ maxHeight: isMobile ? 400 : isTouch ? 360 : 480, overflowY: 'auto', padding: isTouch ? '8px 12px' : '8px 12px' }}>
            {messages.length === 0 && !loading && (
              <div style={{ padding: isTouch ? '12px 0' : '16px 0', textAlign: 'center' }}>
                <p style={{ fontSize: isTouch ? 13 : 13, color: '#5a5550', marginBottom: 4 }}>
                  {agentMode === 'general' && 'Ask about tasks, schedules, or anything on this job'}
                  {agentMode === 'change-order' && 'Describe the change â I\'ll ask questions and build the CO'}
                  {agentMode === 'specs' && 'Ask about approved specs for this job'}
                </p>
                {agentMode === 'change-order' && (
                  <p style={{ fontSize: isTouch ? 11 : 9, color: '#8a8078', marginTop: 4 }}>
                    Use the <Paperclip size={isTouch ? 12 : 9} style={{ display: 'inline', verticalAlign: 'middle', color: '#c88c00' }} /> button to attach photos
                  </p>
                )}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{ marginBottom: isTouch ? 10 : 6 }}>
                <div style={{ display: 'flex', gap: isTouch ? 8 : 6, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {msg.role === 'assistant' && (
                    <div style={{ width: isTouch ? 24 : 18, height: isTouch ? 24 : 18, borderRadius: 12, background: 'rgba(200,140,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                      <Bot size={isTouch ? 13 : 10} style={{ color: '#c88c00' }} />
                    </div>
                  )}
                  <div style={{
                    maxWidth: isMobile ? '90%' : '85%', padding: isTouch ? '8px 12px' : '8px 12px', borderRadius: isTouch ? 10 : 8, fontSize: isTouch ? 14 : 13, lineHeight: isTouch ? '20px' : '20px',
                    ...(msg.role === 'user'
                      ? { background: 'rgba(200,140,0,0.15)', color: '#1a1a1a' }
                      : { background: '#f8f6f3', color: '#1a1a1a', border: '1px solid rgba(200,140,0,0.06)' }),
                  }}>
                    {msg.role === 'assistant' ? <RenderContent content={msg.content} /> : msg.content}
                  </div>
                  {msg.role === 'user' && (
                    <div style={{ width: isTouch ? 24 : 18, height: isTouch ? 24 : 18, borderRadius: 12, background: 'rgba(200,140,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                      <User size={isTouch ? 13 : 10} style={{ color: '#c88c00' }} />
                    </div>
                  )}
                </div>

                {/* Task Confirmation buttons */}
                {msg.needsConfirmation && msg.taskConfirm && i === messages.length - 1 && !loading && (
                  <div style={{ marginLeft: isTouch ? 32 : 24, marginTop: isTouch ? 8 : 4, display: 'flex', gap: isTouch ? 10 : 6 }}>
                    <button onClick={() => { handleConfirm(phaseEdit ? { phase: phaseEdit } : undefined); setPhaseEdit(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isTouch ? '10px 18px' : '4px 10px', borderRadius: isTouch ? 8 : 5, fontSize: isTouch ? 14 : 11, fontWeight: 600, background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: 'none', cursor: 'pointer' }}>
                      <CheckCircle size={isTouch ? 16 : 12} /> Approve
                    </button>
                    <button onClick={() => { handleDecline(); setPhaseEdit(null); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isTouch ? '10px 18px' : '4px 10px', borderRadius: isTouch ? 8 : 5, fontSize: isTouch ? 14 : 11, fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'none', cursor: 'pointer' }}>
                      <XCircle size={isTouch ? 16 : 12} /> Cancel
                    </button>
                  </div>
                )}

                {/* Generic JobTread write approval card (comments, daily logs, task updates/deletes, schedule edits, etc.) */}
                {msg.needsConfirmation && msg.actionConfirm && i === messages.length - 1 && !loading && (() => {
                  const act = msg.actionConfirm!;
                  return (
                    <div style={{ marginLeft: isTouch ? 32 : 24, marginTop: isTouch ? 8 : 6 }}>
                      <div style={{ background: '#f8f6f3', borderRadius: 8, padding: isTouch ? 12 : 10, marginBottom: 8, border: '1px solid rgba(200,140,0,0.25)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: '#c88c00' }}>
                            Approval needed
                          </div>
                          <div style={{ fontSize: 9, color: '#8a8078', marginLeft: 'auto' }}>
                            Writes to JobTread
                          </div>
                        </div>
                        <div style={{ fontSize: isTouch ? 14 : 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 }}>
                          {act.title || 'Confirm write'}
                        </div>
                        <div style={{ fontSize: isTouch ? 13 : 12, color: '#3a3530', marginBottom: (act.details && act.details.length > 0) ? 8 : 0, lineHeight: '18px' }}>
                          {act.summary}
                        </div>
                        {Array.isArray(act.details) && act.details.length > 0 && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', fontSize: isTouch ? 12 : 11, paddingTop: 6, borderTop: '1px solid rgba(200,140,0,0.12)' }}>
                            {act.details.map((d: any, di: number) => (
                              <>
                                <div key={'l' + di} style={{ color: '#8a8078', fontWeight: 600 }}>{d.label}</div>
                                <div key={'v' + di} style={{ color: '#1a1a1a', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{d.value}</div>
                              </>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: isTouch ? 10 : 6 }}>
                        <button onClick={handleActionApprove}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isTouch ? '10px 18px' : '5px 12px', borderRadius: isTouch ? 8 : 5, fontSize: isTouch ? 14 : 11, fontWeight: 700, background: '#22c55e', color: '#ffffff', border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(34,197,94,0.35)' }}>
                          <CheckCircle size={isTouch ? 16 : 12} /> Approve &amp; send to JobTread
                        </button>
                        <button onClick={handleDecline}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isTouch ? '10px 18px' : '5px 12px', borderRadius: isTouch ? 8 : 5, fontSize: isTouch ? 14 : 11, fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'none', cursor: 'pointer' }}>
                          <XCircle size={isTouch ? 16 : 12} /> Cancel
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* CO Proposal approval UI */}
                {msg.coProposal && i === messages.length - 1 && msg.needsConfirmation && !loading && (() => {
                  const co = msg.coProposal!;
                  const totalPrice = co.lineItems.reduce((s: number, li: any) => s + (li.unitPrice * li.quantity), 0);
                  const totalCost = co.lineItems.reduce((s: number, li: any) => s + (li.unitCost * li.quantity), 0);
                  return (
                    <div style={{ marginLeft: 24, marginTop: 6 }}>
                      <div style={{ background: '#f8f6f3', borderRadius: 8, padding: 10, marginBottom: 6, border: '1px solid rgba(200,140,0,0.2)' }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#c88c00', marginBottom: 6 }}>
                          CO: {co.coName}
                        </div>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ color: '#8a8078', borderBottom: '1px solid rgba(200,140,0,0.15)' }}>
                              <th style={{ textAlign: 'left', padding: '2px 4px' }}>Item</th>
                              <th style={{ textAlign: 'right', padding: '2px 4px' }}>Qty</th>
                              <th style={{ textAlign: 'right', padding: '2px 4px' }}>Cost</th>
                              <th style={{ textAlign: 'right', padding: '2px 4px' }}>Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {co.lineItems.map((li: any, liIdx: number) => (
                              <tr key={liIdx} style={{ color: '#1a1a1a', borderBottom: '1px solid rgba(200,140,0,0.08)' }}>
                                <td style={{ padding: '3px 4px' }}>{li.name}</td>
                                <td style={{ textAlign: 'right', padding: '3px 4px', color: '#5a5550' }}>{li.quantity}</td>
                                <td style={{ textAlign: 'right', padding: '3px 4px', color: '#5a5550' }}>${(li.unitCost * li.quantity).toFixed(0)}</td>
                                <td style={{ textAlign: 'right', padding: '3px 4px', fontWeight: 500 }}>${(li.unitPrice * li.quantity).toFixed(0)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ color: '#1a1a1a', fontWeight: 600, borderTop: '1px solid rgba(200,140,0,0.2)' }}>
                              <td style={{ padding: '4px' }}>Total</td>
                              <td></td>
                              <td style={{ textAlign: 'right', padding: '4px', color: '#5a5550' }}>${totalCost.toFixed(0)}</td>
                              <td style={{ textAlign: 'right', padding: '4px' }}>${totalPrice.toFixed(0)}</td>
                            </tr>
                          </tfoot>
                        </table>
                        {co.createDocument && <div style={{ fontSize: 11, color: '#c88c00', marginTop: 4 }}>+ Draft CO document will be created</div>}
                        {co.followUp?.needed && <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>+ Follow-up task â {co.followUp.assignTo || 'Nathan'} by {co.followUp.dueDate || 'TBD'}</div>}
                        {co.imageUrls && co.imageUrls.length > 0 && <div style={{ fontSize: 11, color: '#22c55e', marginTop: 2 }}>+ {co.imageUrls.length} photo(s) will be attached</div>}
                      </div>
                      <div style={{ display: 'flex', gap: isTouch ? 10 : 6 }}>
                        <button onClick={() => {
                          setMessages(prev => prev.map((m, mi) => mi === prev.length - 1 ? { ...m, needsConfirmation: false } : m));
                          sendMessage('Yes, approve this change order. Create it now.\n\n[APPROVED CO DATA â execute create_change_order tool now]\n' + JSON.stringify(co));
                          setUploadedUrls([]);
                        }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isTouch ? '10px 18px' : '5px 12px', borderRadius: isTouch ? 8 : 5, fontSize: isTouch ? 14 : 11, fontWeight: 600, background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: 'none', cursor: 'pointer' }}>
                          <CheckCircle size={isTouch ? 16 : 12} /> Approve CO
                        </button>
                        <button onClick={handleDecline}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isTouch ? '10px 18px' : '5px 12px', borderRadius: isTouch ? 8 : 5, fontSize: isTouch ? 14 : 11, fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'none', cursor: 'pointer' }}>
                          <XCircle size={isTouch ? 16 : 12} /> Cancel
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', gap: isTouch ? 8 : 6, alignItems: 'center', padding: isTouch ? '8px 0' : '4px 0' }}>
                <div style={{ width: isTouch ? 24 : 18, height: isTouch ? 24 : 18, borderRadius: 12, background: 'rgba(200,140,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Bot size={isTouch ? 13 : 10} style={{ color: '#c88c00' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: isTouch ? '8px 12px' : '4px 8px', borderRadius: isTouch ? 10 : 6, background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.06)' }}>
                  <Loader2 size={isTouch ? 16 : 12} className="animate-spin" style={{ color: '#c88c00' }} />
                  <span style={{ fontSize: isTouch ? 13 : 10, color: '#5a5550' }}>Searching your data...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Image Preview Strip */}
          {attachedImages.length > 0 && (
            <div style={{ display: 'flex', gap: isTouch ? 10 : 6, padding: isTouch ? '8px 12px' : '6px 10px', borderTop: '1px solid rgba(200,140,0,0.06)', overflowX: 'auto' }}>
              {attachedImages.map((img, idx) => (
                <div key={idx} style={{ position: 'relative', flexShrink: 0 }}>
                  <img src={img.preview} alt={img.file.name}
                    style={{ width: isTouch ? 64 : 48, height: isTouch ? 64 : 48, borderRadius: isTouch ? 8 : 6, objectFit: 'cover', border: '1px solid rgba(200,140,0,0.15)' }} />
                  <button onClick={() => removeImage(idx)}
                    style={{
                      position: 'absolute', top: -4, right: -4, width: isTouch ? 22 : 16, height: isTouch ? 22 : 16, borderRadius: 11,
                      background: '#ef4444', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                    <XIcon size={isTouch ? 12 : 8} color="#fff" />
                  </button>
                </div>
              ))}
              {uploading && <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: isTouch ? 13 : 10, color: '#c88c00' }}><Loader2 size={isTouch ? 16 : 12} className="animate-spin" /> Uploading...</div>}
            </div>
          )}

          {/* Uploaded URLs indicator */}
          {uploadedUrls.length > 0 && attachedImages.length === 0 && (
            <div style={{ padding: isTouch ? '6px 12px' : '4px 10px', borderTop: '1px solid rgba(200,140,0,0.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ImageIcon size={isTouch ? 14 : 10} color="#22c55e" />
              <span style={{ fontSize: isTouch ? 12 : 9, color: '#22c55e' }}>{uploadedUrls.length} photo(s) ready to attach to change order</span>
              <button onClick={() => setUploadedUrls([])} style={{ fontSize: isTouch ? 12 : 9, color: '#5a5550', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', marginLeft: 'auto', padding: isTouch ? '4px' : 0 }}>Clear</button>
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'center', gap: isTouch ? 8 : 8, padding: isTouch ? '8px 12px' : '10px 12px', borderTop: '1px solid rgba(200,140,0,0.06)' }}>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageAttach} style={{ display: 'none' }} />
            {agentMode === 'change-order' && (
              <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach photos"
                style={{
                  width: isTouch ? 40 : 28, height: isTouch ? 40 : 28, borderRadius: isTouch ? 10 : 6, border: 'none', cursor: 'pointer', flexShrink: 0,
                  background: attachedImages.length > 0 ? 'rgba(200,140,0,0.15)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <Paperclip size={isTouch ? 18 : 13} style={{ color: attachedImages.length > 0 ? '#c88c00' : '#5a5550' }} />
              </button>
            )}
            <textarea
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, isTouch ? 120 : 120) + 'px'; }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !isTouch) { e.preventDefault(); if (query.trim() && !loading) handleSubmit(e as any); } }}
              placeholder={agentMode === 'general'
                ? (selectedJob ? `Ask about #${selectedJob.number} ${selectedJob.name}...` : 'Ask about tasks, schedules, or jobs...')
                : agentMode === 'change-order'
                ? (selectedJob ? `Describe the change for #${selectedJob.number}...` : 'Select a job, then describe the change...')
                : (selectedJob ? `Ask about specs for #${selectedJob.number}...` : 'Select a job to look up specs...')}
              rows={1}
              disabled={loading || uploading}
              style={{
                flex: 1, background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.1)',
                borderRadius: isTouch ? 10 : 8, color: '#1a1a1a', fontSize: isTouch ? 16 : 13, padding: isTouch ? '10px 12px' : '10px 12px',
                outline: 'none', resize: 'none', minHeight: isTouch ? 42 : 44, maxHeight: isTouch ? 120 : 120, overflowY: 'auto',
                fontFamily: 'inherit',
              }}
            />
            <button type="submit" disabled={!query.trim() || loading || uploading}
              style={{
                width: isTouch ? 40 : 36, height: isTouch ? 40 : 36, borderRadius: isTouch ? 10 : 8, border: 'none', cursor: query.trim() && !loading ? 'pointer' : 'default',
                background: query.trim() && !loading ? 'rgba(200,140,0,0.15)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
              <Send size={isTouch ? 18 : 16} style={{ color: query.trim() && !loading ? '#c88c00' : '#e8e5e0' }} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

const PALETTE = [
  '#c88c00', '#68050a', '#22c55e', '#a855f7',
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
  // Helper: detect ⏳ prefix (handles both proper Unicode U+23F3 and garbled UTF-8 bytes \u00e2\u008f\u00b3)
  const isWaitingOn = (name: string) => name.startsWith('⏳') || name.startsWith('\u00e2\u008f\u00b3');
  const stripWoPrefix = (name: string) => name.replace(/^⏳\s*/, '').replace(/^\u00e2\u008f\u00b3\s*/, '');

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
  const [selectedCalTask, setSelectedCalTask] = useState<{ id: string; name: string; description?: string; jobId: string; jobName: string; jobNumber: string; endDate: string | null; progress: number; assignedMembershipIds?: string[] } | null>(null);
  const [calEditingDate, setCalEditingDate] = useState('');
  const [calSavingDate, setCalSavingDate] = useState(false);
  const [calCompleting, setCalCompleting] = useState(false);
  const [calEditingAssignees, setCalEditingAssignees] = useState<string[]>([]);
  const [calSavingAssignees, setCalSavingAssignees] = useState(false);
  // Task comments (lazy-loaded)
  const [taskComments, setTaskComments] = useState<Array<{ id: string; message: string; name: string; createdAt: string; isPinned: boolean }>>([]);
  const [taskCommentsOpen, setTaskCommentsOpen] = useState(false);
  const [taskCommentsLoading, setTaskCommentsLoading] = useState(false);
  const [taskCommentText, setTaskCommentText] = useState('');
  const [taskCommentSending, setTaskCommentSending] = useState(false);
  // AR Stats
  const [arStats, setArStats] = useState<{
    totalRemindersSent: number;
    jobsWithReminders: number;
    jobsOnHold: number;
    activeJobs: number;
    recentReminders: Array<{ jobName: string; tier: string; date: string }>;
  } | null>(null);
  // Bill-review queue (surfaced as a banner above the KPI grid)
  const [billReviewStats, setBillReviewStats] = useState<{
    pendingTotal: number;
    pendingByType: { uncategorized: number; miscategorized: number; budget_gap: number };
  } | null>(null);

  // Task search and creation
  const [taskSearch, setTaskSearch] = useState('');
  const [newTaskForm, setNewTaskForm] = useState<{ jobId: string; jobName: string } | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskPhase, setNewTaskPhase] = useState('In Production');
  const [newTaskDate, setNewTaskDate] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);

  const PHASES = [
    'Admin Tasks', 'Conceptual Design', 'Design Development', 'Contract',
    'Preconstruction', 'In Production', 'Inspections', 'Punch List', 'Project Completion',
  ];

  // Waiting On tracking
  const [showWaitingOnPanel, setShowWaitingOnPanel] = useState(false);
  const [showAgentPanel, setShowAgentPanel] = useState(false);
  const [panelTab, setPanelTab] = useState<'waitingOn' | 'newTask' | 'scheduleMeeting'>('newTask');
  const [stNewTaskName, setStNewTaskName] = useState('');
  const [stNewTaskJob, setStNewTaskJob] = useState('');
  const [stNewTaskPhase, setStNewTaskPhase] = useState('');
  const [stNewTaskDate, setStNewTaskDate] = useState('');
  const [stNewTaskAssignees, setStNewTaskAssignees] = useState<string[]>([]);
  const [stNewTaskNote, setStNewTaskNote] = useState('');
  const [stNewTaskFiles, setStNewTaskFiles] = useState<Array<{ file: File; uploading: boolean; url?: string; name: string; error?: string }>>([]);
  const [creatingSt, setCreatingSt] = useState(false);
  const [showWaitingOnForm, setShowWaitingOnForm] = useState(false);
  const [woTaskName, setWoTaskName] = useState('');
  const [woJobId, setWoJobId] = useState('');
  const [woDescription, setWoDescription] = useState('');
  const [woDate, setWoDate] = useState('');
  const [woAssignee, setWoAssignee] = useState('');
  const [creatingWo, setCreatingWo] = useState(false);
  const [expandedWoTask, setExpandedWoTask] = useState<string | null>(null);
  const [woComments, setWoComments] = useState<Record<string, any[]>>({});
  const [loadingWoComments, setLoadingWoComments] = useState<string | null>(null);
  const [woNewComment, setWoNewComment] = useState('');
  const [postingWoComment, setPostingWoComment] = useState(false);
  const [completingWoId, setCompletingWoId] = useState<string | null>(null);
  const [woRibbonCollapsed, setWoRibbonCollapsed] = useState(false);
  const [editingWoDateId, setEditingWoDateId] = useState<string | null>(null);
  const [editingWoDateVal, setEditingWoDateVal] = useState('');
  const [savingWoDate, setSavingWoDate] = useState(false);

  // Schedule Meeting state
  const [smCalendars, setSmCalendars] = useState<any[]>([]);
  const [smCalendarId, setSmCalendarId] = useState('');
  const [smJobId, setSmJobId] = useState('');
  const [smTitle, setSmTitle] = useState('');
  const [smDate, setSmDate] = useState('');
  const [smTime, setSmTime] = useState('09:00');
  const [smDuration, setSmDuration] = useState(60);
  const [smNotes, setSmNotes] = useState('');
  const [smAddress, setSmAddress] = useState('');
  const [smAssignees, setSmAssignees] = useState<string[]>([]);
  const [creatingSm, setCreatingSm] = useState(false);
  const [smSuccess, setSmSuccess] = useState('');
  const [smAvailability, setSmAvailability] = useState<any[]>([]);
  const [smLoadingAvail, setSmLoadingAvail] = useState(false);
  const [smJobContacts, setSmJobContacts] = useState<any[]>([]);
  const [smSelectedContacts, setSmSelectedContacts] = useState<Record<string, boolean>>({});
  const [smLoadingContacts, setSmLoadingContacts] = useState(false);
  const [smTradeSearch, setSmTradeSearch] = useState('');
  const [smTradeResults, setSmTradeResults] = useState<any[]>([]);
  const [smSearchingTrade, setSmSearchingTrade] = useState(false);
  const [smAddedTrades, setSmAddedTrades] = useState<any[]>([]);

  // GHL meeting types mapping to calendar IDs
  const MEETING_TYPES = [
    { id: 'XAmFYzHwTcxmDRUrJSgJ', label: 'Discovery Call', duration: 30, group: 'Initial Sales' },
    { id: 'lZJviv1cDQzqDpJGYY9Y', label: 'Informational Phone Call', duration: 20, group: 'Initial Sales' },
    { id: '0CTk7gHpzgsl9JT53t5y', label: '15 Min Phone Call', duration: 30, group: 'Nathan' },
    { id: 'DeoYiZ8TjDVoW6bFraUN', label: 'On-Site Visit', duration: 60, group: 'Initial Sales' },
    { id: '229P4MHIrdFP31JX7EWH', label: 'Design Review Call', duration: 15, group: 'Initial Sales' },
    { id: 'dvSLpgrnc2RHKI3enJGB', label: 'Virtual Meeting (60 min)', duration: 60, group: 'Nathan' },
    { id: 'ikgo6jjzJw3j8RRWG0G9', label: 'In-Person Meeting (60-90 min)', duration: 90, group: 'Nathan' },
    { id: 'Agkb9zIkHOFVvsCgoX8o', label: 'Meeting with Evan', duration: 90, group: 'Evan' },
  ];

  const TEAM_ASSIGNEES = [
    { id: '22P5SRwhLaYf', name: 'Nathan King', label: 'Nathan', ghlUserId: 'cFyoFwK0LIr0npmY7W34' },
    { id: '22P6GTaPEbkh', name: 'Brett King', label: 'Brett', ghlUserId: 'ffCrLZvtipVnvKgSActX' },
    { id: '22P5nJ7ncFj4', name: 'Evan Harrington', label: 'Evan', ghlUserId: 'YyjcH150scEotXz21lWA' },
    { id: '22P6GTEnhCre', name: 'Josh King', label: 'Josh', ghlUserId: '' },
    { id: '22P5SpJkype2', name: 'Terri King', label: 'Terri', ghlUserId: '' },
    { id: '22P732t6SgNk', name: 'Kim King', label: 'Kim', ghlUserId: '' },
  ];
  // The dashboard creator — auto-assigned on Waiting On tasks alongside the person being waited on
  const CREATOR_MEMBERSHIP_ID = '22P5SRwhLaYf'; // Nathan King
  const BKB_PHASES = ['Admin Tasks', 'Conceptual Design', 'Design Development', 'Contract', 'Preconstruction', 'In Production', 'Inspections', 'Punch List', 'Project Completion'];

  async function createNewTask() {
    if (!newTaskForm || !newTaskName.trim() || !newTaskPhase) return;
    setCreatingTask(true);
    try {
      const res = await fetch('/api/dashboard/create-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          jobId: newTaskForm.jobId,
          taskName: newTaskName.trim(),
          phaseName: newTaskPhase,
          endDate: newTaskDate || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        throw new Error(err.error || 'Failed to create task');
      }
      const data = await res.json();
      // Add task to local state so it appears immediately
      if (overview && data.task) {
        const newTask = {
          id: data.task.id,
          name: newTaskName.trim(),
          jobId: newTaskForm.jobId,
          jobName: newTaskForm.jobName,
          jobNumber: '',
          endDate: newTaskDate || null,
          progress: 0,
          urgency: 'normal' as string,
          daysUntilDue: newTaskDate ? Math.ceil((new Date(newTaskDate).getTime() - Date.now()) / 86400000) : null,
        };
        setOverview({
          ...overview,
          data: {
            ...overview.data,
            tasks: [...(overview.data.tasks || []), newTask],
            stats: { ...overview.data.stats, totalTasks: (overview.data.tasks || []).length + 1 },
          },
        });
      }
      // Reset form
      setNewTaskForm(null);
      setNewTaskName('');
      setNewTaskPhase('In Production');
      setNewTaskDate('');
    } catch (err: any) {
      console.error('Create task failed:', err);
      alert('Failed to create task: ' + err.message);
    } finally {
      setCreatingTask(false);
    }
  }

  // ââ Waiting On functions ââââââââââââââââââââââââââââââ
  async function createWaitingOnTask() {
    if (!woTaskName.trim() || !woJobId || !woAssignee) return;
    setCreatingWo(true);
    try {
      const assigneeInfo = TEAM_ASSIGNEES.find(a => a.id === woAssignee);
      const fullName = `${assigneeInfo?.label || 'Team'}: ${woTaskName.trim()}`;

      const res = await fetch('/api/dashboard/waiting-on', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          jobId: woJobId,
          taskName: fullName,
          description: woDescription.trim() || undefined,
          endDate: woDate || undefined,
          assigneeMembershipId: woAssignee,
          creatorMembershipId: CREATOR_MEMBERSHIP_ID,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        throw new Error(err.error || 'Failed to create waiting-on task');
      }
      const data = await res.json();

      // Add to local tasks so it appears immediately
      if (overview && data.task) {
        const activeJob = overview.data.activeJobs?.find(j => j.id === woJobId);
        const newTask = {
          id: data.task.id,
          name: data.formattedName,
          jobId: woJobId,
          jobName: activeJob ? `#${activeJob.number} ${activeJob.name}` : '',
          jobNumber: activeJob?.number || '',
          endDate: data.dueDate || null,
          progress: 0,
          urgency: 'normal' as string,
          daysUntilDue: data.dueDate ? Math.ceil((new Date(data.dueDate).getTime() - Date.now()) / 86400000) : null,
        };
        setOverview({
          ...overview,
          data: {
            ...overview.data,
            tasks: [...(overview.data.tasks || []), newTask],
            stats: { ...overview.data.stats, totalTasks: (overview.data.tasks || []).length + 1 },
          },
        });
      }

      // Reset form
      setShowWaitingOnForm(false);
      setWoTaskName('');
      setWoJobId('');
      setWoDescription('');
      setWoDate('');
      setWoAssignee('');
    } catch (err: any) {
      console.error('Create waiting-on task failed:', err);
      alert('Failed to create: ' + err.message);
    } finally {
      setCreatingWo(false);
    }
  }

  async function fetchWoComments(taskId: string) {
    if (woComments[taskId]) return; // Already loaded
    setLoadingWoComments(taskId);
    try {
      const res = await fetch(`/api/dashboard/waiting-on?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Failed to fetch comments');
      const data = await res.json();
      setWoComments(prev => ({ ...prev, [taskId]: data.comments || [] }));
    } catch (err) {
      console.error('Fetch comments failed:', err);
      setWoComments(prev => ({ ...prev, [taskId]: [] }));
    } finally {
      setLoadingWoComments(null);
    }
  }

  async function postWoComment(taskId: string) {
    if (!woNewComment.trim()) return;
    setPostingWoComment(true);
    try {
      const res = await fetch('/api/dashboard/waiting-on', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          taskId,
          message: woNewComment.trim(),
          authorName: 'Terri King',
        }),
      });
      if (!res.ok) throw new Error('Failed to post comment');
      const data = await res.json();
      // Add comment to local state
      setWoComments(prev => ({
        ...prev,
        [taskId]: [data.comment, ...(prev[taskId] || [])],
      }));
      setWoNewComment('');
    } catch (err: any) {
      console.error('Post comment failed:', err);
      alert('Failed to post comment: ' + err.message);
    } finally {
      setPostingWoComment(false);
    }
  }

  async function completeWoTask(taskId: string) {
    setCompletingWoId(taskId);
    try {
      const res = await fetch('/api/dashboard/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ taskId, action: 'complete' }),
      });
      if (!res.ok) throw new Error('Failed to complete task');
      if (overview) {
        const updatedTasks = (overview.data.tasks || []).filter(t => t.id !== taskId);
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
      console.error('Complete WO task failed:', err);
    } finally {
      setCompletingWoId(null);
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
        const updatedTasks = (overview.data.tasks || []).filter(t => t.id !== taskId);
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
        const updatedTasks = (overview.data.tasks || []).map(t =>
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

  // Reset comment state when task popup opens/closes
  useEffect(() => {
    setTaskCommentsOpen(false);
    setTaskComments([]);
    setTaskCommentText('');
    // Initialize assignee editor from the currently selected task
    setCalEditingAssignees(selectedCalTask?.assignedMembershipIds || []);
  }, [selectedCalTask?.id]);

  // Task comments — lazy load
  async function loadTaskComments(taskId: string) {
    setTaskCommentsLoading(true);
    setTaskComments([]);
    setTaskCommentsOpen(true);
    try {
      const res = await fetch(`/api/dashboard/task-comments?taskId=${taskId}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setTaskComments(data.comments || []);
    } catch (err) {
      console.error('Load comments error:', err);
    } finally {
      setTaskCommentsLoading(false);
    }
  }

  async function postTaskComment() {
    if (!selectedCalTask || !taskCommentText.trim()) return;
    setTaskCommentSending(true);
    try {
      const res = await fetch('/api/dashboard/task-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: selectedCalTask.id,
          message: taskCommentText.trim(),
          authorName: auth.user?.name || 'BKB Dashboard',
        }),
      });
      if (!res.ok) throw new Error('Failed to post');
      setTaskCommentText('');
      // Refresh comments
      await loadTaskComments(selectedCalTask.id);
    } catch (err) {
      console.error('Post comment error:', err);
    } finally {
      setTaskCommentSending(false);
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
        const updatedTasks = (overview.data.tasks || []).filter(t => t.id !== selectedCalTask.id);
        setOverview({ ...overview, data: { ...overview.data, tasks: updatedTasks, stats: { ...overview.data.stats, totalTasks: updatedTasks.length } } });
      }
      setSelectedCalTask(null);
    } catch (err: any) {
      console.error('Complete cal task failed:', err);
    } finally {
      setCalCompleting(false);
    }
  }

  async function handleStFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    // Add files to state and start uploading each
    const newEntries = files.map(f => ({ file: f, uploading: true, name: f.name }));
    setStNewTaskFiles(prev => [...prev, ...newEntries]);

    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append('files', file);
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
          body: fd,
        });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        const uploaded = data.uploaded?.[0];
        if (uploaded) {
          setStNewTaskFiles(prev => prev.map(f => f.name === file.name && f.uploading ? { ...f, uploading: false, url: uploaded.url } : f));
        } else {
          setStNewTaskFiles(prev => prev.map(f => f.name === file.name && f.uploading ? { ...f, uploading: false, error: 'Upload failed' } : f));
        }
      } catch (err: any) {
        setStNewTaskFiles(prev => prev.map(f => f.name === file.name && f.uploading ? { ...f, uploading: false, error: err.message } : f));
      }
    }
    // Reset the input
    e.target.value = '';
  }

  async function createStandaloneTask() {
    if (!stNewTaskName.trim() || !stNewTaskJob || !stNewTaskPhase) return;
    setCreatingSt(true);
    try {
      // Collect successfully uploaded file URLs
      const fileUrls = stNewTaskFiles.filter(f => f.url).map(f => ({ url: f.url!, name: f.name }));
      const res = await fetch('/api/dashboard/create-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: stNewTaskJob, taskName: stNewTaskName.trim(), phaseName: stNewTaskPhase, endDate: stNewTaskDate || undefined, description: stNewTaskNote.trim() || undefined, fileUrls: fileUrls.length > 0 ? fileUrls : undefined, assigneeIds: stNewTaskAssignees.length > 0 ? stNewTaskAssignees : undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (overview && data.task) {
        const mj = overview.data.activeJobs?.find((j: any) => j.id === stNewTaskJob);
        const assigneeNames = stNewTaskAssignees.map(id => TEAM_ASSIGNEES.find(a => a.id === id)?.name || '').filter(Boolean).join(', ');
        setOverview({ ...overview, data: { ...overview.data, tasks: [...(overview.data.tasks || []), { id: data.task.id, name: stNewTaskName.trim(), jobName: mj ? mj.name : '', jobId: stNewTaskJob, jobNumber: mj ? String(mj.number) : '', endDate: stNewTaskDate || null, startDate: stNewTaskDate || null, progress: 0, urgency: 'normal', assignee: assigneeNames, daysUntilDue: stNewTaskDate ? Math.ceil((new Date(stNewTaskDate).getTime() - Date.now()) / 86400000) : null } as any] } });
      }
      setStNewTaskName(''); setStNewTaskJob(''); setStNewTaskPhase(''); setStNewTaskDate(''); setStNewTaskAssignees([]); setStNewTaskNote(''); setStNewTaskFiles([]);
      setPanelTab('waitingOn');
    } catch (err: any) {
      console.error('Create task failed:', err);
      alert('Failed: ' + err.message);
    } finally { setCreatingSt(false); }
  }

  // Schedule Meeting functions
  async function fetchAvailability(dateStr: string) {
    if (!dateStr) return;
    setSmLoadingAvail(true);
    try {
      const d = new Date(dateStr + 'T00:00:00');
      const start = new Date(d); start.setHours(7, 0, 0, 0);
      const end = new Date(d); end.setHours(20, 0, 0, 0);
      const res = await fetch(`/api/dashboard/schedule-meeting/availability?date=${dateStr}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (res.ok) {
        const data = await res.json();
        setSmAvailability(data.events || []);
      }
    } catch (err) { console.error('Availability fetch failed:', err); }
    finally { setSmLoadingAvail(false); }
  }

  async function fetchJobContacts(jobId: string) {
    if (!jobId) { setSmJobContacts([]); setSmSelectedContacts({}); return; }
    setSmLoadingContacts(true);
    try {
      const res = await fetch(`/api/dashboard/schedule-meeting/contacts?jobId=${jobId}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (res.ok) {
        const data = await res.json();
        const contacts = data.contacts || [];
        setSmJobContacts(contacts);
        // Auto-select all homeowner contacts that have GHL matches
        const selected: Record<string, boolean> = {};
        contacts.forEach((c: any) => { if (c.ghlContactId) selected[c.ghlContactId] = true; });
        setSmSelectedContacts(selected);
      }
    } catch (err) { console.error('Fetch contacts failed:', err); }
    finally { setSmLoadingContacts(false); }
  }

  async function searchTradePartner(query: string) {
    if (!query.trim() || query.length < 2) { setSmTradeResults([]); return; }
    setSmSearchingTrade(true);
    try {
      const res = await fetch(`/api/dashboard/schedule-meeting/search-contacts?q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (res.ok) {
        const data = await res.json();
        setSmTradeResults(data.contacts || []);
      }
    } catch (err) { console.error('Trade search failed:', err); }
    finally { setSmSearchingTrade(false); }
  }

  function toggleContact(ghlContactId: string) {
    setSmSelectedContacts(prev => ({ ...prev, [ghlContactId]: !prev[ghlContactId] }));
  }

  function addTradePartner(contact: any) {
    if (smAddedTrades.some(t => t.id === contact.id)) return;
    setSmAddedTrades(prev => [...prev, contact]);
    setSmSelectedContacts(prev => ({ ...prev, [contact.id]: true }));
    setSmTradeSearch('');
    setSmTradeResults([]);
  }

  function removeTradePartner(contactId: string) {
    setSmAddedTrades(prev => prev.filter(t => t.id !== contactId));
    setSmSelectedContacts(prev => { const next = { ...prev }; delete next[contactId]; return next; });
  }

  async function createScheduledMeeting() {
    if (!smCalendarId || !smJobId || !smTitle.trim() || !smDate || !smTime) return;
    setCreatingSm(true);
    setSmSuccess('');
    try {
      // Build start/end times
      const startDt = new Date(`${smDate}T${smTime}:00`);
      const endDt = new Date(startDt.getTime() + smDuration * 60000);
      const startTime = startDt.toISOString();
      const endTime = endDt.toISOString();

      // Build contacts array from selected homeowner contacts + trade partners
      const selectedContactsList: { ghlContactId: string; name: string }[] = [];
      smJobContacts.forEach((c: any) => {
        if (c.ghlContactId && smSelectedContacts[c.ghlContactId]) {
          selectedContactsList.push({ ghlContactId: c.ghlContactId, name: c.name });
        }
      });
      smAddedTrades.forEach((t: any) => {
        if (t.id && smSelectedContacts[t.id]) {
          selectedContactsList.push({ ghlContactId: t.id, name: t.name });
        }
      });

      // Build team assignees list with GHL user IDs for Loop automations
      const selectedTeamMembers = smAssignees
        .map(id => TEAM_ASSIGNEES.find(a => a.id === id))
        .filter(Boolean)
        .map(a => ({ jtMembershipId: a!.id, name: a!.name, ghlUserId: a!.ghlUserId || '' }));

      const res = await fetch('/api/dashboard/schedule-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          calendarId: smCalendarId,
          contacts: selectedContactsList.length > 0 ? selectedContactsList : undefined,
          jobId: smJobId,
          title: smTitle.trim(),
          startTime,
          endTime,
          notes: smNotes || undefined,
          address: smAddress || undefined,
          assignees: selectedTeamMembers.length > 0 ? selectedTeamMembers : undefined,
        }),
      });
      if (!res.ok) {
        // Parse JSON error response and translate into plain English.
        // Raw 500 body looked like '{"error":"GHL 422: {...}","errors":[...],"debug":{...}}'
        // rendered verbatim in the UI; now we extract a friendly message.
        let friendly = 'Failed to create meeting';
        try {
          const errJson = await res.json();
          const errs: string[] = Array.isArray(errJson.errors) ? errJson.errors : [];
          const raw: string = errJson.error || errs[0] || errJson.message || '';
          if (/user id (?:not|is not) part of calendar team/i.test(raw)) {
            const nameMatch = raw.match(/assigned to ([^)]+)\)/);
            const who = nameMatch ? nameMatch[1].trim() : 'the selected team member';
            friendly = `Meeting not scheduled: ${who} is not on the Loop calendar team for this meeting type. Ask Nathan to add them to the calendar team in Loop, then try again.`;
          } else if (raw) {
            // Strip JSON-ish GHL payloads and traceIds so Terri sees plain text.
            friendly = raw
              .replace(/GHL \d+:\s*\{[\s\S]*?\}\s*/g, '')
              .replace(/\{[^{}]*"traceId"[^{}]*\}/g, '')
              .replace(/\s+/g, ' ')
              .trim() || friendly;
            if (errs.length > 1) friendly += ` (${errs.length - 1} other error${errs.length > 2 ? 's' : ''} suppressed, check server logs)`;
          }
        } catch {
          // Response body was not JSON, keep default message.
        }
        throw new Error(friendly);
      }
      const data = await res.json();
      const apptCount = data.ghlAppointments?.length || 1;
      setSmSuccess(`Meeting created — ${apptCount} reminder${apptCount > 1 ? 's' : ''} sent${data.jtTaskId ? ' + JT task' : ''}`);
      // Reset form
      setSmTitle(''); setSmDate(''); setSmTime('09:00'); setSmNotes(''); setSmAddress('');
      setSmAssignees([]); setSmAddedTrades([]); setSmJobContacts([]); setSmSelectedContacts({});
      // Refresh dashboard data
      window.dispatchEvent(new Event('refreshDashboard'));
      setTimeout(() => setSmSuccess(''), 4000);
    } catch (err: any) {
      console.error('Create meeting failed:', err);
      setSmSuccess('❌ ' + (err.message || 'Failed to create meeting'));
    } finally { setCreatingSm(false); }
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
        const updatedTasks = (overview.data.tasks || []).map(t =>
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

  async function saveCalAssignees() {
    if (!selectedCalTask) return;
    setCalSavingAssignees(true);
    try {
      const res = await fetch('/api/dashboard/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          taskId: selectedCalTask.id,
          action: 'assignees',
          assignedMembershipIds: calEditingAssignees,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      // Compute updated assignee display name from TEAM_ASSIGNEES
      const assigneeNames = calEditingAssignees
        .map(id => TEAM_ASSIGNEES.find(a => a.id === id)?.name || '')
        .filter(Boolean)
        .join(', ');
      if (overview) {
        const updatedTasks = (overview.data.tasks || []).map((t: any) =>
          t.id === selectedCalTask.id
            ? { ...t, assignedMembershipIds: [...calEditingAssignees], assignee: assigneeNames || undefined }
            : t
        );
        setOverview({ ...overview, data: { ...overview.data, tasks: updatedTasks } });
      }
      // Update the in-memory selected task so the dirty check resets
      setSelectedCalTask({ ...selectedCalTask, assignedMembershipIds: [...calEditingAssignees] });
      // Trigger downstream refresh (e.g., Waiting On ribbon, All Tasks list)
      window.dispatchEvent(new Event('refreshDashboard'));
    } catch (err: any) {
      console.error('Save cal assignees failed:', err);
    } finally {
      setCalSavingAssignees(false);
    }
  }

  function recalcUrgency(endDate: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(endDate); due.setHours(0, 0, 0, 0);
    const days = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const urgency = days < 0 ? 'urgent' : days <= 2 ? 'high' : 'normal';
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
      // Bill-review queue stats for the banner (cheap — just counts)
      fetch('/api/dashboard/bill-review?limit=0&includeStats=1', {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.stats) setBillReviewStats({ pendingTotal: d.stats.pendingTotal, pendingByType: d.stats.pendingByType }); })
        .catch(() => {});
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

  // Listen for refreshDashboard events (from inline task actions)
  useEffect(() => {
    const handler = () => fetchOverview(true);
    window.addEventListener('refreshDashboard', handler);
    return () => window.removeEventListener('refreshDashboard', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!auth.isAuthenticated || !auth.userId) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <Loader2 size={20} className="animate-spin" style={{ color: '#c88c00' }} />
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

  // Group Google Calendar events by date for the 2-week grid
  const calendarEvents = overview?.data?.calendarEvents || [];
  const calEventsByDate: Record<string, typeof calendarEvents> = {};
  for (const ev of calendarEvents) {
    // Extract date from start (could be "2026-04-07T09:00:00-04:00" or "2026-04-07")
    const d = ev.start?.slice(0, 10);
    if (!d) continue;
    if (!calEventsByDate[d]) calEventsByDate[d] = [];
    calEventsByDate[d].push(ev);
  }

  if (loading && !overview) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
      <Loader2 size={20} className="animate-spin" style={{ color: '#c88c00' }} />
    </div>
  );

  if (error && !overview) return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <p style={{ color: '#ef4444', fontSize: 15, marginBottom: 12 }}>{error}</p>
      <button onClick={() => fetchOverview()} style={{ background: '#c88c00', color: '#ffffff', fontSize: 14, padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer' }}>Retry</button>
    </div>
  );

  if (!overview) return null;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? '0 16px' : '0 24px' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isTouch ? 10 : 6 }}>
        <div>
          <h1 style={{ color: '#1a1a1a', fontSize: isTouch ? 24 : 22, fontWeight: 700, margin: 0 }}>{getGreeting()}, {firstName}</h1>
          {overview._cached && overview._cachedAt && (
            <span style={{ fontSize: 12, color: '#5a5550' }}>Updated {timeAgo(overview._cachedAt)}</span>
          )}
        </div>
        <button onClick={() => fetchOverview(true)} disabled={refreshing} style={{ padding: 5, borderRadius: 6, background: 'rgba(200,140,0,0.08)', border: 'none', cursor: 'pointer', lineHeight: 0 }}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} style={{ color: '#c88c00' }} />
        </button>
      </div>

      {/* ACTION BUTTONS ROW */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <button onClick={() => { setShowWaitingOnPanel(!showWaitingOnPanel); setShowAgentPanel(false); }}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: showWaitingOnPanel ? 'rgba(200,140,0,0.08)' : '#f8f6f3', border: '1px solid rgba(200,140,0,0.08)', borderRadius: 8,
            padding: '7px 10px', cursor: 'pointer' }}>
          <span style={{ fontSize: 15, color: '#c88c00' }}>+</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#c88c00', letterSpacing: '0.04em' }}>
            QUICK ADD
          </span>
        </button>
        <button onClick={() => { setShowAgentPanel(!showAgentPanel); setShowWaitingOnPanel(false); }}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: showAgentPanel ? 'rgba(200,140,0,0.08)' : '#f8f6f3', border: '1px solid rgba(200,140,0,0.08)', borderRadius: 8,
            padding: '7px 10px', cursor: 'pointer' }}>
          <Bot size={14} style={{ color: '#c88c00' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#c88c00', letterSpacing: '0.04em' }}>ASK AGENT</span>
        </button>
      </div>
      {showAgentPanel && <InlineAskAgent pmJobs={overview?.data?.activeJobs || []} screen={'desktop'} hideToggle defaultOpen />}
              {/* QUICK ADD — Inline Panel */}
      {showWaitingOnPanel && (() => {
        const woTasks = tasks.filter(t => isWaitingOn(t.name));
        function agingColor(d: number | null): string { if (d === null) return '#6a6058'; if (d < -7) return '#ef4444'; if (d < -3) return '#f97316'; if (d < 0) return '#eab308'; return '#6a6058'; }
        function agingBg(d: number | null): string { if (d === null) return 'transparent'; if (d < -7) return 'rgba(239,68,68,0.08)'; if (d < -3) return 'rgba(249,115,22,0.08)'; if (d < 0) return 'rgba(234,179,8,0.06)'; return 'transparent'; }
        const sorted = [...woTasks].sort((a, b) => (a.daysUntilDue ?? 999) - (b.daysUntilDue ?? 999));
        return (
              <div style={{ marginBottom: 6, borderRadius: 8, border: '1px solid rgba(200,140,0,0.12)', overflow: 'hidden', background: '#ffffff' }}>













              <div style={{ display: 'flex', borderBottom: '1px solid rgba(200,140,0,0.08)', flexShrink: 0 }}>
                <button onClick={() => setPanelTab('newTask')} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', borderBottom: panelTab === 'newTask' ? '2px solid #c88c00' : '2px solid transparent', color: panelTab === 'newTask' ? '#c88c00' : '#6a6058', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>New Task</button>
                <button onClick={() => setPanelTab('waitingOn')} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', borderBottom: panelTab === 'waitingOn' ? '2px solid #c88c00' : '2px solid transparent', color: panelTab === 'waitingOn' ? '#c88c00' : '#6a6058', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Waiting On ({woTasks.length})</button>
                <button onClick={() => setPanelTab('scheduleMeeting')} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', borderBottom: panelTab === 'scheduleMeeting' ? '2px solid #c88c00' : '2px solid transparent', color: panelTab === 'scheduleMeeting' ? '#c88c00' : '#6a6058', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><Calendar size={13} />Meeting</button>
              </div>
              {/* Scrollable content */}
              <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px 12px' }}>
                {panelTab === 'newTask' && (
                  <div style={{ padding: '4px 0' }}>
                    <div>
                      <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>TASK NAME</label>
                      <input type="text" autoFocus placeholder="e.g. Order appliances" value={stNewTaskName} onChange={e => setStNewTaskName(e.target.value)}
                        style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: '#2a2520', fontSize: 14, padding: '7px 10px', outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>JOB</label>
                      <JobSearchDropdown
                        jobs={overview?.data?.activeJobs || []}
                        value={stNewTaskJob}
                        onChange={setStNewTaskJob}
                        placeholder="Search jobs..."
                        formatLabel={j => `${j.number} - ${j.name}`}
                      />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>PHASE</label>
                      <select value={stNewTaskPhase} onChange={e => setStNewTaskPhase(e.target.value)}
                        style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: stNewTaskPhase ? '#c88c00' : '#5a5550', fontSize: 13, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const }}>
                        <option value="">Select phase...</option>
                        {BKB_PHASES.map(p => (<option key={p} value={p}>{p}</option>))}
                      </select>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>ASSIGN TO</label>
                      <div style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, padding: '4px 8px', maxHeight: 120, overflowY: 'auto', boxSizing: 'border-box' as const }}>
                        {TEAM_ASSIGNEES.map((a: any) => (
                          <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer', fontSize: 13, color: stNewTaskAssignees.includes(a.id) ? '#c88c00' : '#5a5550' }}>
                            <input type="checkbox" checked={stNewTaskAssignees.includes(a.id)}
                              onChange={e => {
                                if (e.target.checked) setStNewTaskAssignees(prev => [...prev, a.id]);
                                else setStNewTaskAssignees(prev => prev.filter(id => id !== a.id));
                              }}
                              style={{ accentColor: '#c88c00' }} />
                            {a.label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>DUE DATE</label>
                      <input type="date" value={stNewTaskDate} onChange={e => setStNewTaskDate(e.target.value)}
                        style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: stNewTaskDate ? '#c88c00' : '#5a5550', fontSize: 13, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>NOTE (OPTIONAL)</label>
                      <textarea placeholder="Add context or details..." value={stNewTaskNote} onChange={e => setStNewTaskNote(e.target.value)} rows={2}
                        style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: '#1a1a1a', fontSize: 13, padding: '7px 10px', outline: 'none', boxSizing: 'border-box' as const, resize: 'vertical' as const, fontFamily: 'inherit' }} />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>ATTACHMENTS (OPTIONAL)</label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#ffffff', border: '1px dashed rgba(200,140,0,0.2)', borderRadius: 5, cursor: 'pointer' }}>
                        <Paperclip size={13} style={{ color: '#6a6058' }} />
                        <span style={{ fontSize: 13, color: '#6a6058' }}>Add files (PDF, images, docs...)</span>
                        <input type="file" multiple onChange={handleStFileSelect} accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv" style={{ display: 'none' }} />
                      </label>
                      {stNewTaskFiles.length > 0 && (
                        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {stNewTaskFiles.map((f, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', background: 'rgba(200,140,0,0.04)', borderRadius: 4 }}>
                              {f.uploading ? <Loader2 size={12} className="animate-spin" style={{ color: '#c88c00' }} /> : f.error ? <XCircle size={12} style={{ color: '#ef4444' }} /> : <CheckCircle size={12} style={{ color: '#22c55e' }} />}
                              <span style={{ fontSize: 12, color: f.error ? '#ef4444' : '#1a1a1a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{f.name}</span>
                              <button onClick={() => setStNewTaskFiles(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0 }}>
                                <X size={12} style={{ color: '#5a5550' }} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={createStandaloneTask} disabled={!stNewTaskName.trim() || !stNewTaskJob || !stNewTaskPhase || creatingSt || stNewTaskFiles.some(f => f.uploading)}
                      style={{ marginTop: 12, width: '100%', padding: '10px', borderRadius: 6, border: 'none',
                        background: (!stNewTaskName.trim() || !stNewTaskJob || !stNewTaskPhase) ? '#333' : '#c88c00',
                        color: (!stNewTaskName.trim() || !stNewTaskJob || !stNewTaskPhase) ? '#666' : '#ffffff',
                        fontWeight: 600, fontSize: 14,
                        cursor: (!stNewTaskName.trim() || !stNewTaskJob || !stNewTaskPhase) ? 'default' : 'pointer',
                        opacity: creatingSt ? 0.5 : 1 }}>
                      {creatingSt ? 'Creating...' : 'Create Task'}
                    </button>
                  </div>
                )}
                {panelTab === 'waitingOn' && (
                  <div style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.12)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#c88c00', marginBottom: 8 }}>New Waiting On Item</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>WHAT ARE YOU WAITING ON?</label>
                        <input type="text" autoFocus placeholder="e.g. Approval on tile selection" value={woTaskName} onChange={e => setWoTaskName(e.target.value)}
                          style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: '#1a1a1a', fontSize: 14, padding: '7px 10px', outline: 'none', boxSizing: 'border-box' as const }} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>JOB</label>
                          <JobSearchDropdown
                            jobs={overview?.data?.activeJobs || []}
                            value={woJobId}
                            onChange={setWoJobId}
                            placeholder="Search jobs..."
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>WHO?</label>
                          <select value={woAssignee} onChange={e => setWoAssignee(e.target.value)}
                            style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: woAssignee ? '#c88c00' : '#5a5550', fontSize: 13, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const }}>
                            <option value="">Select person...</option>
                            {TEAM_ASSIGNEES.map((a: any) => (<option key={a.id} value={a.id}>{a.label}</option>))}
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>FOLLOW UP BY</label>
                          <input type="date" value={woDate} onChange={e => setWoDate(e.target.value)}
                            style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: '#1a1a1a', fontSize: 13, padding: '7px 8px', colorScheme: 'dark', outline: 'none', boxSizing: 'border-box' as const }} />
                          <div style={{ fontSize: 10, color: '#5a5550', marginTop: 2 }}>Default: 3 business days</div>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>NOTE (OPTIONAL)</label>
                          <input type="text" placeholder="Context..." value={woDescription} onChange={e => setWoDescription(e.target.value)}
                            style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: '#1a1a1a', fontSize: 13, padding: '7px 8px', outline: 'none', boxSizing: 'border-box' as const }} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                        <button onClick={() => { setShowWaitingOnForm(false); setShowWaitingOnPanel(false); }}
                          style={{ fontSize: 13, color: '#6a6058', background: 'transparent', border: '1px solid rgba(200,140,0,0.1)', borderRadius: 5, padding: '5px 12px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={createWaitingOnTask} disabled={!woTaskName.trim() || !woJobId || !woAssignee || creatingWo}
                          style={{ fontSize: 13, fontWeight: 600, borderRadius: 5, padding: '5px 14px', border: 'none',
                            cursor: (woTaskName.trim() && woJobId && woAssignee && !creatingWo) ? 'pointer' : 'default',
                            background: (woTaskName.trim() && woJobId && woAssignee) ? '#c88c00' : 'rgba(200,140,0,0.2)',
                            color: (woTaskName.trim() && woJobId && woAssignee) ? '#ffffff' : '#6a6058', opacity: creatingWo ? 0.5 : 1 }}>
                          {creatingWo ? 'Creating...' : 'Create'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {panelTab === 'scheduleMeeting' && (
                  <div style={{ padding: '4px 0' }}>
                    {smSuccess && (() => {
                      const isError = smSuccess.startsWith('❌');
                      const text = isError ? smSuccess.replace(/^❌\s*/, '') : smSuccess;
                      return (
                        <div style={{
                          background: isError ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                          border: isError ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(34,197,94,0.3)',
                          borderRadius: 6, padding: '8px 12px', marginBottom: 8, fontSize: 13,
                          color: isError ? '#ef4444' : '#22c55e',
                          display: 'flex', alignItems: 'flex-start', gap: 6,
                        }}>
                          {isError ? <XCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> : <CheckCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
                          <span style={{ wordBreak: 'break-word' }}>{text}</span>
                        </div>
                      );
                    })()}
                    <div>
                      <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>MEETING TYPE</label>
                      <select value={smCalendarId} onChange={e => { setSmCalendarId(e.target.value); const mt = MEETING_TYPES.find(m => m.id === e.target.value); if (mt) setSmDuration(mt.duration); }}
                        style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: smCalendarId ? '#c88c00' : '#5a5550', fontSize: 13, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const }}>
                        <option value="">Select meeting type...</option>
                        {MEETING_TYPES.map(mt => (<option key={mt.id} value={mt.id}>{mt.label} ({mt.duration} min)</option>))}
                      </select>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>MEETING TITLE</label>
                      <input type="text" autoFocus placeholder="e.g. Smith Kitchen - Design Review" value={smTitle} onChange={e => setSmTitle(e.target.value)}
                        style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: '#2a2520', fontSize: 14, padding: '7px 10px', outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>JOB</label>
                        <JobSearchDropdown
                          jobs={overview?.data?.activeJobs || []}
                          value={smJobId}
                          onChange={(id: string) => { setSmJobId(id); fetchJobContacts(id); }}
                          placeholder="Search jobs..."
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>BKB ATTENDEES</label>
                        <div style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, padding: '4px 8px', maxHeight: 120, overflowY: 'auto', boxSizing: 'border-box' as const }}>
                          {TEAM_ASSIGNEES.map((a: any) => (
                            <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer', fontSize: 13, color: smAssignees.includes(a.id) ? '#c88c00' : '#5a5550' }}>
                              <input type="checkbox" checked={smAssignees.includes(a.id)}
                                onChange={e => {
                                  if (e.target.checked) setSmAssignees(prev => [...prev, a.id]);
                                  else setSmAssignees(prev => prev.filter(id => id !== a.id));
                                }}
                                style={{ accentColor: '#c88c00' }} />
                              {a.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* CONTACTS — who gets reminders */}
                    {smJobId && (
                      <div style={{ marginTop: 8, background: 'rgba(200,140,0,0.04)', borderRadius: 6, padding: '8px 10px', border: '1px solid rgba(200,140,0,0.08)' }}>
                        <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 6 }}>WHO GETS REMINDERS?</label>
                        {smLoadingContacts ? (
                          <div style={{ fontSize: 13, color: '#5a5550', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}><Loader2 size={14} className="animate-spin" /> Loading contacts...</div>
                        ) : smJobContacts.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#5a5550', padding: '2px 0' }}>No contacts found for this job</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {smJobContacts.map((c: any) => (
                              <label key={c.jtContactId} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: c.ghlContactId ? 'pointer' : 'default', opacity: c.ghlContactId ? 1 : 0.5 }}>
                                <input type="checkbox" checked={!!smSelectedContacts[c.ghlContactId]} disabled={!c.ghlContactId}
                                  onChange={() => c.ghlContactId && toggleContact(c.ghlContactId)}
                                  style={{ accentColor: '#c88c00', width: 14, height: 14, cursor: c.ghlContactId ? 'pointer' : 'default' }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>{c.name}</div>
                                  <div style={{ fontSize: 11, color: '#5a5550', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                                    {c.email || c.phone || 'No contact info'}{!c.ghlContactId && ' — not found in Loop'}
                                  </div>
                                </div>
                              </label>
                            ))}
                          </div>
                        )}
                        {/* Added trade partners */}
                        {smAddedTrades.length > 0 && (
                          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(200,140,0,0.08)' }}>
                            {smAddedTrades.map((t: any) => (
                              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 4 }}>
                                <input type="checkbox" checked={!!smSelectedContacts[t.id]}
                                  onChange={() => toggleContact(t.id)}
                                  style={{ accentColor: '#c88c00', width: 14, height: 14, cursor: 'pointer' }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, color: '#1a1a1a', fontWeight: 500 }}>{t.name} <span style={{ fontSize: 11, color: '#c88c00' }}>trade</span></div>
                                  <div style={{ fontSize: 11, color: '#5a5550' }}>{t.email || t.phone || ''}</div>
                                </div>
                                <button onClick={(e) => { e.preventDefault(); removeTradePartner(t.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                                  <X size={13} style={{ color: '#5a5550' }} />
                                </button>
                              </label>
                            ))}
                          </div>
                        )}
                        {/* Trade partner search */}
                        <div style={{ marginTop: 6, position: 'relative' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input type="text" placeholder="+ Add trade partner (search name)..." value={smTradeSearch}
                              onChange={e => { setSmTradeSearch(e.target.value); if (e.target.value.length >= 2) searchTradePartner(e.target.value); else setSmTradeResults([]); }}
                              style={{ flex: 1, background: '#ffffff', border: '1px solid rgba(200,140,0,0.12)', borderRadius: 5, color: '#1a1a1a', fontSize: 12, padding: '5px 8px', outline: 'none', boxSizing: 'border-box' as const }} />
                            {smSearchingTrade && <Loader2 size={13} className="animate-spin" style={{ color: '#5a5550', position: 'absolute', right: 8, top: 7 }} />}
                          </div>
                          {smTradeResults.length > 0 && (
                            <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 10, background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 6, marginTop: 2, maxHeight: 120, overflowY: 'auto' }}>
                              {smTradeResults.map((r: any) => (
                                <button key={r.id} onClick={() => addTradePartner(r)}
                                  style={{ width: '100%', display: 'flex', flexDirection: 'column', padding: '6px 10px', background: 'none', border: 'none', borderBottom: '1px solid rgba(200,140,0,0.06)', cursor: 'pointer', textAlign: 'left' as const }}>
                                  <span style={{ fontSize: 13, color: '#1a1a1a' }}>{r.name}</span>
                                  <span style={{ fontSize: 11, color: '#5a5550' }}>{r.email || r.phone || ''}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 8, marginTop: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>DATE</label>
                        <input type="date" value={smDate} onChange={e => setSmDate(e.target.value)}
                          style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: smDate ? '#c88c00' : '#5a5550', fontSize: 13, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const, colorScheme: 'dark' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>TIME</label>
                        <input type="time" value={smTime} onChange={e => setSmTime(e.target.value)}
                          style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: '#c88c00', fontSize: 13, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const, colorScheme: 'dark' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>MINS</label>
                        <input type="number" value={smDuration} onChange={e => setSmDuration(Number(e.target.value))} min={15} max={180} step={15}
                          style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: '#c88c00', fontSize: 13, padding: '7px 8px', outline: 'none', boxSizing: 'border-box' as const }} />
                      </div>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>LOCATION / ADDRESS (OPTIONAL)</label>
                      <input type="text" placeholder="e.g. 123 Main St, Doylestown PA" value={smAddress} onChange={e => setSmAddress(e.target.value)}
                        style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: '#1a1a1a', fontSize: 13, padding: '7px 8px', outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 11, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>NOTES (OPTIONAL)</label>
                      <input type="text" placeholder="e.g. Bring sample tile selections" value={smNotes} onChange={e => setSmNotes(e.target.value)}
                        style={{ width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 5, color: '#1a1a1a', fontSize: 13, padding: '7px 8px', outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ marginTop: 8, padding: '6px 8px', background: 'rgba(200,140,0,0.04)', borderRadius: 6, fontSize: 12, color: '#6a6058', lineHeight: 1.5 }}>
                      <span style={{ color: '#c88c00', fontWeight: 600 }}>How it works:</span> Creates the appointment in Loop (GHL) so auto-reminders fire, plus adds a schedule task in JobTread so the team sees it.
                    </div>
                    <button onClick={createScheduledMeeting} disabled={!smCalendarId || !smJobId || !smTitle.trim() || !smDate || !smTime || creatingSm}
                      style={{ marginTop: 12, width: '100%', padding: '10px', borderRadius: 6, border: 'none',
                        background: (!smCalendarId || !smJobId || !smTitle.trim() || !smDate || !smTime) ? '#333' : '#c88c00',
                        color: (!smCalendarId || !smJobId || !smTitle.trim() || !smDate || !smTime) ? '#666' : '#ffffff',
                        fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        cursor: (!smCalendarId || !smJobId || !smTitle.trim() || !smDate || !smTime) ? 'default' : 'pointer',
                        opacity: creatingSm ? 0.5 : 1 }}>
                      {creatingSm ? <><Loader2 size={15} className="animate-spin" /> Creating...</> : <><Calendar size={15} /> Schedule Meeting</>}
                    </button>
                  </div>
                )}
                {sorted.length === 0 && panelTab !== 'waitingOn' && panelTab !== 'scheduleMeeting' && (
                  <div style={{ textAlign: 'center', padding: '30px 16px', color: '#5a5550' }}>
                    <Hourglass size={24} style={{ color: '#e8e5e0', marginBottom: 8 }} />
                    <div style={{ fontSize: 14, marginBottom: 4 }}>No open items</div>
                    <div style={{ fontSize: 12 }}>Select the Waiting On tab to start tracking</div>
                  </div>
                )}
                {sorted.map((task: any) => {
                  const isExpanded = expandedWoTask === task.id;
                  const isCompleting = completingWoId === task.id;
                  const ac = agingColor(task.daysUntilDue);
                  const ab = agingBg(task.daysUntilDue);
                  const displayName = stripWoPrefix(task.name);
                  const comments = woComments[task.id];
                  const isLoadingComments = loadingWoComments === task.id;
                  return (
                    <div key={task.id} style={{ marginBottom: 3, borderRadius: 6, background: ab, border: '1px solid rgba(200,140,0,0.04)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px' }}>
                        <button onClick={() => completeWoTask(task.id)} disabled={isCompleting} title="Mark resolved"
                          style={{ width: 20, height: 20, borderRadius: '50%', border: `1.5px solid ${ac}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isCompleting ? 0.4 : 1 }}>
                          {isCompleting ? <Loader2 size={12} className="animate-spin" style={{ color: '#8a8078' }} /> : <Check size={12} style={{ color: ac }} />}
                        </button>
                        <button onClick={() => { setSelectedCalTask(task); setCalEditingDate(task.endDate?.split?.('T')?.[0] || task.endDate || ''); }}
                          title="Click to edit task"
                          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' as const, padding: 0 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, fontWeight: 500 }}>{displayName}</div>
                            <div style={{ fontSize: 12, color: '#5a5550', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{task.jobName?.replace(/^#\d+\s*/, '') || ''}</div>
                          </div>
                        </button>
                        <button onClick={() => { if (isExpanded) { setExpandedWoTask(null); } else { setExpandedWoTask(task.id); fetchWoComments(task.id); } }}
                          title="Toggle comments"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
                          <ChevronRight size={13} style={{ color: '#5a5550', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                        </button>
                        <div style={{ fontSize: 12, color: ac, fontWeight: 600, flexShrink: 0, minWidth: 40, textAlign: 'right' as const }}>
                          {task.daysUntilDue !== null ? (task.daysUntilDue < 0 ? Math.abs(task.daysUntilDue) + 'd ago' : task.daysUntilDue === 0 ? 'Today' : task.daysUntilDue + 'd') : 'No date'}
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '0 8px 8px 34px' }}>
                          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                            <input type="text" placeholder="Add a note..." value={woNewComment} onChange={e => setWoNewComment(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter' && woNewComment.trim()) postWoComment(task.id); }}
                              style={{ flex: 1, background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.12)', borderRadius: 5, color: '#1a1a1a', fontSize: 13, padding: '5px 8px', outline: 'none' }} />
                            <button onClick={() => postWoComment(task.id)} disabled={!woNewComment.trim() || postingWoComment}
                              style={{ background: woNewComment.trim() ? '#c88c00' : 'rgba(200,140,0,0.15)', border: 'none', borderRadius: 5, padding: '5px 8px', cursor: woNewComment.trim() ? 'pointer' : 'default', lineHeight: 0, opacity: postingWoComment ? 0.5 : 1 }}>
                              <Send size={13} style={{ color: woNewComment.trim() ? '#ffffff' : '#5a5550' }} />
                            </button>
                          </div>
                          {isLoadingComments && (<div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0' }}><Loader2 size={12} className="animate-spin" style={{ color: '#5a5550' }} /><span style={{ fontSize: 12, color: '#5a5550' }}>Loading...</span></div>)}
                          {comments && comments.length === 0 && !isLoadingComments && (<div style={{ fontSize: 12, color: '#e8e5e0', padding: '2px 0' }}>No comments yet</div>)}
                          {comments && comments.slice(0, 8).map((cm: any, i: number) => (
                            <div key={cm.id || i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(200,140,0,0.04)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: '#c88c00' }}>{cm.name || 'Unknown'}</span>
                                {cm.createdAt && <span style={{ fontSize: 11, color: '#e8e5e0' }}>{timeAgo(cm.createdAt)}</span>}
                              </div>
                              <div style={{ fontSize: 13, color: '#3a3530', lineHeight: '15px' }}>{cm.message}</div>
                            </div>
                          ))}
                          {comments && comments.length > 8 && (<div style={{ fontSize: 11, color: '#5a5550', padding: '3px 0' }}>+{comments.length - 8} more in JobTread</div>)}
                          {task.jobId && (<a href={`https://app.jobtread.com/jobs/${task.jobId}/schedule`} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#5a5550', marginTop: 4, textDecoration: 'none' }}><ExternalLink size={11} /> View in JobTread</a>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              </div>
        );
      })()}

      {/* BILL REVIEW BANNER — flagged vendor-bill lines from the nightly 4am scan */}
      {billReviewStats && billReviewStats.pendingTotal > 0 && (
        <a
          href="/dashboard/bill-review"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            marginBottom: isTouch ? 10 : 6,
            background: '#fef3c7',
            border: '1px solid rgba(200,140,0,0.25)',
            borderRadius: 8,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <Receipt size={14} style={{ color: '#c88c00', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
              {billReviewStats.pendingTotal} bill line{billReviewStats.pendingTotal === 1 ? '' : 's'} need review
            </div>
            <div style={{ fontSize: 11, color: '#5a5550', marginTop: 1 }}>
              {billReviewStats.pendingByType.uncategorized > 0 && (
                <>{billReviewStats.pendingByType.uncategorized} uncategorized</>
              )}
              {billReviewStats.pendingByType.miscategorized > 0 && (
                <>{billReviewStats.pendingByType.uncategorized > 0 ? ' · ' : ''}
                  {billReviewStats.pendingByType.miscategorized} possibly miscategorized
                </>
              )}
              {billReviewStats.pendingByType.budget_gap > 0 && (
                <>{(billReviewStats.pendingByType.uncategorized + billReviewStats.pendingByType.miscategorized) > 0 ? ' · ' : ''}
                  {billReviewStats.pendingByType.budget_gap} budget gap{billReviewStats.pendingByType.budget_gap === 1 ? '' : 's'}
                </>
              )}
            </div>
          </div>
          <span style={{ fontSize: 11, color: '#c88c00', fontWeight: 600, letterSpacing: '0.04em' }}>
            REVIEW →
          </span>
        </a>
      )}

      {/* KPI GRID — Terri-specific: Active Jobs, Unread Emails, Due Today, Overdue, Pending COs, Outstanding Invoices */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: isTouch ? 6 : 4, marginBottom: isTouch ? 10 : 6 }}>
        {/* KPI 1: Active Jobs — clickable */}
        <button
          onClick={() => setShowSection(showSection === 'activejobs' ? false : 'activejobs')}
          style={{ background: showSection === 'activejobs' ? 'rgba(200,140,0,0.1)' : '#f8f6f3', borderRadius: 6, padding: '6px 7px', border: 'none', borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: '#c88c00', cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
            <Building2 size={11} style={{ color: '#c88c00' }} />
            <span style={{ fontSize: 9, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>ACTIVE JOBS</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#c88c00', lineHeight: 1 }}>
            {stats?.activeJobCount || 0}
          </div>
        </button>

        {/* KPI 2: Unread Emails — requires Terri Gmail auth (brett@brettkingbuilder.com) */}
        {(() => {
          const unread = stats?.unreadEmailCount || 0;
          const hasUnread = unread > 0;
          return (
            <div style={{ background: '#f8f6f3', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${hasUnread ? '#c88c00' : '#5a5550'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <Mail size={11} style={{ color: hasUnread ? '#c88c00' : '#5a5550' }} />
                <span style={{ fontSize: 9, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>UNREAD EMAILS</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: hasUnread ? '#c88c00' : '#5a5550', lineHeight: 1 }}>
                {unread}
              </div>
            </div>
          );
        })()}

        {/* KPI 3: Due Today — clickable, shows tasks due today */}
        {(() => {
          const dueToday = tasks.filter(t => t.daysUntilDue !== null && t.daysUntilDue === 0).length;
          const hasDue = dueToday > 0;
          return (
            <button
              onClick={() => setShowSection(showSection === 'tasks' ? false : 'tasks')}
              style={{ background: showSection === 'tasks' ? 'rgba(200,140,0,0.08)' : '#f8f6f3', borderRadius: 6, padding: '6px 7px', border: 'none', borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: hasDue ? '#c88c00' : '#5a5550', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <CalendarDays size={11} style={{ color: hasDue ? '#c88c00' : '#5a5550' }} />
                <span style={{ fontSize: 9, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>DUE TODAY</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: hasDue ? '#c88c00' : '#5a5550', lineHeight: 1 }}>
                {dueToday}
              </div>
            </button>
          );
        })()}

        {/* KPI 4: Overdue — clickable */}
        <button
          onClick={() => setShowSection(showSection === 'overdue' ? false : 'overdue')}
          style={{ background: showSection === 'overdue' ? 'rgba(239,68,68,0.1)' : '#f8f6f3', borderRadius: 6, padding: '6px 7px', border: 'none', borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: overdueTasks.length > 0 ? '#ef4444' : '#22c55e', cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
            <AlertTriangle size={11} style={{ color: overdueTasks.length > 0 ? '#ef4444' : '#22c55e' }} />
            <span style={{ fontSize: 9, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>OVERDUE</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: overdueTasks.length > 0 ? '#ef4444' : '#22c55e', lineHeight: 1 }}>
            {overdueTasks.length}
          </div>
        </button>

        {/* KPI 5: Pending Change Orders — clickable */}
        {(() => {
          const pending = stats?.pendingCOCount || 0;
          const approved = stats?.approvedCOCount || 0;
          const hasPending = pending > 0;
          const isActive = showSection === 'changeorders';
          return (
            <button
              onClick={() => setShowSection(isActive ? false : 'changeorders')}
              style={{ background: isActive ? 'rgba(245,158,11,0.1)' : '#f8f6f3', borderRadius: 6, padding: '6px 7px', border: 'none', borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: hasPending ? '#f59e0b' : '#22c55e', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <FileWarning size={11} style={{ color: hasPending ? '#f59e0b' : '#22c55e' }} />
                <span style={{ fontSize: 9, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>PENDING COs</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: hasPending ? '#f59e0b' : '#22c55e', lineHeight: 1 }}>
                {pending}
              </div>
              {(pending + approved) > 0 && (
                <div style={{ fontSize: 10, color: '#6a6058', marginTop: 2 }}>
                  {approved} approved
                </div>
              )}
            </button>
          );
        })()}

        {/* KPI 6: Outstanding Invoices — clickable, shows unpaid invoices with AR follow-up history */}
        {(() => {
          const invoiceCount = outstandingInvoices.length;
          const hasInvoices = invoiceCount > 0;
          const invoicesWithReminders = outstandingInvoices.filter(inv => inv.arAutoSent && inv.arAutoSent.length > 0).length;
          const isActive = showSection === 'invoices';
          return (
            <button
              onClick={() => setShowSection(isActive ? false : 'invoices')}
              style={{ background: isActive ? 'rgba(245,158,11,0.1)' : '#f8f6f3', borderRadius: 6, padding: '6px 7px', border: 'none', borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: hasInvoices ? '#f59e0b' : '#22c55e', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <Receipt size={11} style={{ color: hasInvoices ? '#f59e0b' : '#22c55e' }} />
                <span style={{ fontSize: 9, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>UNPAID INV</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: hasInvoices ? '#f59e0b' : '#22c55e', lineHeight: 1 }}>
                {invoiceCount}
              </div>
              {hasInvoices && invoicesWithReminders > 0 && (
                <div style={{ fontSize: 10, color: '#6a6058', marginTop: 2 }}>
                  {invoicesWithReminders} followed up
                </div>
              )}
            </button>
          );
        })()}
      </div>

      {/* ACTIVE JOBS LIST — shows when Active Jobs KPI is clicked */}
      {showSection === 'activejobs' && (() => {
        const jobs = overview?.data?.activeJobs || [];
        return (
          <div style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 6, maxHeight: 300, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#c88c00', marginBottom: 4, letterSpacing: '0.04em' }}>Active Jobs</div>
            {jobs.length === 0 && (
              <p style={{ color: '#5a5550', fontSize: 13, textAlign: 'center', padding: 8 }}>No active jobs</p>
            )}
            {jobs.map((job: any) => (
              <a
                key={job.id}
                href={`https://app.jobtread.com/jobs/${job.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: '1px solid rgba(200,140,0,0.04)', textDecoration: 'none', cursor: 'pointer' }}
              >
                <Building2 size={14} style={{ color: '#c88c00', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, color: '#1a1a1a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.name}</p>
                  <p style={{ fontSize: 11, color: '#6a6058', margin: 0 }}>#{job.number}</p>
                </div>
                <ExternalLink size={12} style={{ color: '#5a5550', flexShrink: 0 }} />
              </a>
            ))}
          </div>
        );
      })()}

      {/* PENDING CHANGE ORDERS â expandable from KPI card click */}
      {showSection === 'changeorders' && (
        <div style={{ background: '#f8f6f3', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, padding: '8px 10px', marginBottom: isTouch ? 10 : 6, maxHeight: 340, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <FileWarning size={12} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b', letterSpacing: '0.04em' }}>
                CHANGE ORDERS ({changeOrders.length})
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#f59e0b' }}>{changeOrders.filter(co => co.status === 'pending').length} pending</span>
              <span style={{ fontSize: 11, color: '#22c55e' }}>{changeOrders.filter(co => co.status === 'approved').length} approved</span>
            </div>
          </div>
          {changeOrders.length === 0 ? (
            <p style={{ color: '#5a5550', fontSize: 13, textAlign: 'center', padding: 8 }}>No change orders</p>
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(200,140,0,0.08)' }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {jobName.replace(/^#\d+\s*/, '')}
                    </p>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {pendingCount > 0 && (
                        <span style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '1px 5px', borderRadius: 3 }}>
                          {pendingCount} pending
                        </span>
                      )}
                      {approvedCount > 0 && (
                        <span style={{ fontSize: 11, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '1px 5px', borderRadius: 3 }}>
                          {approvedCount} approved
                        </span>
                      )}
                    </div>
                  </div>
                  {cos.map((co, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0 3px 12px' }}>
                      {co.status === 'approved'
                        ? <FileCheck size={12} style={{ color: '#22c55e', flexShrink: 0 }} />
                        : <FileWarning size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
                      }
                      <p style={{ fontSize: 12, color: co.status === 'approved' ? '#6a6058' : '#1a1a1a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

      {/* EXPANDED TASK LIST â shows when KPI card is clicked */}
      {showSection && ['overdue', 'tasks'].includes(showSection) && (() => {
        const sectionTasks = showSection === 'overdue' ? overdueTasks : tasks;
        const sectionLabel = showSection === 'overdue' ? 'Overdue Tasks' : 'All Open Tasks';
        const sectionColor = showSection === 'overdue' ? '#ef4444' : '#c88c00';

        return (
          <div style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 6, maxHeight: 300, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: sectionColor, marginBottom: 4, letterSpacing: '0.04em' }}>{sectionLabel}</div>
            {sectionTasks.length === 0 && (
              <p style={{ color: '#5a5550', fontSize: 13, textAlign: 'center', padding: 8 }}>None</p>
            )}
            {sectionTasks.slice(0, 20).map(task => {
              const isCompleting = completingTaskId === task.id;
              const isEditingDate = editingDateTaskId === task.id;
              return (
                <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderBottom: '1px solid rgba(200,140,0,0.04)', opacity: isCompleting ? 0.4 : 1 }}>
                  <button
                    onClick={() => completeTask(task.id)}
                    disabled={isCompleting}
                    style={{ width: isTouch ? 24 : 18, height: isTouch ? 24 : 18, borderRadius: '50%', border: '1px solid rgba(200,140,0,0.25)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    {isCompleting
                      ? <Loader2 size={12} className="animate-spin" style={{ color: '#8a8078' }} />
                      : <CheckCircle2 size={12} style={{ color: '#22c55e' }} />
                    }
                  </button>
                  <div
                    onClick={() => { setSelectedCalTask(task); setCalEditingDate(task.endDate || ''); }}
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                  >
                    <p style={{ fontSize: 13, color: '#1a1a1a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name}</p>
                    <p style={{ fontSize: 11, color: '#6a6058', margin: 0 }}>{task.jobName} #{task.jobNumber}</p>
                    {task.description && (
                      <p style={{ fontSize: 11, color: '#8a8078', margin: '2px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</p>
                    )}
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
                      style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, background: '#f0eeeb', border: '1px solid rgba(200,140,0,0.3)', color: '#1a1a1a', width: 110, flexShrink: 0 }}
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
                          style={{ fontSize: 11, color: '#eab308', background: 'rgba(234,179,8,0.1)', padding: '1px 4px', borderRadius: 3, border: '1px solid rgba(234,179,8,0.2)', cursor: 'pointer' }}
                        >
                          +1d
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingDateTaskId(task.id); setPendingDate(task.endDate || ''); }}
                        style={{ fontSize: 12, color: task.daysUntilDue !== null && task.daysUntilDue < 0 ? '#ef4444' : task.daysUntilDue !== null && task.daysUntilDue <= 2 ? '#eab308' : '#6a6058', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        {task.daysUntilDue !== null
                          ? (task.daysUntilDue < 0 ? `${Math.abs(task.daysUntilDue)}d overdue` : task.daysUntilDue === 0 ? 'Today' : task.daysUntilDue === 1 ? 'Tomorrow' : (() => { const d = new Date(); d.setDate(d.getDate() + task.daysUntilDue); return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`; })())
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

      {/* TODAY'S FOCUS — data-driven action card replacing AI Briefing */}
      {(() => {
        const todayDue = tasks.filter(t => t.daysUntilDue !== null && t.daysUntilDue === 0);
        const overdueCount = overdueTasks.length;
        const woCount = tasks.filter(t => isWaitingOn(t.name)).length;
        // Pick the single most actionable item
        let focusItem: { label: string; color: string } | null = null;
        if (overdueCount > 0) {
          const worst = [...overdueTasks].sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0))[0];
          focusItem = { label: `${worst.name.replace(/^[^\w]*/, '').substring(0, 50)} — ${worst.jobName}`, color: '#ef4444' };
        } else if (todayDue.length > 0) {
          focusItem = { label: `${todayDue[0].name.replace(/^[^\w]*/, '').substring(0, 50)} — ${todayDue[0].jobName}`, color: '#f59e0b' };
        }
        const bullets: Array<{ emoji: string; text: string; color: string }> = [];
        if (overdueCount > 0) bullets.push({ emoji: '🔴', text: `${overdueCount} overdue task${overdueCount !== 1 ? 's' : ''}`, color: '#ef4444' });
        if (todayDue.length > 0) bullets.push({ emoji: '📋', text: `${todayDue.length} task${todayDue.length !== 1 ? 's' : ''} due today`, color: '#f59e0b' });
        if (woCount > 0) bullets.push({ emoji: '⏳', text: `${woCount} waiting-on item${woCount !== 1 ? 's' : ''}`, color: '#eab308' });
        // Day-aware weekly rhythm nudge
        const dayNudges: Record<number, string> = {
          1: '📋 Payroll day — check that all hours are entered in JT',
          2: '🔍 Job review day — check active jobs & client payments',
          3: '💳 AP day — enter vendor invoices & process payments',
          4: '🔍 Job review day — check active jobs & client payments',
          5: '🏦 Bank review day — reconcile CC transactions & bank accounts',
        };
        const dayNudge = dayNudges[new Date().getDay()] || null;
        if (bullets.length === 0 && !focusItem && !dayNudge) return null;
        return (
          <div style={{ background: 'rgba(200,140,0,0.06)', border: '1px solid rgba(200,140,0,0.12)', borderRadius: 8, padding: '8px 10px', marginBottom: isTouch ? 10 : 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
              <Target size={12} style={{ color: '#c88c00' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#c88c00', letterSpacing: '0.04em' }}>TODAY&apos;S FOCUS</span>
            </div>
            {focusItem && (
              <div style={{ fontSize: 14, color: focusItem.color, fontWeight: 600, marginBottom: 5, lineHeight: 1.4 }}>
                → {focusItem.label}
              </div>
            )}
            {bullets.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                {bullets.map((b, i) => (
                  <span key={i} style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5 }}>
                    {b.emoji} <span style={{ color: b.color, fontWeight: 600 }}>{b.text}</span>
                  </span>
                ))}
              </div>
            )}
            {dayNudge && (
              <div style={{ fontSize: 13, color: '#8a8078', marginTop: bullets.length > 0 || focusItem ? 5 : 0, lineHeight: 1.4 }}>
                {dayNudge}
              </div>
            )}
          </div>
        );
      })()}


      {/* WAITING ON — persistent collapsible strip */}
      {(() => {
        const woItems = tasks.filter(t => isWaitingOn(t.name));
        if (woItems.length === 0) return null;
        function agingDays(t: any): number | null {
          if (!t.endDate) return null;
          return Math.round((new Date(t.endDate).getTime() - Date.now()) / 86400000);
        }
        function agingColor(d: number | null): string { if (d === null) return '#6a6058'; if (d < -7) return '#ef4444'; if (d < -3) return '#f97316'; if (d < 0) return '#eab308'; return '#22c55e'; }
        function agingBg(d: number | null): string { if (d === null) return 'transparent'; if (d < -7) return 'rgba(239,68,68,0.08)'; if (d < -3) return 'rgba(249,115,22,0.08)'; if (d < 0) return 'rgba(234,179,8,0.06)'; return 'rgba(34,197,94,0.06)'; }
        const sorted = [...woItems].sort((a, b) => {
          const da = agingDays(a); const db = agingDays(b);
          if (da === null && db === null) return 0; if (da === null) return 1; if (db === null) return -1;
          return da - db;
        });

        async function handleWoDateSave(taskId: string) {
          if (!editingWoDateVal) return;
          setSavingWoDate(true);
          try {
            const res = await fetch('/api/dashboard/waiting-on', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, endDate: editingWoDateVal }),
            });
            if (res.ok) {
              setEditingWoDateId(null);
              setEditingWoDateVal('');
              // Refresh data
              window.dispatchEvent(new Event('refreshDashboard'));
            }
          } catch (e) { console.error('Date update failed', e); }
          setSavingWoDate(false);
        }

        async function handleWoComplete(taskId: string) {
          setCompletingWoId(taskId);
          try {
            const res = await fetch('/api/dashboard/waiting-on', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, markComplete: true }),
            });
            if (res.ok) {
              window.dispatchEvent(new Event('refreshDashboard'));
            }
          } catch (e) { console.error('Complete failed', e); }
          setCompletingWoId(null);
        }

        return (
          <div style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.15)', borderRadius: 8, padding: '8px 10px', marginBottom: isTouch ? 10 : 6 }}>
            {/* Header row — clickable to collapse/expand */}
            <button
              onClick={() => setWoRibbonCollapsed(!woRibbonCollapsed)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: woRibbonCollapsed ? 0 : 6 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Hourglass size={12} style={{ color: '#eab308' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#eab308', letterSpacing: '0.04em' }}>
                  WAITING ON ({woItems.length})
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {false && woItems.length > 5 && !woRibbonCollapsed && (
                  <span onClick={(e) => { e.stopPropagation(); setShowWaitingOnPanel(true); }} style={{ fontSize: 11, color: '#c88c00', cursor: 'pointer' }}>
                    View all <ChevronRight size={11} style={{ display: 'inline', verticalAlign: 'middle' }} />
                  </span>
                )}
                {woRibbonCollapsed ? <ChevronDown size={14} style={{ color: '#eab308' }} /> : <ChevronUp size={14} style={{ color: '#eab308' }} />}
              </div>
            </button>

            {/* Collapsible task list — grouped by job */}
            {!woRibbonCollapsed && (() => {
              // Group WO tasks by job name
              const woJobGroups = new Map<string, typeof sorted>();
              for (const t of sorted) {
                const key = t.jobName || 'Unassigned';
                if (!woJobGroups.has(key)) woJobGroups.set(key, []);
                woJobGroups.get(key)!.push(t);
              }
              // Sort job groups A-Z by name
              const sortedWoJobs = Array.from(woJobGroups.entries()).sort((a, b) =>
                a[0].replace(/^#\d+\s*/, '').localeCompare(b[0].replace(/^#\d+\s*/, ''))
              );
              return sortedWoJobs.map(([jobName, jobWoTasks]) => {
                const c = jobColor(jobWoTasks[0]?.jobNumber || '');
                const overdueCount = jobWoTasks.filter(t => { const dd = agingDays(t); return dd !== null && dd < 0; }).length;
                return (
                  <div key={jobName} style={{ marginBottom: 4 }}>
                    {/* Job header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px 2px 4px' }}>
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: c, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {jobName.replace(/^#\d+\s*/, '')}
                      </span>
                      <span style={{ fontSize: 11, color: '#6a6058', flexShrink: 0 }}>{jobWoTasks.length}</span>
                      {overdueCount > 0 && (
                        <span style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>
                          {overdueCount} late
                        </span>
                      )}
                    </div>
                    {/* Tasks under this job */}
                    <div style={{ paddingLeft: 12 }}>
                      {jobWoTasks.map((t, i) => {
                        const d = agingDays(t);
                        const label = stripWoPrefix(t.name);
                        const isEditingDate = editingWoDateId === t.id;
                        const isCompleting = completingWoId === t.id;
                        return (
                          <div key={t.id || i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderRadius: 6, background: agingBg(d), marginBottom: 2 }}>
                            {/* Complete button */}
                            <button
                              onClick={() => handleWoComplete(t.id)}
                              disabled={isCompleting}
                              title="Mark complete"
                              style={{ background: 'none', border: '1px solid rgba(200,140,0,0.2)', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, padding: 0, opacity: isCompleting ? 0.4 : 1 }}
                            >
                              {isCompleting ? <Loader2 size={10} style={{ color: '#c88c00' }} className="animate-spin" /> : <Check size={10} style={{ color: '#6a6058' }} />}
                            </button>
                            {/* Task label — clickable to open edit modal */}
                            <button
                              onClick={() => { setSelectedCalTask(t); setCalEditingDate(t.endDate?.split('T')[0] || ''); }}
                              style={{ fontSize: 13, color: '#1a1a1a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, margin: 0 }}
                              title="Click to edit task"
                            >{label}</button>
                            {/* Date display / edit */}
                            {isEditingDate ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="date"
                                  value={editingWoDateVal}
                                  onChange={(e) => setEditingWoDateVal(e.target.value)}
                                  style={{ fontSize: 11, background: '#f0eeeb', border: '1px solid rgba(200,140,0,0.3)', borderRadius: 4, color: '#1a1a1a', padding: '1px 4px', width: 110 }}
                                />
                                <button onClick={() => handleWoDateSave(t.id)} disabled={savingWoDate} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                  <Check size={12} style={{ color: '#22c55e' }} />
                                </button>
                                <button onClick={() => { setEditingWoDateId(null); setEditingWoDateVal(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                  <X size={12} style={{ color: '#6a6058' }} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setEditingWoDateId(t.id); setEditingWoDateVal(t.endDate?.split('T')[0] || ''); }}
                                title="Edit due date"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2 }}
                              >
                                {d !== null && <span style={{ fontSize: 11, color: agingColor(d) }}>{d < 0 ? `${Math.abs(d)}d late` : d === 0 ? 'today' : `${d}d`}</span>}
                                <Calendar size={11} style={{ color: '#6a6058' }} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        );
      })()}


      {/* OUTSTANDING INVOICES — expandable from KPI card click */}
      {showSection === 'invoices' && (
        <div style={{ background: '#f8f6f3', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, padding: '8px 10px', marginBottom: isTouch ? 10 : 6, maxHeight: 440, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Receipt size={12} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#f59e0b', letterSpacing: '0.04em' }}>
                OUTSTANDING INVOICES ({outstandingInvoices.length})
              </span>
            </div>
            {outstandingInvoices.length > 0 && (
              <span style={{ fontSize: 11, color: '#6a6058' }}>
                Total: ${(stats?.outstandingInvoiceTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            )}
          </div>
          {outstandingInvoices.length === 0 ? (
            <p style={{ color: '#22c55e', fontSize: 13, textAlign: 'center', padding: 8 }}>All invoices paid</p>
          ) : (
            outstandingInvoices.map((inv) => {
              const isOverdue = inv.daysPending > 30;
              const isWarning = inv.daysPending > 14;
              const statusColor = isOverdue ? '#ef4444' : isWarning ? '#f59e0b' : '#6a6058';
              const hasArAuto = inv.arAutoSent && inv.arAutoSent.length > 0;
              const reminderCount = hasArAuto ? inv.arAutoSent!.length : 0;
              const isHeld = inv.arHold === true;
              return (
                <div key={inv.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(200,140,0,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 5, height: 5, borderRadius: 3, background: statusColor, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, color: '#1a1a1a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inv.jobName.replace(/^#\d+\s*/, '')}
                      </p>
                      <p style={{ fontSize: 11, color: '#6a6058', margin: 0 }}>
                        Invoice #{inv.documentNumber}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', margin: 0 }}>
                        ${inv.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                      <p style={{ fontSize: 11, color: statusColor, margin: 0, fontWeight: isOverdue ? 600 : 400 }}>
                        {inv.daysPending}d pending
                      </p>
                    </div>
                  </div>
                  {/* AR Follow-Up Summary + Timeline */}
                  <div style={{ marginLeft: 13, marginTop: 4 }}>
                    {/* Follow-up count badge row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {isHeld && (
                        <span style={{ fontSize: 10, background: 'rgba(239,68,68,0.12)', color: '#f87171', padding: '1px 5px', borderRadius: 3, fontWeight: 500 }}>
                          AR-HOLD
                        </span>
                      )}
                      {hasArAuto ? (
                        <span style={{ fontSize: 10, background: 'rgba(34,197,94,0.1)', color: '#4ade80', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
                          {reminderCount} follow-up{reminderCount !== 1 ? 's' : ''} sent
                        </span>
                      ) : !isHeld ? (
                        <span style={{ fontSize: 10, color: '#5a5550', fontStyle: 'italic' }}>
                          No follow-ups sent
                        </span>
                      ) : null}
                    </div>
                    {/* Full AR reminder timeline — always visible when reminders exist */}
                    {hasArAuto && (
                      <div style={{ marginTop: 4, paddingLeft: 2, borderLeft: '2px solid rgba(34,197,94,0.15)' }}>
                        {inv.arAutoSent!.map((ar, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 2px 6px' }}>
                            <Send size={9} style={{ color: '#4ade80', flexShrink: 0 }} />
                            <span style={{ fontSize: 11, color: '#b0a898' }}>
                              {new Date(ar.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                            <span style={{ fontSize: 10, background: 'rgba(200,140,0,0.08)', color: '#8a7e72', padding: '0px 4px', borderRadius: 2 }}>
                              {ar.tier}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* AR AUTOMATED REMINDERS â compact status bar */}
      {arStats && arStats.totalRemindersSent > 0 && (
        <div style={{ background: '#f8f6f3', border: '1px solid rgba(34,197,94,0.12)', borderRadius: 8, padding: '6px 10px', marginBottom: isTouch ? 10 : 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Send size={12} style={{ color: '#4ade80' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#4ade80', letterSpacing: '0.04em' }}>
                AR REMINDERS
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{arStats.totalRemindersSent}</span>
              <span style={{ fontSize: 11, color: '#6a6058' }}>sent</span>
            </div>
            <div style={{ width: 1, height: 14, background: 'rgba(200,140,0,0.08)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>{arStats.activeJobs}</span>
              <span style={{ fontSize: 11, color: '#6a6058' }}>active</span>
            </div>
            {arStats.jobsOnHold > 0 && (
              <>
                <div style={{ width: 1, height: 14, background: 'rgba(200,140,0,0.08)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#f87171' }}>{arStats.jobsOnHold}</span>
                  <span style={{ fontSize: 11, color: '#6a6058' }}>paused</span>
                </div>
              </>
            )}
            {arStats.recentReminders.length > 0 && (
              <>
                <div style={{ width: 1, height: 14, background: 'rgba(200,140,0,0.08)' }} />
                <span style={{ fontSize: 11, color: '#6a6058' }}>
                  Last: {new Date(arStats.recentReminders[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} â {arStats.recentReminders[0].jobName.replace(/^#\d+\s*/, '').split(' ').slice(0, 3).join(' ')} ({arStats.recentReminders[0].tier})
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* TWO-WEEK TASK CALENDAR */}
      {weeks.map((week, wi) => (
        <div key={wi} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <Calendar size={13} style={{ color: '#c88c00' }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#5a5550' }}>{week.label.toUpperCase()}</span>
            <span style={{ fontSize: 12, color: '#3f3f3f' }}>{week.days[0].month} {week.days[0].dayNum} â {week.days[6].month} {week.days[6].dayNum}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, borderRadius: 8, overflow: 'hidden' }}>
            {week.days.map(day => {
              const isToday = day.date === todayStr;
              const dayTasks = tasksByDate[day.date] || [];
              const incomplete = dayTasks.filter(t => t.progress < 1);
              const complete = dayTasks.filter(t => t.progress >= 1);
              const dayCalEvents = calEventsByDate[day.date] || [];

              return (
                <div key={day.date} style={{
                  background: isToday ? 'rgba(200,140,0,0.1)' : '#ffffff',
                  minHeight: 80, display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '3px 5px 2px' }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: day.isWeekend ? '#e8e5e0' : '#6a6058' }}>{day.dayName}</span>
                    <span style={{
                      fontSize: 15, fontWeight: 700,
                      color: isToday ? '#c88c00' : day.isWeekend ? '#e8e5e0' : '#7a7068',
                      ...(isToday ? { background: 'rgba(200,140,0,0.25)', borderRadius: 4, padding: '0 4px' } : {}),
                    }}>{day.dayNum}</span>
                  </div>
                  <div style={{ flex: 1, padding: '1px 2px 3px', display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                    {/* Google Calendar events */}
                    {dayCalEvents.map((ev: any) => {
                      const timeStr = ev.allDay ? '' : ev.start?.includes('T')
                        ? new Date(ev.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                        : '';
                      return (
                        <div
                          key={ev.id}
                          style={{
                            padding: '2px 3px', borderRadius: 3,
                            borderLeft: '3px solid #4A90D9',
                            background: '#4A90D918',
                            fontSize: 11, lineHeight: '12px', color: '#a8c4e0',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                          title={`${timeStr ? timeStr + ' \u2014 ' : ''}${ev.summary}${ev.location ? ' @ ' + ev.location : ''}`}
                        >
                          {timeStr ? <span style={{ color: '#6aa3d9', marginRight: 3 }}>{timeStr}</span> : null}
                          {ev.summary}
                        </div>
                      );
                    })}
                    {/* JobTread tasks */}
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
                            fontSize: 11, lineHeight: '12px', color: '#1a1a1a',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                          title={`${task.name} â ${task.jobName}`}
                        >
                          {task.name}
                        </div>
                      );
                    })}
                    {complete.length > 0 && (
                      <div style={{ fontSize: 10, color: '#e8e5e0', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <CheckCircle2 size={9} style={{ color: '#22c55e' }} /> {complete.length} done
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}


      {/* ALL TASKS â grouped by job, collapsible, filtered to overdue + next 4 weeks */}
      {tasks.length > 0 && (() => {
        // Filter tasks: overdue or due within next 4 weeks (28 days)
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const fourWeeksOut = new Date(today);
        fourWeeksOut.setDate(today.getDate() + 28);
        const rangeEndStr = fourWeeksOut.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const todayStr2 = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        const filteredTasks = tasks.filter(t => {
          if (!t.endDate) return true; // No date = show (could be urgent)
          const d = new Date(t.endDate + 'T12:00:00');
          return d <= fourWeeksOut; // Overdue (before today) or within 4 weeks
        });

        const jobGroups = new Map<string, typeof tasks>();
        for (const t of filteredTasks) {
          const key = t.jobName || 'Unassigned';
          if (!jobGroups.has(key)) jobGroups.set(key, []);
          jobGroups.get(key)!.push(t);
        }
        // Sort jobs A-Z by name
        const sortedJobs = Array.from(jobGroups.entries()).sort((a, b) =>
          a[0].replace(/^#\d+\s*/, '').localeCompare(b[0].replace(/^#\d+\s*/, ''))
        );
        // Filter by search
        const filteredJobs = taskSearch.trim()
          ? sortedJobs.filter(([name]) => name.toLowerCase().includes(taskSearch.toLowerCase()))
          : sortedJobs;
        return (
          <div style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.08)', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ClipboardList size={12} style={{ color: '#c88c00' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#c88c00', letterSpacing: '0.04em' }}>ALL TASKS ({filteredTasks.length})</span>
                <span style={{ fontSize: 10, color: '#5a5550', marginLeft: 2 }}>Overdue thru {rangeEndStr}</span>
              </div>
              <button
                onClick={() => {
                  if (collapsedJobs.size === sortedJobs.length) {
                    setCollapsedJobs(new Set());
                  } else {
                    setCollapsedJobs(new Set(sortedJobs.map(([name]) => name)));
                  }
                }}
                style={{ fontSize: 10, color: '#6a6058', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
              >
                {collapsedJobs.size === sortedJobs.length ? 'Expand All' : 'Collapse All'}
              </button>
            </div>
            {/* Search box */}
            <div style={{ position: 'relative', marginBottom: 6 }}>
              <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#5a5550' }} />
              <input
                type="text"
                placeholder="Search by project name..."
                value={taskSearch}
                onChange={e => setTaskSearch(e.target.value)}
                style={{
                  width: '100%', padding: '5px 8px 5px 26px', fontSize: 13, borderRadius: 5,
                  background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.1)', color: '#1a1a1a',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
              {taskSearch && (
                <button
                  onClick={() => setTaskSearch('')}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0 }}
                >
                  <X size={12} style={{ color: '#5a5550' }} />
                </button>
              )}
            </div>
            {taskSearch && filteredJobs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 12, color: '#5a5550' }}>
                No projects match "{taskSearch}"
              </div>
            )}
            {filteredJobs.map(([jobName, jobTasks]) => {
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button
                      onClick={toggleCollapse}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0,
                        padding: '5px 4px', borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: 'rgba(200,140,0,0.04)', textAlign: 'left',
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: c, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {jobName.replace(/^#\d+\s*/, '')}
                      </span>
                      <span style={{ fontSize: 11, color: '#6a6058', flexShrink: 0 }}>{jobTasks.length}</span>
                      {urgentCount > 0 && (
                        <span style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1px 4px', borderRadius: 3, flexShrink: 0 }}>
                          {urgentCount} overdue
                        </span>
                      )}
                      {isCollapsed ? <ChevronDown size={12} style={{ color: '#5a5550', flexShrink: 0 }} /> : <ChevronUp size={12} style={{ color: '#5a5550', flexShrink: 0 }} />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setNewTaskForm({ jobId: jobTasks[0].jobId, jobName });
                        setNewTaskName('');
                        setNewTaskPhase('In Production');
                        setNewTaskDate('');
                      }}
                      title="Add task to this project"
                      style={{
                        width: 22, height: 22, borderRadius: 4, border: 'none', cursor: 'pointer',
                        background: 'rgba(200,140,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}
                    >
                      <Plus size={13} style={{ color: '#c88c00' }} />
                    </button>
                  </div>
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
                        const statusColor = task.daysUntilDue !== null && task.daysUntilDue < 0 ? '#ef4444' : task.daysUntilDue !== null && task.daysUntilDue <= 2 ? '#eab308' : '#5a5550';
                        const dateLabel = (() => {
                          if (task.daysUntilDue === null) return 'No date';
                          if (task.daysUntilDue < 0) return `${Math.abs(task.daysUntilDue)}d overdue`;
                          if (task.daysUntilDue === 0) return 'Today';
                          if (task.daysUntilDue === 1) return 'Tomorrow';
                          const d = new Date(); d.setDate(d.getDate() + task.daysUntilDue);
                          const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
                          const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          return `${dayName} ${monthDay}`;
                        })();
                        return (
                          <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid rgba(200,140,0,0.04)', opacity: isCompleting ? 0.4 : 1 }}>
                            <button
                              onClick={() => completeTask(task.id)}
                              disabled={isCompleting}
                              style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid rgba(200,140,0,0.25)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                            >
                              {isCompleting
                                ? <Loader2 size={12} className="animate-spin" style={{ color: '#8a8078' }} />
                                : <Check size={12} style={{ color: '#22c55e' }} />
                              }
                            </button>
                            <div
                              onClick={() => { setSelectedCalTask(task); setCalEditingDate(task.endDate || ''); }}
                              style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                            >
                              <p style={{ fontSize: 13, color: '#1a1a1a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name}</p>
                              {task.description && (
                                <p style={{ fontSize: 11, color: '#8a8078', margin: '1px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</p>
                              )}
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
                                style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, background: '#f0eeeb', border: '1px solid rgba(200,140,0,0.3)', color: '#1a1a1a', width: 110, flexShrink: 0, colorScheme: 'dark' }}
                              />
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                <button
                                  onClick={() => { setEditingDateTaskId(task.id); setPendingDate(task.endDate || ''); }}
                                  style={{ fontSize: 12, color: statusColor, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                                >
                                  {dateLabel}
                                </button>
                                {task.jobId && (
                                  <a
                                    href={jtScheduleUrl(task.jobId)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ lineHeight: 0, flexShrink: 0 }}
                                    title="View in JobTread"
                                  >
                                    <ExternalLink size={12} style={{ color: '#5a5550' }} />
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
            background: '#f8f6f3', borderRadius: 12, padding: 16, minWidth: 300, maxWidth: 420,
            border: '1px solid rgba(200,140,0,0.15)', boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', lineHeight: '18px' }}>{selectedCalTask.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: jobColor(selectedCalTask.jobNumber), flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: '#8a8078' }}>#{selectedCalTask.jobNumber} {selectedCalTask.jobName}</span>
                </div>
              </div>
              <button onClick={() => setSelectedCalTask(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                <X size={14} style={{ color: '#6a6058' }} />
              </button>
            </div>

            {/* Description */}
            {selectedCalTask.description && (
              <div style={{ marginBottom: 12, padding: '8px 10px', background: 'rgba(200,140,0,0.06)', borderRadius: 6, border: '1px solid rgba(200,140,0,0.08)' }}>
                <div style={{ fontSize: 13, color: '#a89888', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selectedCalTask.description}</div>
              </div>
            )}

            {/* Comments toggle */}
            <div style={{ marginBottom: 12 }}>
              <button
                onClick={() => {
                  if (taskCommentsOpen) {
                    setTaskCommentsOpen(false);
                  } else {
                    loadTaskComments(selectedCalTask.id);
                  }
                }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(200,140,0,0.12)',
                  background: taskCommentsOpen ? 'rgba(200,140,0,0.08)' : 'transparent',
                  cursor: 'pointer', transition: 'background 0.15s',
                }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#c88c00' }}>
                  <MessageSquare size={14} />
                  Comments
                  {taskComments.length > 0 && taskCommentsOpen && (
                    <span style={{
                      fontSize: 11, background: 'rgba(200,140,0,0.2)', color: '#c88c00',
                      borderRadius: 8, padding: '1px 6px', fontWeight: 700,
                    }}>{taskComments.length}</span>
                  )}
                </span>
                {taskCommentsOpen ? <ChevronUp size={14} style={{ color: '#6a6058' }} /> : <ChevronDown size={14} style={{ color: '#6a6058' }} />}
              </button>

              {/* Comment thread */}
              {taskCommentsOpen && (
                <div style={{
                  marginTop: 6, borderRadius: 6, border: '1px solid rgba(200,140,0,0.08)',
                  background: 'rgba(0,0,0,0.15)', maxHeight: 220, display: 'flex', flexDirection: 'column',
                }}>
                  {/* Messages area */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', minHeight: 40, maxHeight: 160 }}>
                    {taskCommentsLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 }}>
                        <Loader2 size={14} className="animate-spin" style={{ color: '#6a6058' }} />
                        <span style={{ fontSize: 12, color: '#6a6058' }}>Loading...</span>
                      </div>
                    ) : taskComments.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#5a5048', textAlign: 'center', padding: 12 }}>
                        No comments yet
                      </div>
                    ) : (
                      taskComments.map(c => (
                        <div key={c.id} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#c88c00' }}>{(c as any).userName || c.name || 'Team'}</span>
                            <span style={{ fontSize: 10, color: '#5a5048' }}>
                              {new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              {' '}
                              {new Date(c.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            </span>
                            {c.isPinned && <span style={{ fontSize: 9, color: '#c88c00', fontWeight: 700 }}>PINNED</span>}
                          </div>
                          <div style={{ fontSize: 13, color: '#3a3530', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{c.message}</div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Compose */}
                  <div style={{
                    display: 'flex', gap: 6, padding: '6px 8px',
                    borderTop: '1px solid rgba(200,140,0,0.08)',
                  }}>
                    <input
                      type="text"
                      value={taskCommentText}
                      onChange={e => setTaskCommentText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && taskCommentText.trim()) { e.preventDefault(); postTaskComment(); } }}
                      placeholder="Add a comment..."
                      style={{
                        flex: 1, background: '#ffffff', border: '1px solid rgba(200,140,0,0.12)', borderRadius: 6,
                        color: '#1a1a1a', fontSize: 13, padding: '5px 8px', outline: 'none',
                      }}
                    />
                    <button
                      onClick={postTaskComment}
                      disabled={taskCommentSending || !taskCommentText.trim()}
                      style={{
                        background: '#c88c00', color: '#ffffff', border: 'none', borderRadius: 6,
                        padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                        opacity: (taskCommentSending || !taskCommentText.trim()) ? 0.4 : 1,
                      }}>
                      {taskCommentSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Date edit */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 4 }}>DUE DATE</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="date"
                  value={calEditingDate}
                  onChange={e => setCalEditingDate(e.target.value)}
                  style={{
                    flex: 1, background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 6,
                    color: '#1a1a1a', fontSize: 14, padding: '5px 8px',
                  }}
                />
                {calEditingDate !== (selectedCalTask.endDate || '') && (
                  <button onClick={saveCalDate} disabled={calSavingDate}
                    style={{
                      background: '#c88c00', color: '#ffffff', fontSize: 13, fontWeight: 600,
                      padding: '5px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                      opacity: calSavingDate ? 0.5 : 1,
                    }}>
                    {calSavingDate ? 'Saving...' : 'Save'}
                  </button>
                )}
              </div>
              {/* Quick date shortcuts */}
              <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                {[
                  { label: 'Today', offset: 0 },
                  { label: 'Tomorrow', offset: 1 },
                  { label: 'Next Mon', offset: (() => { const d = new Date(); const day = d.getDay(); return day === 0 ? 1 : day === 1 ? 7 : 8 - day; })() },
                  { label: '+1 Week', offset: 7 },
                  { label: '+2 Weeks', offset: 14 },
                ].map(({ label, offset }) => {
                  const d = new Date(); d.setDate(d.getDate() + offset);
                  const val = d.toISOString().split('T')[0];
                  const isActive = calEditingDate === val;
                  return (
                    <button
                      key={label}
                      onClick={() => setCalEditingDate(val)}
                      style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                        background: isActive ? 'rgba(200,140,0,0.15)' : 'rgba(200,140,0,0.05)',
                        color: isActive ? '#c88c00' : '#6a6058',
                        border: `1px solid ${isActive ? 'rgba(200,140,0,0.3)' : 'rgba(200,140,0,0.1)'}`,
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Assignees edit */}
            <div style={{ marginBottom: 12 }}>
              {(() => {
                const original = (selectedCalTask.assignedMembershipIds || []).slice().sort().join(',');
                const current = calEditingAssignees.slice().sort().join(',');
                const dirty = original !== current;
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: 12, color: '#6a6058', fontWeight: 600 }}>ASSIGNED TO</label>
                      {dirty && (
                        <button onClick={saveCalAssignees} disabled={calSavingAssignees}
                          style={{
                            background: '#c88c00', color: '#ffffff', fontSize: 12, fontWeight: 600,
                            padding: '3px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                            opacity: calSavingAssignees ? 0.5 : 1,
                          }}>
                          {calSavingAssignees ? 'Saving...' : 'Save'}
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {TEAM_ASSIGNEES.map((a) => {
                        const on = calEditingAssignees.includes(a.id);
                        return (
                          <button
                            key={a.id}
                            onClick={() => {
                              setCalEditingAssignees(prev => on ? prev.filter(id => id !== a.id) : [...prev, a.id]);
                            }}
                            style={{
                              fontSize: 12, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
                              background: on ? 'rgba(200,140,0,0.15)' : 'rgba(200,140,0,0.04)',
                              color: on ? '#c88c00' : '#6a6058',
                              border: `1px solid ${on ? 'rgba(200,140,0,0.35)' : 'rgba(200,140,0,0.12)'}`,
                              fontWeight: on ? 600 : 500,
                            }}
                          >
                            {on ? '✓ ' : ''}{a.label}
                          </button>
                        );
                      })}
                    </div>
                    {calEditingAssignees.length === 0 && (
                      <div style={{ fontSize: 11, color: '#8a8078', marginTop: 4, fontStyle: 'italic' }}>No assignees — task will be unassigned.</div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={completeCalTask}
                disabled={calCompleting}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                  background: 'rgba(34,197,94,0.1)', color: '#22c55e',
                  opacity: calCompleting ? 0.5 : 1,
                }}>
                {calCompleting
                  ? <Loader2 size={15} className="animate-spin" />
                  : <><Check size={15} /> Mark Complete</>
                }
              </button>
              <a
                href={selectedCalTask.jobId ? jtScheduleUrl(selectedCalTask.jobId) : '#'}
                target="_blank" rel="noopener noreferrer"
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '7px 0', borderRadius: 6, fontSize: 14, fontWeight: 600, textDecoration: 'none',
                  background: 'rgba(200,140,0,0.1)', color: '#c88c00',
                }}>
                <ExternalLink size={15} /> View in JobTread
              </a>
            </div>
          </div>
        </div>
      )}

      {/* NEW TASK MODAL */}
      {newTaskForm && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => setNewTaskForm(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#f8f6f3', borderRadius: 12, padding: 16, minWidth: 320, maxWidth: 400,
            border: '1px solid rgba(200,140,0,0.15)', boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>New Task</div>
                <div style={{ fontSize: 13, color: '#8a8078', marginTop: 2 }}>{newTaskForm.jobName.replace(/^#\d+\s*/, '')}</div>
              </div>
              <button onClick={() => setNewTaskForm(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                <X size={14} style={{ color: '#6a6058' }} />
              </button>
            </div>

            {/* Task Name */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 4 }}>TASK NAME</label>
              <input
                type="text"
                autoFocus
                placeholder="Enter task name..."
                value={newTaskName}
                onChange={e => setNewTaskName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newTaskName.trim()) createNewTask(); }}
                style={{
                  width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 6,
                  color: '#1a1a1a', fontSize: 14, padding: '7px 10px', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Phase (Category) Selector */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 4 }}>PHASE (CATEGORY)</label>
              <select
                value={newTaskPhase}
                onChange={e => setNewTaskPhase(e.target.value)}
                style={{
                  width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 6,
                  color: '#c88c00', fontSize: 14, padding: '7px 10px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box',
                }}
              >
                {PHASES.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {/* Due Date */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 4 }}>DUE DATE (OPTIONAL)</label>
              <input
                type="date"
                value={newTaskDate}
                onChange={e => setNewTaskDate(e.target.value)}
                style={{
                  width: '100%', background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', borderRadius: 6,
                  color: '#1a1a1a', fontSize: 14, padding: '7px 10px', colorScheme: 'dark', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setNewTaskForm(null)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 6, border: '1px solid rgba(200,140,0,0.15)', cursor: 'pointer',
                  fontSize: 14, fontWeight: 600, background: 'transparent', color: '#6a6058',
                }}>
                Cancel
              </button>
              <button
                onClick={createNewTask}
                disabled={!newTaskName.trim() || creatingTask}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: newTaskName.trim() && !creatingTask ? 'pointer' : 'default',
                  fontSize: 14, fontWeight: 600,
                  background: newTaskName.trim() ? '#c88c00' : 'rgba(200,140,0,0.2)',
                  color: newTaskName.trim() ? '#ffffff' : '#6a6058',
                  opacity: creatingTask ? 0.5 : 1,
                }}>
                {creatingTask ? 'Creating...' : 'Create Task'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

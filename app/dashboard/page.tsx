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
  Hourglass, ChevronRight
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import {
  formatContent,
  type ChatMessage,
  type TaskConfirmData,
  type COProposalData,
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
// Inline Ask Agent Chat
// ============================================================

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
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
    <div style={{ marginBottom: 6, borderRadius: 8, border: '1px solid rgba(205,162,116,0.12)', overflow: 'hidden', background: '#1a1a1a' }}>
      {/* Toggle Bar */}
      {!hideToggle && <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: isTouch ? 8 : 6,
          padding: isTouch ? '10px 12px' : '7px 10px', background: open ? 'rgba(205,162,116,0.08)' : 'transparent',
          border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ width: isTouch ? 28 : 22, height: isTouch ? 28 : 22, borderRadius: 14, background: 'rgba(205,162,116,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Bot size={isTouch ? 15 : 12} style={{ color: '#CDA274' }} />
        </div>
        <span style={{ flex: 1, fontSize: isTouch ? 14 : 12, fontWeight: 600, color: '#CDA274' }}>Ask Agent</span>
        {!isMobile && <span style={{ fontSize: isTouch ? 11 : 9, color: '#5a5550' }}>Tasks Â· Specs Â· Change Orders</span>}
        {open ? <ChevronUp size={isTouch ? 16 : 12} style={{ color: '#5a5550' }} /> : <ChevronDown size={isTouch ? 16 : 12} style={{ color: '#5a5550' }} />}
      </button>}

      {/* Chat Body */}
      {open && (
        <div style={{ borderTop: '1px solid rgba(205,162,116,0.08)' }}>
          {/* Mode Selector + Job Selector */}
          <div style={{ padding: isTouch ? '8px 12px' : '6px 10px', borderBottom: '1px solid rgba(205,162,116,0.06)', display: 'flex', flexWrap: isMobile ? 'wrap' : 'nowrap', alignItems: 'center', gap: isTouch ? 8 : 6 }}>
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(205,162,116,0.15)', flexShrink: 0, ...(isMobile ? { width: '100%' } : {}) }}>
              {([
                { key: 'general', label: 'Agent' },
                { key: 'change-order', label: 'Change Order' },
                { key: 'specs', label: 'Specs' },
              ] as const).map((mode, idx) => (
                <button
                  key={mode.key}
                  onClick={() => handleModeChange(mode.key)}
                  style={{
                    padding: isTouch ? '8px 14px' : '4px 10px',
                    fontSize: isTouch ? 13 : 10,
                    fontWeight: 600, border: 'none', cursor: 'pointer',
                    ...(isMobile ? { flex: 1 } : {}),
                    ...(idx > 0 ? { borderLeft: '1px solid rgba(205,162,116,0.15)' } : {}),
                    background: agentMode === mode.key ? 'rgba(205,162,116,0.2)' : 'transparent',
                    color: agentMode === mode.key ? '#CDA274' : '#5a5550',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <select
              value={selectedJobId}
              onChange={e => setSelectedJobId(e.target.value)}
              style={{
                flex: 1, background: '#242424', border: '1px solid rgba(205,162,116,0.1)',
                borderRadius: isTouch ? 8 : 4, color: selectedJobId ? '#CDA274' : '#5a5550',
                fontSize: isTouch ? 13 : 10, padding: isTouch ? '8px 10px' : '3px 6px', outline: 'none', cursor: 'pointer',
                ...(isMobile ? { width: '100%' } : {}),
              }}
            >
              <option value="">All jobs (no filter)</option>
              {pmJobs.map(j => (
                <option key={j.id} value={j.id}>#{j.number} {j.name}</option>
              ))}
            </select>
            {messages.length > 0 && (
              <button onClick={() => { setMessages([]); setLastAgent(null); setUploadedUrls([]); }} style={{ fontSize: isTouch ? 12 : 9, color: '#5a5550', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: isTouch ? '6px 4px' : 0 }}>Clear</button>
            )}
          </div>

          {/* Messages */}
          <div style={{ maxHeight: isMobile ? 400 : isTouch ? 360 : 300, overflowY: 'auto', padding: isTouch ? '8px 12px' : '6px 10px' }}>
            {messages.length === 0 && !loading && (
              <div style={{ padding: isTouch ? '12px 0' : '8px 0', textAlign: 'center' }}>
                <p style={{ fontSize: isTouch ? 13 : 10, color: '#5a5550', marginBottom: 4 }}>
                  {agentMode === 'general' && 'Ask about tasks, schedules, or anything on this job'}
                  {agentMode === 'change-order' && 'Describe the change â I\'ll ask questions and build the CO'}
                  {agentMode === 'specs' && 'Ask about approved specs for this job'}
                </p>
                {agentMode === 'change-order' && (
                  <p style={{ fontSize: isTouch ? 11 : 9, color: '#8a8078', marginTop: 4 }}>
                    Use the <Paperclip size={isTouch ? 12 : 9} style={{ display: 'inline', verticalAlign: 'middle', color: '#CDA274' }} /> button to attach photos
                  </p>
                )}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{ marginBottom: isTouch ? 10 : 6 }}>
                <div style={{ display: 'flex', gap: isTouch ? 8 : 6, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {msg.role === 'assistant' && (
                    <div style={{ width: isTouch ? 24 : 18, height: isTouch ? 24 : 18, borderRadius: 12, background: 'rgba(205,162,116,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                      <Bot size={isTouch ? 13 : 10} style={{ color: '#CDA274' }} />
                    </div>
                  )}
                  <div style={{
                    maxWidth: isMobile ? '90%' : '85%', padding: isTouch ? '8px 12px' : '5px 8px', borderRadius: isTouch ? 10 : 6, fontSize: isTouch ? 14 : 11, lineHeight: isTouch ? '20px' : '16px',
                    ...(msg.role === 'user'
                      ? { background: '#1B3A5C', color: '#e8e0d8' }
                      : { background: '#242424', color: '#e8e0d8', border: '1px solid rgba(205,162,116,0.06)' }),
                  }}>
                    {msg.role === 'assistant' ? <RenderContent content={msg.content} /> : msg.content}
                  </div>
                  {msg.role === 'user' && (
                    <div style={{ width: isTouch ? 24 : 18, height: isTouch ? 24 : 18, borderRadius: 12, background: 'rgba(27,58,92,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                      <User size={isTouch ? 13 : 10} style={{ color: '#e8e0d8' }} />
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

                {/* CO Proposal approval UI */}
                {msg.coProposal && i === messages.length - 1 && msg.needsConfirmation && !loading && (() => {
                  const co = msg.coProposal!;
                  const totalPrice = co.lineItems.reduce((s: number, li: any) => s + (li.unitPrice * li.quantity), 0);
                  const totalCost = co.lineItems.reduce((s: number, li: any) => s + (li.unitCost * li.quantity), 0);
                  return (
                    <div style={{ marginLeft: 24, marginTop: 6 }}>
                      <div style={{ background: '#1e293b', borderRadius: 8, padding: 10, marginBottom: 6, border: '1px solid rgba(59,130,246,0.2)' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#93c5fd', marginBottom: 6 }}>
                          CO: {co.coName}
                        </div>
                        <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ color: '#64748b', borderBottom: '1px solid rgba(100,116,139,0.2)' }}>
                              <th style={{ textAlign: 'left', padding: '2px 4px' }}>Item</th>
                              <th style={{ textAlign: 'right', padding: '2px 4px' }}>Qty</th>
                              <th style={{ textAlign: 'right', padding: '2px 4px' }}>Cost</th>
                              <th style={{ textAlign: 'right', padding: '2px 4px' }}>Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {co.lineItems.map((li: any, liIdx: number) => (
                              <tr key={liIdx} style={{ color: '#e2e8f0', borderBottom: '1px solid rgba(100,116,139,0.1)' }}>
                                <td style={{ padding: '3px 4px' }}>{li.name}</td>
                                <td style={{ textAlign: 'right', padding: '3px 4px', color: '#94a3b8' }}>{li.quantity}</td>
                                <td style={{ textAlign: 'right', padding: '3px 4px', color: '#94a3b8' }}>${(li.unitCost * li.quantity).toFixed(0)}</td>
                                <td style={{ textAlign: 'right', padding: '3px 4px', fontWeight: 500 }}>${(li.unitPrice * li.quantity).toFixed(0)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ color: '#f1f5f9', fontWeight: 600, borderTop: '1px solid rgba(100,116,139,0.3)' }}>
                              <td style={{ padding: '4px' }}>Total</td>
                              <td></td>
                              <td style={{ textAlign: 'right', padding: '4px', color: '#94a3b8' }}>${totalCost.toFixed(0)}</td>
                              <td style={{ textAlign: 'right', padding: '4px' }}>${totalPrice.toFixed(0)}</td>
                            </tr>
                          </tfoot>
                        </table>
                        {co.createDocument && <div style={{ fontSize: 9, color: '#60a5fa', marginTop: 4 }}>+ Draft CO document will be created</div>}
                        {co.followUp?.needed && <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 2 }}>+ Follow-up task â {co.followUp.assignTo || 'Nathan'} by {co.followUp.dueDate || 'TBD'}</div>}
                        {co.imageUrls && co.imageUrls.length > 0 && <div style={{ fontSize: 9, color: '#22c55e', marginTop: 2 }}>+ {co.imageUrls.length} photo(s) will be attached</div>}
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
                <div style={{ width: isTouch ? 24 : 18, height: isTouch ? 24 : 18, borderRadius: 12, background: 'rgba(205,162,116,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Bot size={isTouch ? 13 : 10} style={{ color: '#CDA274' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: isTouch ? '8px 12px' : '4px 8px', borderRadius: isTouch ? 10 : 6, background: '#242424', border: '1px solid rgba(205,162,116,0.06)' }}>
                  <Loader2 size={isTouch ? 16 : 12} className="animate-spin" style={{ color: '#CDA274' }} />
                  <span style={{ fontSize: isTouch ? 13 : 10, color: '#5a5550' }}>Searching your data...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Image Preview Strip */}
          {attachedImages.length > 0 && (
            <div style={{ display: 'flex', gap: isTouch ? 10 : 6, padding: isTouch ? '8px 12px' : '6px 10px', borderTop: '1px solid rgba(205,162,116,0.06)', overflowX: 'auto' }}>
              {attachedImages.map((img, idx) => (
                <div key={idx} style={{ position: 'relative', flexShrink: 0 }}>
                  <img src={img.preview} alt={img.file.name}
                    style={{ width: isTouch ? 64 : 48, height: isTouch ? 64 : 48, borderRadius: isTouch ? 8 : 6, objectFit: 'cover', border: '1px solid rgba(205,162,116,0.15)' }} />
                  <button onClick={() => removeImage(idx)}
                    style={{
                      position: 'absolute', top: -4, right: -4, width: isTouch ? 22 : 16, height: isTouch ? 22 : 16, borderRadius: 11,
                      background: '#ef4444', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                    <XIcon size={isTouch ? 12 : 8} color="#fff" />
                  </button>
                </div>
              ))}
              {uploading && <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: isTouch ? 13 : 10, color: '#CDA274' }}><Loader2 size={isTouch ? 16 : 12} className="animate-spin" /> Uploading...</div>}
            </div>
          )}

          {/* Uploaded URLs indicator */}
          {uploadedUrls.length > 0 && attachedImages.length === 0 && (
            <div style={{ padding: isTouch ? '6px 12px' : '4px 10px', borderTop: '1px solid rgba(205,162,116,0.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ImageIcon size={isTouch ? 14 : 10} color="#22c55e" />
              <span style={{ fontSize: isTouch ? 12 : 9, color: '#22c55e' }}>{uploadedUrls.length} photo(s) ready to attach to change order</span>
              <button onClick={() => setUploadedUrls([])} style={{ fontSize: isTouch ? 12 : 9, color: '#5a5550', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', marginLeft: 'auto', padding: isTouch ? '4px' : 0 }}>Clear</button>
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'center', gap: isTouch ? 8 : 4, padding: isTouch ? '8px 12px' : '6px 10px', borderTop: '1px solid rgba(205,162,116,0.06)' }}>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageAttach} style={{ display: 'none' }} />
            {agentMode === 'change-order' && (
              <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach photos"
                style={{
                  width: isTouch ? 40 : 28, height: isTouch ? 40 : 28, borderRadius: isTouch ? 10 : 6, border: 'none', cursor: 'pointer', flexShrink: 0,
                  background: attachedImages.length > 0 ? 'rgba(205,162,116,0.15)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <Paperclip size={isTouch ? 18 : 13} style={{ color: attachedImages.length > 0 ? '#CDA274' : '#5a5550' }} />
              </button>
            )}
            <textarea
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, isTouch ? 120 : 80) + 'px'; }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !isTouch) { e.preventDefault(); if (query.trim() && !loading) handleSubmit(e as any); } }}
              placeholder={agentMode === 'general'
                ? (selectedJob ? `Ask about #${selectedJob.number} ${selectedJob.name}...` : 'Ask about tasks, schedules, or jobs...')
                : agentMode === 'change-order'
                ? (selectedJob ? `Describe the change for #${selectedJob.number}...` : 'Select a job, then describe the change...')
                : (selectedJob ? `Ask about specs for #${selectedJob.number}...` : 'Select a job to look up specs...')}
              rows={1}
              disabled={loading || uploading}
              style={{
                flex: 1, background: '#242424', border: '1px solid rgba(205,162,116,0.1)',
                borderRadius: isTouch ? 10 : 6, color: '#e8e0d8', fontSize: isTouch ? 16 : 11, padding: isTouch ? '10px 12px' : '6px 8px',
                outline: 'none', resize: 'none', minHeight: isTouch ? 42 : 30, maxHeight: isTouch ? 120 : 80, overflowY: 'auto',
                fontFamily: 'inherit',
              }}
            />
            <button type="submit" disabled={!query.trim() || loading || uploading}
              style={{
                width: isTouch ? 40 : 28, height: isTouch ? 40 : 28, borderRadius: isTouch ? 10 : 6, border: 'none', cursor: query.trim() && !loading ? 'pointer' : 'default',
                background: query.trim() && !loading ? 'rgba(205,162,116,0.15)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
              <Send size={isTouch ? 18 : 13} style={{ color: query.trim() && !loading ? '#CDA274' : '#3a3a3a' }} />
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
  const [panelTab, setPanelTab] = useState<'waitingOn' | 'newTask'>('waitingOn');
  const [stNewTaskName, setStNewTaskName] = useState('');
  const [stNewTaskJob, setStNewTaskJob] = useState('');
  const [stNewTaskPhase, setStNewTaskPhase] = useState('');
  const [stNewTaskDate, setStNewTaskDate] = useState('');
  const [stNewTaskAssignee, setStNewTaskAssignee] = useState('');
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

  const TEAM_ASSIGNEES = [
    { id: '22P5SRwhLaYf', name: 'Nathan King', label: 'Nathan' },
    { id: '22P6GTaPEbkh', name: 'Brett King', label: 'Brett' },
    { id: '22P5nJ7ncFj4', name: 'Evan Harrington', label: 'Evan' },
    { id: '22P6GTEnhCre', name: 'Josh King', label: 'Josh' },
    { id: '22P5icFXKZgA', name: 'Dave Steich', label: 'Dave' },
    { id: '22P5sPMTN8mH', name: 'Jimmy', label: 'Jimmy' },
  ];
  const TERRI_MEMBERSHIP_ID = '22P5SpJkype2';
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
          terriMembershipId: TERRI_MEMBERSHIP_ID,
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

  async function createStandaloneTask() {
    if (!stNewTaskName.trim() || !stNewTaskJob || !stNewTaskPhase) return;
    setCreatingSt(true);
    try {
      const res = await fetch('/api/dashboard/create-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: stNewTaskJob, taskName: stNewTaskName.trim(), phaseName: stNewTaskPhase, endDate: stNewTaskDate || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (overview && data.task) {
        const mj = overview.data.activeJobs?.find((j: any) => j.id === stNewTaskJob);
        setOverview({ ...overview, data: { ...overview.data, tasks: [...(overview.data.tasks || []), { id: data.task.id, name: stNewTaskName.trim(), jobName: mj ? mj.name : '', jobId: stNewTaskJob, jobNumber: mj ? String(mj.number) : '', endDate: stNewTaskDate || null, startDate: stNewTaskDate || null, progress: 0, urgency: 'normal', assignee: '', daysUntilDue: stNewTaskDate ? Math.ceil((new Date(stNewTaskDate).getTime() - Date.now()) / 86400000) : null } as any] } });
      }
      setStNewTaskName(''); setStNewTaskJob(''); setStNewTaskPhase(''); setStNewTaskDate(''); setStNewTaskAssignee('');
      setPanelTab('waitingOn');
    } catch (err: any) {
      console.error('Create task failed:', err);
      alert('Failed: ' + err.message);
    } finally { setCreatingSt(false); }
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

  // Listen for refreshDashboard events (from inline task actions)
  useEffect(() => {
    const handler = () => fetchOverview(true);
    window.addEventListener('refreshDashboard', handler);
    return () => window.removeEventListener('refreshDashboard', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {/* ACTION BUTTONS ROW */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <button onClick={() => { setShowWaitingOnPanel(!showWaitingOnPanel); setShowAgentPanel(false); }}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: showWaitingOnPanel ? 'rgba(205,162,116,0.08)' : '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8,
            padding: '7px 10px', cursor: 'pointer' }}>
          <span style={{ fontSize: 13, color: '#CDA274' }}>+</span>
          <span style={{ fontSize: 9, fontWeight: 600, color: '#CDA274', letterSpacing: '0.04em' }}>
            QUICK ADD
          </span>
        </button>
        <button onClick={() => { setShowAgentPanel(!showAgentPanel); setShowWaitingOnPanel(false); }}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: showAgentPanel ? 'rgba(205,162,116,0.08)' : '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8,
            padding: '7px 10px', cursor: 'pointer' }}>
          <Bot size={12} style={{ color: '#CDA274' }} />
          <span style={{ fontSize: 9, fontWeight: 600, color: '#CDA274', letterSpacing: '0.04em' }}>ASK AGENT</span>
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
              <div style={{ marginBottom: 6, borderRadius: 8, border: '1px solid rgba(205,162,116,0.12)', overflow: 'hidden', background: '#1a1a1a' }}>













              <div style={{ display: 'flex', borderBottom: '1px solid rgba(205,162,116,0.08)', flexShrink: 0 }}>
                <button onClick={() => setPanelTab('newTask')} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', borderBottom: panelTab === 'newTask' ? '2px solid #CDA274' : '2px solid transparent', color: panelTab === 'newTask' ? '#CDA274' : '#6a6058', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>New Task</button>
                <button onClick={() => setPanelTab('waitingOn')} style={{ flex: 1, padding: '10px', background: 'none', border: 'none', borderBottom: panelTab === 'waitingOn' ? '2px solid #CDA274' : '2px solid transparent', color: panelTab === 'waitingOn' ? '#CDA274' : '#6a6058', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Waiting On ({woTasks.length})</button>
              </div>
              {/* Scrollable content */}
              <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '8px 12px' }}>
                {panelTab === 'newTask' && (
                  <div style={{ padding: '4px 0' }}>
                    <div>
                      <label style={{ fontSize: 9, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>TASK NAME</label>
                      <input type="text" autoFocus placeholder="e.g. Order appliances" value={stNewTaskName} onChange={e => setStNewTaskName(e.target.value)}
                        style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 5, color: '#e0e0d8', fontSize: 12, padding: '7px 10px', outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 9, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>JOB</label>
                      <select value={stNewTaskJob} onChange={e => setStNewTaskJob(e.target.value)}
                        style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 5, color: stNewTaskJob ? '#CDA274' : '#5a5550', fontSize: 11, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const }}>
                        <option value="">Select job...</option>
                        {overview?.data?.activeJobs?.map((j: any) => (<option key={j.id} value={j.id}>{j.number} - {j.name}</option>))}
                      </select>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 9, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>PHASE</label>
                      <select value={stNewTaskPhase} onChange={e => setStNewTaskPhase(e.target.value)}
                        style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 5, color: stNewTaskPhase ? '#CDA274' : '#5a5550', fontSize: 11, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const }}>
                        <option value="">Select phase...</option>
                        {BKB_PHASES.map(p => (<option key={p} value={p}>{p}</option>))}
                      </select>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 9, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>ASSIGN TO</label>
                      <select value={stNewTaskAssignee} onChange={e => setStNewTaskAssignee(e.target.value)}
                        style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 5, color: stNewTaskAssignee ? '#CDA274' : '#5a5550', fontSize: 11, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const }}>
                        <option value="">Select assignee...</option>
                        {TEAM_ASSIGNEES.map((a: any) => (<option key={a.id} value={a.id}>{a.label}</option>))}
                      </select>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 9, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>DUE DATE</label>
                      <input type="date" value={stNewTaskDate} onChange={e => setStNewTaskDate(e.target.value)}
                        style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 5, color: stNewTaskDate ? '#CDA274' : '#5a5550', fontSize: 11, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const }} />
                    </div>
                    <button onClick={createStandaloneTask} disabled={!stNewTaskName.trim() || !stNewTaskJob || !stNewTaskPhase || creatingSt}
                      style={{ marginTop: 12, width: '100%', padding: '10px', borderRadius: 6, border: 'none',
                        background: (!stNewTaskName.trim() || !stNewTaskJob || !stNewTaskPhase) ? '#333' : '#CDA274',
                        color: (!stNewTaskName.trim() || !stNewTaskJob || !stNewTaskPhase) ? '#666' : '#1a1a1a',
                        fontWeight: 600, fontSize: 12,
                        cursor: (!stNewTaskName.trim() || !stNewTaskJob || !stNewTaskPhase) ? 'default' : 'pointer',
                        opacity: creatingSt ? 0.5 : 1 }}>
                      {creatingSt ? 'Creating...' : 'Create Task'}
                    </button>
                  </div>
                )}
                {panelTab === 'waitingOn' && (
                  <div style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.12)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#CDA274', marginBottom: 8 }}>New Waiting On Item</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 9, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>WHAT ARE YOU WAITING ON?</label>
                        <input type="text" autoFocus placeholder="e.g. Approval on tile selection" value={woTaskName} onChange={e => setWoTaskName(e.target.value)}
                          style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 5, color: '#e8e0d8', fontSize: 12, padding: '7px 10px', outline: 'none', boxSizing: 'border-box' as const }} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 9, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>JOB</label>
                          <select value={woJobId} onChange={e => setWoJobId(e.target.value)}
                            style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 5, color: woJobId ? '#CDA274' : '#5a5550', fontSize: 11, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const }}>
                            <option value="">Select job...</option>
                            {(overview?.data?.activeJobs || []).map((j: any) => (<option key={j.id} value={j.id}>#{j.number} {j.name}</option>))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: 9, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>WHO?</label>
                          <select value={woAssignee} onChange={e => setWoAssignee(e.target.value)}
                            style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 5, color: woAssignee ? '#CDA274' : '#5a5550', fontSize: 11, padding: '7px 8px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' as const }}>
                            <option value="">Select person...</option>
                            {TEAM_ASSIGNEES.map((a: any) => (<option key={a.id} value={a.id}>{a.label}</option>))}
                          </select>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 9, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>FOLLOW UP BY</label>
                          <input type="date" value={woDate} onChange={e => setWoDate(e.target.value)}
                            style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 5, color: '#e8e0d8', fontSize: 11, padding: '7px 8px', colorScheme: 'dark', outline: 'none', boxSizing: 'border-box' as const }} />
                          <div style={{ fontSize: 8, color: '#5a5550', marginTop: 2 }}>Default: 3 business days</div>
                        </div>
                        <div>
                          <label style={{ fontSize: 9, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 3 }}>NOTE (OPTIONAL)</label>
                          <input type="text" placeholder="Context..." value={woDescription} onChange={e => setWoDescription(e.target.value)}
                            style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 5, color: '#e8e0d8', fontSize: 11, padding: '7px 8px', outline: 'none', boxSizing: 'border-box' as const }} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                        <button onClick={() => { setShowWaitingOnForm(false); setShowWaitingOnPanel(false); }}
                          style={{ fontSize: 11, color: '#6a6058', background: 'transparent', border: '1px solid rgba(205,162,116,0.1)', borderRadius: 5, padding: '5px 12px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={createWaitingOnTask} disabled={!woTaskName.trim() || !woJobId || !woAssignee || creatingWo}
                          style={{ fontSize: 11, fontWeight: 600, borderRadius: 5, padding: '5px 14px', border: 'none',
                            cursor: (woTaskName.trim() && woJobId && woAssignee && !creatingWo) ? 'pointer' : 'default',
                            background: (woTaskName.trim() && woJobId && woAssignee) ? '#CDA274' : 'rgba(205,162,116,0.2)',
                            color: (woTaskName.trim() && woJobId && woAssignee) ? '#1a1a1a' : '#6a6058', opacity: creatingWo ? 0.5 : 1 }}>
                          {creatingWo ? 'Creating...' : 'Create'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {sorted.length === 0 && panelTab !== 'waitingOn' && (
                  <div style={{ textAlign: 'center', padding: '30px 16px', color: '#5a5550' }}>
                    <Hourglass size={24} style={{ color: '#3a3a3a', marginBottom: 8 }} />
                    <div style={{ fontSize: 12, marginBottom: 4 }}>No open items</div>
                    <div style={{ fontSize: 10 }}>Select the Waiting On tab to start tracking</div>
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
                    <div key={task.id} style={{ marginBottom: 3, borderRadius: 6, background: ab, border: '1px solid rgba(205,162,116,0.04)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px' }}>
                        <button onClick={() => completeWoTask(task.id)} disabled={isCompleting} title="Mark resolved"
                          style={{ width: 20, height: 20, borderRadius: '50%', border: `1.5px solid ${ac}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isCompleting ? 0.4 : 1 }}>
                          {isCompleting ? <Loader2 size={10} className="animate-spin" style={{ color: '#8a8078' }} /> : <Check size={10} style={{ color: ac }} />}
                        </button>
                        <button onClick={() => { if (isExpanded) { setExpandedWoTask(null); } else { setExpandedWoTask(task.id); fetchWoComments(task.id); } }}
                          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' as const, padding: 0 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: '#e8e0d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, fontWeight: 500 }}>{displayName}</div>
                            <div style={{ fontSize: 10, color: '#5a5550', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{task.jobName?.replace(/^#\d+\s*/, '') || ''}</div>
                          </div>
                          <ChevronRight size={11} style={{ color: '#5a5550', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
                        </button>
                        <div style={{ fontSize: 10, color: ac, fontWeight: 600, flexShrink: 0, minWidth: 40, textAlign: 'right' as const }}>
                          {task.daysUntilDue !== null ? (task.daysUntilDue < 0 ? Math.abs(task.daysUntilDue) + 'd ago' : task.daysUntilDue === 0 ? 'Today' : task.daysUntilDue + 'd') : 'No date'}
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '0 8px 8px 34px' }}>
                          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                            <input type="text" placeholder="Add a note..." value={woNewComment} onChange={e => setWoNewComment(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter' && woNewComment.trim()) postWoComment(task.id); }}
                              style={{ flex: 1, background: '#242424', border: '1px solid rgba(205,162,116,0.12)', borderRadius: 5, color: '#e8e0d8', fontSize: 11, padding: '5px 8px', outline: 'none' }} />
                            <button onClick={() => postWoComment(task.id)} disabled={!woNewComment.trim() || postingWoComment}
                              style={{ background: woNewComment.trim() ? '#CDA274' : 'rgba(205,162,116,0.15)', border: 'none', borderRadius: 5, padding: '5px 8px', cursor: woNewComment.trim() ? 'pointer' : 'default', lineHeight: 0, opacity: postingWoComment ? 0.5 : 1 }}>
                              <Send size={11} style={{ color: woNewComment.trim() ? '#1a1a1a' : '#5a5550' }} />
                            </button>
                          </div>
                          {isLoadingComments && (<div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0' }}><Loader2 size={10} className="animate-spin" style={{ color: '#5a5550' }} /><span style={{ fontSize: 10, color: '#5a5550' }}>Loading...</span></div>)}
                          {comments && comments.length === 0 && !isLoadingComments && (<div style={{ fontSize: 10, color: '#3a3a3a', padding: '2px 0' }}>No comments yet</div>)}
                          {comments && comments.slice(0, 8).map((cm: any, i: number) => (
                            <div key={cm.id || i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(205,162,116,0.04)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: '#CDA274' }}>{cm.name || 'Unknown'}</span>
                                {cm.createdAt && <span style={{ fontSize: 9, color: '#3a3a3a' }}>{timeAgo(cm.createdAt)}</span>}
                              </div>
                              <div style={{ fontSize: 11, color: '#c8c0b8', lineHeight: '15px' }}>{cm.message}</div>
                            </div>
                          ))}
                          {comments && comments.length > 8 && (<div style={{ fontSize: 9, color: '#5a5550', padding: '3px 0' }}>+{comments.length - 8} more in JobTread</div>)}
                          {task.jobId && (<a href={`https://app.jobtread.com/jobs/${task.jobId}/schedule`} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#5a5550', marginTop: 4, textDecoration: 'none' }}><ExternalLink size={9} /> View in JobTread</a>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              </div>
        );
      })()}

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

        {/* KPI 2: Open Tasks â clickable */}
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

        {/* KPI 3: Overdue â clickable */}
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

        {/* KPI 4: Outstanding Invoices (AR) â clickable */}
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

        {/* KPI 5: Pending Change Orders â clickable */}
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

      {/* AI BRIEFING â compact, matches field dashboard style */}
      {analysis?.summary && (
        <div style={{ background: 'rgba(205,162,116,0.06)', border: '1px solid rgba(205,162,116,0.12)', borderRadius: 8, padding: '8px 10px', marginBottom: isTouch ? 10 : 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Zap size={10} style={{ color: '#CDA274' }} />
            <span style={{ fontSize: 9, fontWeight: 600, color: '#CDA274' }}>AI BRIEFING</span>
          </div>
          <p style={{ fontSize: 12, color: '#e8e0d8', lineHeight: 1.5, margin: 0 }}>{analysis.summary}</p>
        </div>
      )}


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
                <Hourglass size={10} style={{ color: '#eab308' }} />
                <span style={{ fontSize: 9, fontWeight: 600, color: '#eab308', letterSpacing: '0.04em' }}>
                  WAITING ON ({woItems.length})
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {woItems.length > 5 && !woRibbonCollapsed && (
                  <span onClick={(e) => { e.stopPropagation(); setShowWaitingOnPanel(true); }} style={{ fontSize: 9, color: '#CDA274', cursor: 'pointer' }}>
                    View all <ChevronRight size={9} style={{ display: 'inline', verticalAlign: 'middle' }} />
                  </span>
                )}
                {woRibbonCollapsed ? <ChevronDown size={12} style={{ color: '#eab308' }} /> : <ChevronUp size={12} style={{ color: '#eab308' }} />}
              </div>
            </button>

            {/* Collapsible task list */}
            {!woRibbonCollapsed && sorted.slice(0, 5).map((t, i) => {
              const d = agingDays(t);
              const label = stripWoPrefix(t.name);
              const jobName = t.jobName || '';
              const isEditingDate = editingWoDateId === t.id;
              const isCompleting = completingWoId === t.id;
              return (
                <div key={t.id || i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderRadius: 6, background: agingBg(d), marginBottom: 2 }}>
                  {/* Complete button */}
                  <button
                    onClick={() => handleWoComplete(t.id)}
                    disabled={isCompleting}
                    title="Mark complete"
                    style={{ background: 'none', border: '1px solid rgba(205,162,116,0.2)', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, padding: 0, opacity: isCompleting ? 0.4 : 1 }}
                  >
                    {isCompleting ? <Loader2 size={8} style={{ color: '#CDA274' }} className="animate-spin" /> : <Check size={8} style={{ color: '#6a6058' }} />}
                  </button>
                  {/* Task label */}
                  <span style={{ fontSize: 11, color: '#e8e0d8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                  {/* Job name */}
                  {jobName && <span style={{ fontSize: 9, color: '#6a6058', flexShrink: 0 }}>{jobName}</span>}
                  {/* Date display / edit */}
                  {isEditingDate ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="date"
                        value={editingWoDateVal}
                        onChange={(e) => setEditingWoDateVal(e.target.value)}
                        style={{ fontSize: 9, background: '#2a2a2a', border: '1px solid rgba(205,162,116,0.3)', borderRadius: 4, color: '#e8e0d8', padding: '1px 4px', width: 110 }}
                      />
                      <button onClick={() => handleWoDateSave(t.id)} disabled={savingWoDate} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        <Check size={10} style={{ color: '#22c55e' }} />
                      </button>
                      <button onClick={() => { setEditingWoDateId(null); setEditingWoDateVal(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        <X size={10} style={{ color: '#6a6058' }} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingWoDateId(t.id); setEditingWoDateVal(t.endDate?.split('T')[0] || ''); }}
                      title="Edit due date"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2 }}
                    >
                      {d !== null && <span style={{ fontSize: 9, color: agingColor(d) }}>{d < 0 ? `${Math.abs(d)}d late` : d === 0 ? 'today' : `${d}d`}</span>}
                      <Calendar size={9} style={{ color: '#6a6058' }} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}


      {/* OUTSTANDING INVOICES â expandable from KPI card click */}
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

      {/* AR AUTOMATED REMINDERS â compact status bar */}
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
                  Last: {new Date(arStats.recentReminders[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} â {arStats.recentReminders[0].jobName.replace(/^#\d+\s*/, '').split(' ').slice(0, 3).join(' ')} ({arStats.recentReminders[0].tier})
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* PENDING CHANGE ORDERS â expandable from KPI card click */}
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

      {/* EXPANDED TASK LIST â shows when KPI card is clicked */}
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
            <span style={{ fontSize: 10, color: '#3f3f3f' }}>{week.days[0].month} {week.days[0].dayNum} â {week.days[6].month} {week.days[6].dayNum}</span>
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
                          title={`${task.name} â ${task.jobName}`}
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
          <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <ClipboardList size={10} style={{ color: '#CDA274' }} />
                <span style={{ fontSize: 9, fontWeight: 600, color: '#CDA274', letterSpacing: '0.04em' }}>ALL TASKS ({filteredTasks.length})</span>
                <span style={{ fontSize: 8, color: '#5a5550', marginLeft: 2 }}>Overdue thru {rangeEndStr}</span>
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
            {/* Search box */}
            <div style={{ position: 'relative', marginBottom: 6 }}>
              <Search size={11} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#5a5550' }} />
              <input
                type="text"
                placeholder="Search by project name..."
                value={taskSearch}
                onChange={e => setTaskSearch(e.target.value)}
                style={{
                  width: '100%', padding: '5px 8px 5px 26px', fontSize: 11, borderRadius: 5,
                  background: '#242424', border: '1px solid rgba(205,162,116,0.1)', color: '#e8e0d8',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
              {taskSearch && (
                <button
                  onClick={() => setTaskSearch('')}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0 }}
                >
                  <X size={10} style={{ color: '#5a5550' }} />
                </button>
              )}
            </div>
            {taskSearch && filteredJobs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 10, color: '#5a5550' }}>
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
                        background: 'rgba(205,162,116,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}
                    >
                      <Plus size={11} style={{ color: '#CDA274' }} />
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

      {/* NEW TASK MODAL */}
      {newTaskForm && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => setNewTaskForm(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#252525', borderRadius: 12, padding: 16, minWidth: 320, maxWidth: 400,
            border: '1px solid rgba(205,162,116,0.15)', boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e8e0d8' }}>New Task</div>
                <div style={{ fontSize: 11, color: '#8a8078', marginTop: 2 }}>{newTaskForm.jobName.replace(/^#\d+\s*/, '')}</div>
              </div>
              <button onClick={() => setNewTaskForm(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                <X size={14} style={{ color: '#6a6058' }} />
              </button>
            </div>

            {/* Task Name */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 4 }}>TASK NAME</label>
              <input
                type="text"
                autoFocus
                placeholder="Enter task name..."
                value={newTaskName}
                onChange={e => setNewTaskName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newTaskName.trim()) createNewTask(); }}
                style={{
                  width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 6,
                  color: '#e8e0d8', fontSize: 12, padding: '7px 10px', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Phase (Category) Selector */}
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 4 }}>PHASE (CATEGORY)</label>
              <select
                value={newTaskPhase}
                onChange={e => setNewTaskPhase(e.target.value)}
                style={{
                  width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 6,
                  color: '#CDA274', fontSize: 12, padding: '7px 10px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box',
                }}
              >
                {PHASES.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {/* Due Date */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, color: '#6a6058', fontWeight: 600, display: 'block', marginBottom: 4 }}>DUE DATE (OPTIONAL)</label>
              <input
                type="date"
                value={newTaskDate}
                onChange={e => setNewTaskDate(e.target.value)}
                style={{
                  width: '100%', background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', borderRadius: 6,
                  color: '#e8e0d8', fontSize: 12, padding: '7px 10px', colorScheme: 'dark', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setNewTaskForm(null)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 6, border: '1px solid rgba(205,162,116,0.15)', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, background: 'transparent', color: '#6a6058',
                }}>
                Cancel
              </button>
              <button
                onClick={createNewTask}
                disabled={!newTaskName.trim() || creatingTask}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: newTaskName.trim() && !creatingTask ? 'pointer' : 'default',
                  fontSize: 12, fontWeight: 600,
                  background: newTaskName.trim() ? '#CDA274' : 'rgba(205,162,116,0.2)',
                  color: newTaskName.trim() ? '#1a1a1a' : '#6a6058',
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

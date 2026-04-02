// @ts-nocheck
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';

/* ── Responsive hook for mobile/tablet/desktop ── */
function useScreenSize() {
  const [size, setSize] = useState<'mobile' | 'tablet' | 'desktop'>('desktop');
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      setSize(w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop');
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return size;
}
import {
  AlertTriangle, Loader2, RefreshCw, Calendar,
  Check, MessageSquare, ChevronDown, ChevronUp,
  Zap, ClipboardList, Circle, CheckCircle2,
  X, Briefcase, CalendarDays, ExternalLink,
  Send, Bot, User, CheckCircle, XCircle,
  TrendingUp, TrendingDown, Minus, Target, Clock3, Activity,
  Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudLightning, CloudFog, Droplets,
  FileWarning, FileCheck, FileClock,
  Paperclip, ImageIcon, X as XIcon
} from 'lucide-react';
import { useAuth } from '@/app/hooks/useAuth';
import {
  formatContent,
  type ChatMessage,
  type TaskConfirmData,
  type COProposalData,
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

function InlineAskAgent({ pmJobs, screen }: { pmJobs: { id: string; name: string; number: string }[]; screen: 'mobile' | 'tablet' | 'desktop' }) {
  const isMobile = screen === 'mobile';
  const isTouch = screen !== 'desktop';
  const [open, setOpen] = useState(false);
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

  // Auto-focus input when opened
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

  const uploadImages = async (): Promise<string[]> => {
    if (attachedImages.length === 0) return uploadedUrls;
    setUploading(true);
    try {
      const formData = new FormData();
      for (const img of attachedImages) formData.append('files', img.file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      const urls = (data.uploaded || []).map((u: any) => u.url);
      setUploadedUrls(prev => [...prev, ...urls]);
      // Clear attached images after upload
      attachedImages.forEach(img => URL.revokeObjectURL(img.preview));
      setAttachedImages([]);
      return [...uploadedUrls, ...urls];
    } catch (err) {
      console.error('Image upload error:', err);
      return uploadedUrls;
    } finally {
      setUploading(false);
    }
  };

  const sendMessage = useCallback(async (userMsg: string) => {
    if (!userMsg.trim() || loading) return;

    // Upload any attached images first
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
      contextParts.push('MODE: CHANGE ORDER SUBMISSION. The user is submitting a change order. Follow the CO submission flow — ask targeted questions, gather all details, then output a @@CO_PROPOSAL@@ for approval.');
    } else if (agentMode === 'specs') {
      contextParts.push('MODE: SPECS ONLY. The user is asking about approved specifications. ONLY answer based on approved documents and specs for this job. Do NOT offer to create change orders, tasks, or modifications — just provide spec information from approved documents.');
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

  // When mode changes, reset conversation and auto-prime the agent
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
      <button
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
        {!isMobile && <span style={{ fontSize: isTouch ? 11 : 9, color: '#5a5550' }}>Tasks · Specs · Change Orders</span>}
        {open ? <ChevronUp size={isTouch ? 16 : 12} style={{ color: '#5a5550' }} /> : <ChevronDown size={isTouch ? 16 : 12} style={{ color: '#5a5550' }} />}
      </button>

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
                  {agentMode === 'change-order' && 'Describe the change — I\'ll ask questions and build the CO'}
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
                  const totalPrice = co.lineItems.reduce((s, li) => s + (li.unitPrice * li.quantity), 0);
                  const totalCost = co.lineItems.reduce((s, li) => s + (li.unitCost * li.quantity), 0);
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
                            {co.lineItems.map((li, liIdx) => (
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
                        {co.followUp?.needed && <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 2 }}>+ Follow-up task → {co.followUp.assignTo || 'Nathan'} by {co.followUp.dueDate || 'TBD'}</div>}
                        {co.imageUrls && co.imageUrls.length > 0 && <div style={{ fontSize: 9, color: '#22c55e', marginTop: 2 }}>+ {co.imageUrls.length} photo(s) will be attached</div>}
                      </div>
                      <div style={{ display: 'flex', gap: isTouch ? 10 : 6 }}>
                        <button onClick={() => {
                          setMessages(prev => prev.map((m, mi) => mi === prev.length - 1 ? { ...m, needsConfirmation: false } : m));
                          sendMessage('Yes, approve this change order. Create it now.\n\n[APPROVED CO DATA — execute create_change_order tool now]\n' + JSON.stringify(co));
                          setUploadedUrls([]); // Clear uploaded URLs after CO approval
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
interface KPISnapshot {
  date: string;
  scheduleAdherence: number | null;
  avgDaysOverdue: number;
  staleTaskCount: number;
  completedThisWeek: number;
  tasksNext7: number;
  tasksNext30: number;
}
interface KPITargets {
  scheduleAdherence: number;
  avgDaysOverdue: number;
  staleTaskCount: number;
  completedPerWeek: number;
  densityNext7: number;
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
  status: 'approved' | 'pending';
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
  kpiHistory: KPISnapshot[];
  kpiTargets: KPITargets;
  changeOrders: ChangeOrder[];
  weather: WeatherDay[];
}

/* ── Mini Sparkline SVG ── */
function Sparkline({ data, color, targetValue, invert }: { data: number[]; color: string; targetValue?: number; invert?: boolean }) {
  if (!data || data.length < 2) return null;
  const w = 60, h = 20, pad = 2;
  const allVals = targetValue !== undefined ? [...data, targetValue] : data;
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return `${x},${y}`;
  });
  const targetY = targetValue !== undefined
    ? pad + (1 - (targetValue - min) / range) * (h - 2 * pad)
    : null;
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      {targetY !== null && (
        <line x1={pad} y1={targetY} x2={w - pad} y2={targetY} stroke="#5a5550" strokeWidth={0.5} strokeDasharray="2,2" />
      )}
      <polyline fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" points={pts.join(' ')} />
      {/* Last point dot */}
      {pts.length > 0 && (() => {
        const last = pts[pts.length - 1].split(',');
        return <circle cx={last[0]} cy={last[1]} r={2} fill={color} />;
      })()}
    </svg>
  );
}

/* ── Target progress bar ── */
function TargetBar({ current, target, invert }: { current: number; target: number; invert?: boolean }) {
  // For "lower is better" metrics (invert=true), flip the calculation
  let pct: number;
  if (invert) {
    // 0 overdue = 100%, target overdue = 50%, 2x target = 0%
    pct = current <= 0 ? 100 : Math.max(0, Math.min(100, (1 - current / (target * 2)) * 100));
  } else {
    pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  }
  const barColor = pct >= 90 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444';
  return (
    <div style={{ width: '100%', height: 3, background: '#2a2a2a', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 2, transition: 'width 0.3s' }} />
    </div>
  );
}

export default function FieldDashboardPage() {
  const auth = useAuth();
  const screen = useScreenSize();
  const isMobile = screen === 'mobile';
  const isTouch = screen !== 'desktop';
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showTasks, setShowTasks] = useState<string | false>(false);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [selectedTask, setSelectedTask] = useState<CalTask | null>(null);
  const [editingDate, setEditingDate] = useState('');
  const [savingDate, setSavingDate] = useState(false);
  const [expandedCOStatus, setExpandedCOStatus] = useState<string | null>(null); // "jobId:status" key
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
    <div style={{ maxWidth: 960, margin: '0 auto', padding: isMobile ? '0 12px' : '0 8px', position: 'relative' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isTouch ? 10 : 6 }}>
        <h1 style={{ color: '#e8e0d8', fontSize: isTouch ? 22 : 18, fontWeight: 700, margin: 0 }}>{getGreeting()}, {firstName}</h1>
        <button onClick={() => fetchData(true)} disabled={refreshing} style={{ padding: 5, borderRadius: 6, background: 'rgba(205,162,116,0.08)', border: 'none', cursor: 'pointer', lineHeight: 0 }}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} style={{ color: '#CDA274' }} />
        </button>
      </div>

      {/* INLINE ASK AGENT */}
      <InlineAskAgent pmJobs={data.pmJobs || []} screen={screen} />

      {/* KPI METRICS with targets + sparklines */}
      {data.kpis && (() => {
        const k = data.kpis;
        const t = data.kpiTargets || { scheduleAdherence: 90, avgDaysOverdue: 7, staleTaskCount: 0, completedPerWeek: 5, densityNext7: 8 };
        const hist = data.kpiHistory || [];
        const adherenceColor = k.scheduleAdherence === null ? '#5a5550' : k.scheduleAdherence >= 75 ? '#22c55e' : k.scheduleAdherence >= 50 ? '#eab308' : '#ef4444';
        const avgOdColor = k.avgDaysOverdue <= 7 ? '#22c55e' : k.avgDaysOverdue <= 21 ? '#eab308' : '#ef4444';
        const staleColor = k.staleTaskCount === 0 ? '#22c55e' : k.staleTaskCount <= 3 ? '#eab308' : '#ef4444';
        const trendIcon = k.completionTrend > 0 ? <TrendingUp size={9} /> : k.completionTrend < 0 ? <TrendingDown size={9} /> : <Minus size={9} />;
        const trendColor = k.completionTrend > 0 ? '#22c55e' : k.completionTrend < 0 ? '#ef4444' : '#5a5550';
        const densityPct = k.tasksNext30 > 0 ? Math.round((k.tasksNext7 / k.tasksNext30) * 100) : 0;
        const densityColor = densityPct > 60 ? '#ef4444' : densityPct > 35 ? '#eab308' : '#22c55e';

        // Extract sparkline data from history
        const histAdherence = hist.map(h => h.scheduleAdherence ?? 0);
        const histOverdue = hist.map(h => h.avgDaysOverdue ?? 0);
        const histStale = hist.map(h => h.staleTaskCount ?? 0);
        const histCompleted = hist.map(h => h.completedThisWeek ?? 0);
        const histDensity = hist.map(h => h.tasksNext7 ?? 0);

        // Append current values so sparkline includes "now"
        const sparkAdherence = [...histAdherence, k.scheduleAdherence ?? 0];
        const sparkOverdue = [...histOverdue, k.avgDaysOverdue];
        const sparkStale = [...histStale, k.staleTaskCount];
        const sparkCompleted = [...histCompleted, k.completedThisWeek];
        const sparkDensity = [...histDensity, k.tasksNext7];

        // Compute trend vs last snapshot for each KPI
        const lastSnap = hist.length > 0 ? hist[hist.length - 1] : null;
        const adherenceDelta = lastSnap && k.scheduleAdherence !== null && lastSnap.scheduleAdherence !== null
          ? k.scheduleAdherence - lastSnap.scheduleAdherence : null;
        const overdueDelta = lastSnap ? k.avgDaysOverdue - lastSnap.avgDaysOverdue : null;
        const staleDelta = lastSnap ? k.staleTaskCount - lastSnap.staleTaskCount : null;
        const densityDelta = lastSnap ? k.tasksNext7 - lastSnap.tasksNext7 : null;

        const TrendBadge = ({ delta, invert }: { delta: number | null; invert?: boolean }) => {
          if (delta === null || delta === 0) return null;
          const isGood = invert ? delta < 0 : delta > 0;
          const color = isGood ? '#22c55e' : '#ef4444';
          const icon = delta > 0 ? <TrendingUp size={7} /> : <TrendingDown size={7} />;
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: 7, color, marginLeft: 3 }}>
              {icon}{invert ? (delta > 0 ? '+' : '') : (delta > 0 ? '+' : '')}{Math.abs(delta) % 1 === 0 ? Math.abs(delta) : Math.abs(delta).toFixed(1)}
            </span>
          );
        };

        return (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(5, 1fr)', gap: isTouch ? 6 : 4, marginBottom: isTouch ? 10 : 6 }}>
            {/* KPI 1: Schedule Adherence */}
            <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${adherenceColor}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <Target size={9} style={{ color: adherenceColor }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>ON-TRACK</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: adherenceColor, lineHeight: 1 }}>
                    {k.scheduleAdherence !== null ? `${k.scheduleAdherence}%` : '—'}
                    <TrendBadge delta={adherenceDelta} />
                  </div>
                  <div style={{ fontSize: 7, color: '#4a4a4a', marginTop: 2 }}>
                    goal {t.scheduleAdherence}%
                  </div>
                </div>
                <Sparkline data={sparkAdherence} color={adherenceColor} targetValue={t.scheduleAdherence} />
              </div>
              <TargetBar current={k.scheduleAdherence ?? 0} target={t.scheduleAdherence} />
            </div>

            {/* KPI 2: Avg Days Overdue */}
            <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${avgOdColor}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <Clock3 size={9} style={{ color: avgOdColor }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>AVG OVERDUE</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: avgOdColor, lineHeight: 1 }}>
                    {k.avgDaysOverdue > 0 ? `${k.avgDaysOverdue}d` : '0'}
                    <TrendBadge delta={overdueDelta} invert />
                  </div>
                  <div style={{ fontSize: 7, color: '#4a4a4a', marginTop: 2 }}>
                    goal ≤{t.avgDaysOverdue}d
                  </div>
                </div>
                <Sparkline data={sparkOverdue} color={avgOdColor} targetValue={t.avgDaysOverdue} invert />
              </div>
              <TargetBar current={k.avgDaysOverdue} target={t.avgDaysOverdue} invert />
            </div>

            {/* KPI 3: Stale Tasks */}
            <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${staleColor}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <AlertTriangle size={9} style={{ color: staleColor }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>STALE</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: staleColor, lineHeight: 1 }}>
                    {k.staleTaskCount}
                    <TrendBadge delta={staleDelta} invert />
                  </div>
                  <div style={{ fontSize: 7, color: '#4a4a4a', marginTop: 2 }}>
                    goal {t.staleTaskCount}
                  </div>
                </div>
                <Sparkline data={sparkStale} color={staleColor} targetValue={t.staleTaskCount} invert />
              </div>
              <TargetBar current={k.staleTaskCount} target={Math.max(t.staleTaskCount, 1)} invert />
            </div>

            {/* KPI 4: Completed This Week */}
            <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid #3b82f6` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <Activity size={9} style={{ color: '#3b82f6' }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>DONE / WK</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6', lineHeight: 1 }}>
                    {k.completedThisWeek}
                  </div>
                  <div style={{ fontSize: 7, color: trendColor, marginTop: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                    {trendIcon} {k.completionTrend > 0 ? '+' : ''}{k.completionTrend} vs last wk · goal {t.completedPerWeek}
                  </div>
                </div>
                <Sparkline data={sparkCompleted} color="#3b82f6" targetValue={t.completedPerWeek} />
              </div>
              <TargetBar current={k.completedThisWeek} target={t.completedPerWeek} />
            </div>

            {/* KPI 5: Upcoming Density */}
            <div style={{ background: '#1e1e1e', borderRadius: 6, padding: '6px 7px', borderLeft: `3px solid ${densityColor}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                <CalendarDays size={9} style={{ color: densityColor }} />
                <span style={{ fontSize: 7, color: '#5a5550', fontWeight: 600, letterSpacing: '0.04em' }}>DENSITY</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: densityColor, lineHeight: 1 }}>
                    {k.tasksNext7}
                    <TrendBadge delta={densityDelta} />
                  </div>
                  <div style={{ fontSize: 7, color: '#4a4a4a', marginTop: 2 }}>
                    of {k.tasksNext30} in 30d · goal {t.densityNext7}
                  </div>
                </div>
                <Sparkline data={sparkDensity} color={densityColor} targetValue={t.densityNext7} />
              </div>
              <TargetBar current={k.tasksNext7} target={t.densityNext7} />
            </div>
          </div>
        );
      })()}

      {/* CHANGE ORDER TRACKER — compact collapsible, grouped by job */}
      {data.changeOrders && data.changeOrders.length > 0 && (() => {
        const pendingCOs = data.changeOrders.filter(co => co.status === 'pending');
        const approvedCOs = data.changeOrders.filter(co => co.status === 'approved');
        const pendingCount = pendingCOs.length;
        const totalCount = data.changeOrders.length;

        // Group ALL COs by job for expanded view
        const byJob = new Map<string, { jobName: string; jobNumber: string; cos: ChangeOrder[] }>();
        for (const co of data.changeOrders) {
          if (!byJob.has(co.jobId)) byJob.set(co.jobId, { jobName: co.jobName, jobNumber: co.jobNumber, cos: [] });
          byJob.get(co.jobId)!.cos.push(co);
        }

        return (
          <>
            <button
              onClick={() => { setShowTasks(showTasks === 'changeOrders' ? false : 'changeOrders'); setExpandedCOStatus(null); }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: pendingCount > 0 ? 'rgba(245,158,11,0.07)' : '#1e1e1e',
                borderWidth: 1, borderStyle: 'solid',
                borderColor: pendingCount > 0 ? 'rgba(245,158,11,0.18)' : 'rgba(205,162,116,0.06)',
                textAlign: 'left', marginBottom: 6,
              }}
            >
              <FileClock size={12} style={{ color: pendingCount > 0 ? '#f59e0b' : '#CDA274', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: pendingCount > 0 ? '#f59e0b' : '#22c55e', lineHeight: 1 }}>{totalCount}</span>
                <span style={{ fontSize: 8, color: '#6a6058', whiteSpace: 'nowrap' }}>Change Orders</span>
                <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
                  {pendingCount > 0 && <span style={{ fontSize: 7, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '1px 4px', borderRadius: 3, fontWeight: 600 }}>{pendingCount} pending</span>}
                  {approvedCOs.length > 0 && <span style={{ fontSize: 7, color: '#22c55e', background: 'rgba(34,197,94,0.12)', padding: '1px 4px', borderRadius: 3, fontWeight: 600 }}>{approvedCOs.length} approved</span>}
                </div>
              </div>
              {showTasks === 'changeOrders' ? <ChevronUp size={11} style={{ color: '#6a6058' }} /> : <ChevronDown size={11} style={{ color: '#6a6058' }} />}
            </button>
            {showTasks === 'changeOrders' && (
              <div style={{ background: '#1e1e1e', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '6px 10px', marginBottom: 6, maxHeight: 260, overflowY: 'auto' }}>
                {Array.from(byJob.entries()).map(([jobId, { jobName, jobNumber, cos }]) => {
                  const jobPending = cos.filter(co => co.status === 'pending');
                  const jobApproved = cos.filter(co => co.status === 'approved');
                  const isJobExpanded = expandedCOStatus === jobId;

                  return (
                    <div key={jobId} style={{ padding: '4px 0', borderBottom: '1px solid rgba(205,162,116,0.06)' }}>
                      <button
                        onClick={() => setExpandedCOStatus(isJobExpanded ? null : jobId)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
                          background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
                        }}
                      >
                        <span style={{ width: 5, height: 5, borderRadius: 3, background: jobColor(jobNumber), flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: '#e8e0d8', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {jobName.replace(/^#\d+\s*/, '')}
                        </span>
                        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                          {jobPending.length > 0 && (
                            <span style={{ fontSize: 9, fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '2px 6px', borderRadius: 4 }}>
                              {jobPending.length} pending
                            </span>
                          )}
                          {jobApproved.length > 0 && (
                            <span style={{ fontSize: 9, fontWeight: 600, color: '#22c55e', background: 'rgba(34,197,94,0.12)', padding: '2px 6px', borderRadius: 4 }}>
                              {jobApproved.length} approved
                            </span>
                          )}
                        </div>
                        {isJobExpanded ? <ChevronUp size={9} style={{ color: '#6a6058' }} /> : <ChevronDown size={9} style={{ color: '#6a6058' }} />}
                      </button>
                      {isJobExpanded && (
                        <div style={{ marginLeft: 11, padding: '2px 0 4px' }}>
                          {cos.map((co, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0', fontSize: 10, color: '#c0b8a8' }}>
                              {co.status === 'approved'
                                ? <FileCheck size={9} style={{ color: '#22c55e', flexShrink: 0 }} />
                                : <FileWarning size={9} style={{ color: '#f59e0b', flexShrink: 0 }} />
                              }
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.coName}</span>
                              <span style={{ fontSize: 8, color: co.status === 'approved' ? '#22c55e' : '#f59e0b', marginLeft: 'auto', flexShrink: 0 }}>
                                {co.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

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
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? `repeat(${Math.min(data.weather.length, 10)}, minmax(50px, 1fr))` : `repeat(${Math.min(data.weather.length, 10)}, 1fr)`, gap: 0, ...(isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : {}) }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(7, minmax(55px, 1fr))' : 'repeat(7, 1fr)', gap: 1, borderRadius: 8, overflow: isMobile ? 'auto' : 'hidden', ...(isMobile ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : {}) }}>
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

      {/* PM JOBS - Kanban columns by Status */}
      {data.pmJobs && data.pmJobs.length > 0 && (() => {
        const STATUS_COLUMNS = [
          { key: 'IN_DESIGN', label: 'In Design', color: '#818cf8' },
          { key: 'READY', label: 'Ready', color: '#fbbf24' },
          { key: 'IN_PRODUCTION', label: 'In Production', color: '#34d399' },
          { key: 'FINAL_BILLING', label: 'Final Billing', color: '#f87171' },
        ];
        const grouped: Record<string, typeof data.pmJobs> = {};
        const uncategorized: typeof data.pmJobs = [];
        for (const col of STATUS_COLUMNS) grouped[col.key] = [];
        for (const job of data.pmJobs) {
          const cat = job.statusCategory;
          if (cat && grouped[cat]) grouped[cat].push(job);
          else uncategorized.push(job);
        }
        const activeCols = STATUS_COLUMNS.filter(c => grouped[c.key].length > 0);
        return (
          <div style={{ background: 'rgba(205,162,116,0.04)', border: '1px solid rgba(205,162,116,0.08)', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
              <Briefcase size={10} style={{ color: '#CDA274' }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: '#CDA274', letterSpacing: '0.06em' }}>MY JOBS</span>
              <span style={{ fontSize: 9, color: '#4a4a4a' }}>({data.pmJobs.length})</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${activeCols.length || 1}, 1fr)`, gap: 6 }}>
              {activeCols.map(col => (
                <div key={col.key} style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 6, padding: '6px 6px 4px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5, paddingLeft: 2 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: col.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 8, fontWeight: 700, color: col.color, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{col.label}</span>
                    <span style={{ fontSize: 8, color: '#4a4a4a' }}>({grouped[col.key].length})</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {grouped[col.key].map(job => (
                      <a
                        key={job.id}
                        href={jtScheduleUrl(job.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '5px 7px', borderRadius: 5,
                          background: 'rgba(205,162,116,0.06)',
                          border: '1px solid rgba(205,162,116,0.08)',
                          textDecoration: 'none', fontSize: 10, color: '#c0b8a8',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(205,162,116,0.15)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(205,162,116,0.06)')}
                      >
                        <span style={{ width: 5, height: 5, borderRadius: 3, background: jobColor(job.number), flexShrink: 0 }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.name.replace(/^#\d+\s*/, '')}</span>
                        <ExternalLink size={7} style={{ color: '#5a5550', flexShrink: 0 }} />
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {uncategorized.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
                {uncategorized.map(job => (
                  <a key={job.id} href={jtScheduleUrl(job.id)} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 5, background: 'rgba(205,162,116,0.06)', border: '1px solid rgba(205,162,116,0.1)', textDecoration: 'none', fontSize: 10, color: '#c0b8a8', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(205,162,116,0.15)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(205,162,116,0.06)')}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: 3, background: jobColor(job.number), flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap' }}>{job.name.replace(/^#\d+\s*/, '')}</span>
                    <ExternalLink size={8} style={{ color: '#5a5550', flexShrink: 0 }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })()}

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

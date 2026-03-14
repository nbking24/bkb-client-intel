// @ts-nocheck
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/* ── Shared types ── */
export interface TaskConfirmData {
  name?: string;
  phase?: string;
  phaseId?: string;
  description?: string;
  assignee?: string;
  startDate?: string;
  endDate?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  agent?: string;
  needsConfirmation?: boolean;
  taskConfirm?: TaskConfirmData;
}

export interface ConversationSummary {
  id: string;
  title: string;
  jt_job_id?: string;
  jt_job_name?: string;
  created_at: string;
  updated_at: string;
}

export interface JobOption {
  id: string;
  name: string;
  number: string;
  clientName: string;
}

export type AgentMode = 'know-it-all' | 'project-details';

export interface UploadedFile {
  name: string;
  content: string;
  extracting: boolean;
}

/* ── Auth helper ── */
export function getAuthToken() {
  const pin = process.env.NEXT_PUBLIC_APP_PIN || '';
  return btoa(pin + ':');
}

/* ── Format time ago ── */
export function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/* ── Suggestions ── */
export function getSuggestions(agentMode: AgentMode): string[] {
  return agentMode === 'know-it-all'
    ? [
        'What active jobs do we have?',
        'Show me all open tasks past due',
        'Create a task for the Smith project',
        "What's the schedule for this project?",
      ]
    : [
        'What siding is specified?',
        'What are the flooring selections?',
        'Show me the exterior specifications',
        'What countertops are specified?',
      ];
}

/* ── Format message content (markdown-lite) ── */
export function formatContent(content: string): React.ReactNode[] {
  // Note: This is imported by UI components that provide their own React context
  const elements: React.ReactNode[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      const codeContent = codeLines.join('\n');
      elements.push(
        { type: 'code', key: `code-${i}`, content: codeContent }
      );
      continue;
    }

    let formatted = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(
      /\[([^\]]+)\]\(((?:https?:\/\/|\/api\/)[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#C9A84C;text-decoration:underline;word-break:break-all;">$1</a>'
    );

    if (line.trim().startsWith('## ')) {
      elements.push({ type: 'h2', key: String(i), html: formatted.replace(/^[\s]*##\s+/, '') });
    } else if (line.trim().startsWith('### ')) {
      elements.push({ type: 'h3', key: String(i), html: formatted.replace(/^[\s]*###\s+/, '') });
    } else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      elements.push({ type: 'bullet', key: String(i), html: formatted.replace(/^[\s]*[-*]\s*/, '') });
    } else if (/^\d+\.\s/.test(line.trim())) {
      elements.push({ type: 'numbered', key: String(i), html: formatted });
    } else if (line.trim() === '---') {
      elements.push({ type: 'hr', key: String(i) });
    } else if (!line.trim()) {
      elements.push({ type: 'spacer', key: String(i) });
    } else {
      elements.push({ type: 'text', key: String(i), html: formatted });
    }
    i++;
  }

  return elements;
}

export type FormattedElement = ReturnType<typeof formatContent>[number];

/* ══════════════════════════════════════════════
   Main hook — all shared state & logic
   ══════════════════════════════════════════════ */
export function useAskAgent() {
  /* ── Core state ── */
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobOption | null>(null);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobSearch, setJobSearch] = useState('');
  const [lastAgent, setLastAgent] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>('know-it-all');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [extractingCount, setExtractingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* ── Sync state ── */
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  /* ── Conversation persistence ── */
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [convsLoading, setConvsLoading] = useState(true);

  /* ── Load data on mount ── */
  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    async function fetchJobs() {
      try {
        const res = await fetch('/api/dashboard/projects', {
          headers: { 'Authorization': `Bearer ${getAuthToken()}` },
        });
        if (res.ok) {
          const data = await res.json();
          const list = (data.projects || []).map((j: any) => ({
            id: j.id, name: j.name, number: j.number || '', clientName: j.clientName || '',
          }));
          list.sort((a: JobOption, b: JobOption) => (parseInt(b.number) || 0) - (parseInt(a.number) || 0));
          setJobs(list);
        }
      } catch (err) { console.error('Failed to load jobs:', err); }
      finally { setJobsLoading(false); }
    }
    fetchJobs();
  }, []);

  /* ── Auto-scroll ── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  /* ── Conversation CRUD ── */
  const loadConversations = async () => {
    try {
      const res = await fetch('/api/conversations', {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      });
      if (res.ok) { const d = await res.json(); setConversations(d.conversations || []); }
    } catch (err) { console.error('Failed to load conversations:', err); }
    finally { setConvsLoading(false); }
  };

  const createNewConversation = async (firstMessage: string): Promise<string | null> => {
    try {
      const title = firstMessage.slice(0, 80) + (firstMessage.length > 80 ? '...' : '');
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          jtJobId: selectedJob?.id,
          jtJobName: selectedJob ? `#${selectedJob.number} ${selectedJob.name}` : undefined,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        setConversationId(d.conversation.id);
        loadConversations();
        return d.conversation.id;
      }
    } catch (err) { console.error('Failed to create conversation:', err); }
    return null;
  };

  const saveMessage = async (convId: string, role: 'user' | 'assistant', content: string, agentName?: string) => {
    try {
      await fetch(`/api/conversations/${convId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content, agentName }),
      });
    } catch (err) { console.error('Failed to save message:', err); }
  };

  const loadConversation = async (convId: string) => {
    try {
      const res = await fetch(`/api/conversations/${convId}`, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      });
      if (res.ok) {
        const d = await res.json();
        setConversationId(convId);
        setMessages(
          (d.messages || []).map((m: any) => ({
            role: m.role, content: m.content, agent: m.agent_name || undefined,
          }))
        );
        setLastAgent(null);
      }
    } catch (err) { console.error('Failed to load conversation:', err); }
  };

  const deleteConversation = async (convId: string) => {
    try {
      await fetch(`/api/conversations/${convId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      });
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (conversationId === convId) startNewChat();
    } catch (err) { console.error('Failed to delete conversation:', err); }
  };

  const startNewChat = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setLastAgent(null);
    setQuery('');
    setUploadedFiles([]);
  }, []);

  /* ── Agent switching ── */
  const switchAgent = useCallback((mode: AgentMode) => {
    if (mode !== agentMode) {
      setAgentMode(mode);
      startNewChat();
    }
  }, [agentMode, startNewChat]);

  /* ── Force sync ── */
  const forceSync = async () => {
    if (syncing) return;
    setSyncing(true); setSyncResult(null);
    try {
      const r = await fetch('/api/sync/force', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      });
      if (!r.ok) throw new Error('Sync failed');
      const d = await r.json();
      setSyncResult(`Synced ${d.totalItems || 0} items in ${d.duration || '?'}`);
      setTimeout(() => setSyncResult(null), 5000);
    } catch {
      setSyncResult('Sync failed');
      setTimeout(() => setSyncResult(null), 4000);
    } finally { setSyncing(false); }
  };

  /* ── Core send function ── */
  const sendMessage = async (userMsg: string) => {
    if (!userMsg.trim() || loading) return;

    let messageForApi = userMsg;
    if (selectedJob) {
      messageForApi = `[Context: The user has selected job "${selectedJob.name}" (#${selectedJob.number}, ID: ${selectedJob.id}, Client: ${selectedJob.clientName}). Use this as the target job for their question.]\n\n${userMsg}`;
    }

    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    let activeConvId = conversationId;
    if (!activeConvId) activeConvId = await createNewConversation(userMsg);
    if (activeConvId) saveMessage(activeConvId, 'user', userMsg);

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
          forcedAgent: agentMode,
          ...(selectedJob ? { jtJobId: selectedJob.id, contactName: selectedJob.clientName } : {}),
        }),
      });

      if (!response.ok) {
        // Try JSON first, then fall back to text to show real error (e.g. Vercel timeout)
        let errorMsg = `HTTP ${response.status}`;
        try {
          const errData = await response.json();
          errorMsg = errData.error || errorMsg;
        } catch {
          try {
            const text = await response.text();
            if (text.includes('FUNCTION_INVOCATION_TIMEOUT')) {
              errorMsg = 'Request timed out — the query took too long. Try a more specific question (e.g. select a project first).';
            } else {
              errorMsg = text.substring(0, 200) || 'Request failed';
            }
          } catch {
            errorMsg = 'Request failed';
          }
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      setLastAgent(data.agent || null);

      const assistantMsg = data.reply || 'No response generated.';
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: assistantMsg,
          agent: data.agent,
          needsConfirmation: data.needsConfirmation || false,
          taskConfirm: data.taskConfirm || undefined,
        },
      ]);

      if (activeConvId) {
        saveMessage(activeConvId, 'assistant', assistantMsg, data.agent);
        loadConversations();
      }
    } catch (err) {
      console.error('Chat error:', err);
      const errMsg = 'Sorry, I ran into an error: ' + (err instanceof Error ? err.message : 'Unknown error') + '. Please try again.';
      setMessages(prev => [...prev, { role: 'assistant', content: errMsg }]);
      if (activeConvId) saveMessage(activeConvId, 'assistant', errMsg);
    } finally {
      setLoading(false);
    }
  };

  /* ── File handling ── */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      if (file.type === 'application/pdf') {
        setUploadedFiles(prev => [...prev, { name: file.name, content: '', extracting: true }]);
        setExtractingCount(prev => prev + 1);

        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64 = (reader.result as string).split(',')[1];
            const res = await fetch('/api/extract-pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
              body: JSON.stringify({ fileName: file.name, base64 }),
            });
            const data = await res.json();
            setUploadedFiles(prev => prev.map(f =>
              f.name === file.name && f.extracting
                ? { name: file.name, content: data.text || 'Failed to extract content.', extracting: false }
                : f
            ));
          } catch {
            setUploadedFiles(prev => prev.map(f =>
              f.name === file.name && f.extracting
                ? { name: file.name, content: '[Error extracting PDF]', extracting: false }
                : f
            ));
          } finally {
            setExtractingCount(prev => prev - 1);
          }
        };
        reader.readAsDataURL(file);
      } else {
        const text = await file.text();
        setUploadedFiles(prev => [...prev, { name: file.name, content: text, extracting: false }]);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (name: string) => {
    setUploadedFiles(prev => prev.filter(f => f.name !== name));
  };

  /* ── Submit handler ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading || extractingCount > 0) return;

    let userMsg = query.trim();
    const readyFiles = uploadedFiles.filter(f => !f.extracting && f.content);
    if (readyFiles.length > 0) {
      const docBlocks = readyFiles.map(f =>
        `--- ATTACHED DOCUMENT: ${f.name} ---\n${f.content}\n--- END DOCUMENT: ${f.name} ---`
      ).join('\n\n');
      userMsg = userMsg + '\n\n' + docBlocks;
    }

    setQuery('');
    setUploadedFiles([]);
    await sendMessage(userMsg);
  };

  /* ── Confirm / Decline ── */
  const handleConfirm = async (edits?: Partial<TaskConfirmData>) => {
    // Grab the taskConfirm data from the last message BEFORE clearing needsConfirmation
    const lastMsg = messages[messages.length - 1];
    const taskData = lastMsg?.taskConfirm;

    setMessages(prev => prev.map((m, i) =>
      i === prev.length - 1 ? { ...m, needsConfirmation: false } : m
    ));

    // Build the confirmation message WITH the full task data so the agent
    // has everything it needs (especially phaseId) to actually execute the tool.
    let confirmMsg = 'Yes, proceed.';
    if (edits) {
      const changes: string[] = [];
      if (edits.phase) changes.push(`put the task under the "${edits.phase}" phase instead`);
      if (edits.assignee) changes.push(`assign to ${edits.assignee}`);
      if (edits.name) changes.push(`rename the task to "${edits.name}"`);
      if (edits.endDate) changes.push(`set the due date to ${edits.endDate}`);
      if (changes.length > 0) {
        confirmMsg = 'Yes, proceed but ' + changes.join(', and ') + '.';
      }
    }

    // Include the task data so Claude can call the actual tool
    if (taskData) {
      const mergedData = edits ? { ...taskData, ...edits } : taskData;
      // If the user changed the phase, REMOVE the stale phaseId so Claude
      // is forced to call get_job_schedule to find the correct one.
      if (edits?.phase && edits.phase !== taskData.phase) {
        delete (mergedData as any).phaseId;
        (mergedData as any).phaseChanged = true;
      }
      confirmMsg += '\n\n[APPROVED TASK DATA — execute this now using create_phase_task tool]\n' + JSON.stringify(mergedData);
    }

    await sendMessage(confirmMsg);
  };

  const handleDecline = () => {
    setMessages(prev => [
      ...prev.map((m, i) =>
        i === prev.length - 1 ? { ...m, needsConfirmation: false } : m
      ),
      { role: 'user', content: 'No, cancel that.' },
      { role: 'assistant', content: 'No problem - action cancelled. Let me know if you need anything else.' },
    ]);
  };

  /* ── Computed values ── */
  const lastMsgNeedsConfirm = messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant' &&
    messages[messages.length - 1].needsConfirmation &&
    !loading;

  const canSend = query.trim().length > 0 && !loading && extractingCount === 0;

  return {
    // State
    query, setQuery,
    messages, setMessages,
    loading,
    jobs, jobsLoading,
    selectedJob, setSelectedJob,
    jobSearch, setJobSearch,
    lastAgent,
    agentMode,
    uploadedFiles,
    extractingCount,
    syncing, syncResult,
    conversationId,
    conversations, convsLoading,

    // Refs
    fileInputRef, messagesEndRef,

    // Actions
    loadConversations,
    loadConversation,
    deleteConversation,
    startNewChat,
    switchAgent,
    forceSync,
    sendMessage,
    handleFileSelect,
    removeFile,
    handleSubmit,
    handleConfirm,
    handleDecline,

    // Computed
    lastMsgNeedsConfirm,
    canSend,
  };
}

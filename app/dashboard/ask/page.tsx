// @ts-nocheck
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, Send, Loader2, Bot, User, ChevronDown, CheckCircle, XCircle, Brain, FileSearch, Paperclip, X, FileText, Plus, Clock, Trash2, PanelLeftClose, PanelLeft } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  agent?: string;
  needsConfirmation?: boolean;
}

interface ConversationSummary {
  id: string;
  title: string;
  jt_job_id?: string;
  jt_job_name?: string;
  created_at: string;
  updated_at: string;
}

interface JobOption {
  id: string;
  name: string;
  number: string;
  clientName: string;
}

type AgentMode = 'know-it-all' | 'project-details';

function getAuthToken() {
  const pin = process.env.NEXT_PUBLIC_APP_PIN || '';
  return btoa(pin + ':');
}

export default function AskAgentPage() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobOption | null>(null);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [showJobDropdown, setShowJobDropdown] = useState(false);
  const [jobSearch, setJobSearch] = useState('');
  const [lastAgent, setLastAgent] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>('know-it-all');
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; content: string; extracting: boolean }>>([]);
  const [extractingCount, setExtractingCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const jobSearchRef = useRef<HTMLInputElement>(null);

  // Conversation persistence state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showSidebar, setShowSidebar] = useState(true);
  const [convsLoading, setConvsLoading] = useState(true);

  // Load conversations list on mount
  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    try {
      const res = await fetch('/api/conversations', {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setConvsLoading(false);
    }
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
        const data = await res.json();
        setConversationId(data.conversation.id);
        loadConversations(); // refresh sidebar
        return data.conversation.id;
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
    return null;
  };

  const saveMessage = async (convId: string, role: 'user' | 'assistant', content: string, agentName?: string) => {
    try {
      await fetch(`/api/conversations/${convId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content, agentName }),
      });
    } catch (err) {
      console.error('Failed to save message:', err);
    }
  };

  const loadConversation = async (convId: string) => {
    try {
      const res = await fetch(`/api/conversations/${convId}`, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversationId(convId);
        setMessages(
          (data.messages || []).map((m: any) => ({
            role: m.role,
            content: m.content,
            agent: m.agent_name || undefined,
          }))
        );
        setLastAgent(null);
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  };

  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/conversations/${convId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
      });
      setConversations(prev => prev.filter(c => c.id !== convId));
      if (conversationId === convId) {
        startNewChat();
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setLastAgent(null);
    setQuery('');
    setUploadedFiles([]);
  };

  // Fetch active jobs on mount
  useEffect(() => {
    async function fetchJobs() {
      try {
        const res = await fetch('/api/dashboard/projects', {
          headers: { 'Authorization': `Bearer ${getAuthToken()}` },
        });
        if (res.ok) {
          const data = await res.json();
          const jobList = (data.projects || []).map((j: any) => ({
            id: j.id,
            name: j.name,
            number: j.number || '',
            clientName: j.clientName || '',
          }));
          jobList.sort((a: JobOption, b: JobOption) => {
            const numA = parseInt(a.number) || 0;
            const numB = parseInt(b.number) || 0;
            return numB - numA;
          });
          setJobs(jobList);
        }
      } catch (err) {
        console.error('Failed to load jobs:', err);
      } finally {
        setJobsLoading(false);
      }
    }
    fetchJobs();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowJobDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // When switching agents, start a new conversation
  const switchAgent = (mode: AgentMode) => {
    if (mode !== agentMode) {
      setAgentMode(mode);
      startNewChat();
    }
  };

  // Core send function
  const sendMessage = async (userMsg: string) => {
    if (!userMsg.trim() || loading) return;

    let messageForApi = userMsg;
    if (selectedJob) {
      messageForApi = `[Context: The user has selected job "${selectedJob.name}" (#${selectedJob.number}, ID: ${selectedJob.id}, Client: ${selectedJob.clientName}). Use this as the target job for their question.]\n\n${userMsg}`;
    }

    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    // Create conversation on first message if needed
    let activeConvId = conversationId;
    if (!activeConvId) {
      activeConvId = await createNewConversation(userMsg);
    }

    // Save user message to DB
    if (activeConvId) {
      saveMessage(activeConvId, 'user', userMsg);
    }

    try {
      const allMessages = [
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: messageForApi },
      ];

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: allMessages,
          lastAgent: lastAgent || undefined,
          forcedAgent: agentMode,
          ...(selectedJob ? {
            jtJobId: selectedJob.id,
            contactName: selectedJob.clientName,
          } : {}),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errData.error || `HTTP ${response.status}`);
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
        },
      ]);

      // Save assistant message to DB
      if (activeConvId) {
        saveMessage(activeConvId, 'assistant', assistantMsg, data.agent);
        // Refresh sidebar to update title/timestamp
        loadConversations();
      }
    } catch (err) {
      console.error('Chat error:', err);
      const errMsg = 'Sorry, I ran into an error: ' + (err instanceof Error ? err.message : 'Unknown error') + '. Please try again.';
      setMessages(prev => [...prev, { role: 'assistant', content: errMsg }]);
      if (activeConvId) {
        saveMessage(activeConvId, 'assistant', errMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle PDF file selection
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
          } catch (err) {
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
    const textarea = document.querySelector('textarea');
    if (textarea) textarea.style.height = '44px';
    await sendMessage(userMsg);
  };

  const handleConfirm = async () => {
    setMessages(prev => prev.map((m, i) =>
      i === prev.length - 1 ? { ...m, needsConfirmation: false } : m
    ));
    await sendMessage('Yes, proceed.');
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

  const handleSuggestion = (suggestion: string) => {
    setQuery(suggestion);
  };

  const formatContent = (content: string) => {
    const elements: React.ReactNode[] = [];
    const lines = content.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

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
          <div key={`code-${i}`} className="relative mt-3 mb-3 rounded-lg" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)' }}>
            <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid rgba(205,162,116,0.1)', background: 'rgba(205,162,116,0.04)' }}>
              <span className="text-[10px] font-medium" style={{ color: '#8a8078' }}>Markdown - Copy below</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(codeContent);
                  const btn = document.activeElement as HTMLButtonElement;
                  if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); }
                }}
                className="text-[10px] px-2 py-0.5 rounded"
                style={{ color: '#C9A84C', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)' }}
              >
                Copy
              </button>
            </div>
            <pre className="px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap" style={{ color: '#c8c0b8', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', lineHeight: '1.5' }}>{codeContent}</pre>
          </div>
        );
        continue;
      }

      let formatted = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      formatted = formatted.replace(
        /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#C9A84C;text-decoration:underline;word-break:break-all;">$1</a>'
      );
      if (line.trim().startsWith('## ')) {
        const headerText = formatted.replace(/^[\s]*##\s+/, '');
        elements.push(<div key={i} className="font-bold mt-3 mb-1" style={{ color: '#C9A84C', fontSize: '0.9rem' }} dangerouslySetInnerHTML={{ __html: headerText }} />);
      } else if (line.trim().startsWith('### ')) {
        const headerText = formatted.replace(/^[\s]*###\s+/, '');
        elements.push(<div key={i} className="font-semibold mt-2 mb-0.5" style={{ color: '#e8e0d8', fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: headerText }} />);
      } else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        elements.push(<div key={i} className="ml-3" dangerouslySetInnerHTML={{ __html: '&bull; ' + formatted.replace(/^[\s]*[-*]\s*/, '') }} />);
      } else if (/^\d+\.\s/.test(line.trim())) {
        elements.push(<div key={i} className="ml-3" dangerouslySetInnerHTML={{ __html: formatted }} />);
      } else if (line.trim() === '---') {
        elements.push(<hr key={i} className="my-3" style={{ borderColor: 'rgba(205,162,116,0.15)' }} />);
      } else if (!line.trim()) {
        elements.push(<div key={i} className="h-2" />);
      } else {
        elements.push(<div key={i} dangerouslySetInnerHTML={{ __html: formatted }} />);
      }
      i++;
    }

    return elements;
  };

  const lastMsgNeedsConfirm = messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant' &&
    messages[messages.length - 1].needsConfirmation &&
    !loading;

  const suggestions = agentMode === 'know-it-all'
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

  const formatTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem-3rem)]">
      {/* Conversation Sidebar */}
      {showSidebar && (
        <div
          className="flex flex-col w-64 flex-shrink-0 mr-4 rounded-lg overflow-hidden"
          style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
        >
          {/* New Chat Button */}
          <button
            onClick={startNewChat}
            className="flex items-center gap-2 m-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all hover:brightness-110"
            style={{
              background: 'linear-gradient(135deg, rgba(201,168,76,0.2), rgba(201,168,76,0.1))',
              color: '#C9A84C',
              border: '1px solid rgba(201,168,76,0.3)',
            }}
          >
            <Plus size={16} />
            New Conversation
          </button>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {convsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={16} className="animate-spin" style={{ color: '#8a8078' }} />
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 text-xs" style={{ color: '#8a8078' }}>
                No conversations yet
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className="group w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-colors hover:bg-white/5 flex flex-col relative"
                  style={{
                    background: conversationId === conv.id ? 'rgba(201,168,76,0.08)' : 'transparent',
                    borderLeft: conversationId === conv.id ? '2px solid #C9A84C' : '2px solid transparent',
                  }}
                >
                  <span
                    className="text-xs font-medium truncate w-full pr-6"
                    style={{ color: conversationId === conv.id ? '#C9A84C' : '#e8e0d8' }}
                  >
                    {conv.title}
                  </span>
                  <span className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: '#8a8078' }}>
                    <Clock size={9} />
                    {formatTimeAgo(conv.updated_at)}
                    {conv.jt_job_name && (
                      <span className="truncate ml-1" style={{ color: 'rgba(201,168,76,0.5)' }}>
                        {conv.jt_job_name}
                      </span>
                    )}
                  </span>
                  {/* Delete button */}
                  <div
                    className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <button
                      onClick={(e) => deleteConversation(conv.id, e)}
                      className="p-1 rounded hover:bg-red-500/10"
                      style={{ color: '#8a8078' }}
                      title="Delete conversation"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2">
            {/* Sidebar toggle */}
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
              style={{ color: '#8a8078' }}
              title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            >
              {showSidebar ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
            </button>
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}>
                Ask Agent
              </h1>
              <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
                {agentMode === 'know-it-all'
                  ? 'Ask questions about your projects, execute tasks in JobTread, or look up client information.'
                  : 'Ask questions about project specifications from the Specifications URL.'}
              </p>
            </div>
          </div>

          {/* Job Selector Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setShowJobDropdown(!showJobDropdown)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors"
              style={{
                background: selectedJob ? 'rgba(201,168,76,0.12)' : '#242424',
                color: selectedJob ? '#C9A84C' : '#8a8078',
                border: selectedJob ? '1px solid rgba(201,168,76,0.3)' : '1px solid rgba(205,162,116,0.12)',
                minWidth: '180px',
              }}
            >
              <span className="truncate flex-1 text-left">
                {selectedJob
                  ? `#${selectedJob.number} ${selectedJob.name}`
                  : 'Select a project (optional)'}
              </span>
              <ChevronDown size={14} className={`transition-transform ${showJobDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showJobDropdown && (
              <div
                className="absolute right-0 top-full mt-1 rounded-lg shadow-lg overflow-hidden z-50"
                style={{
                  background: '#1a1a1a',
                  border: '1px solid rgba(205,162,116,0.15)',
                  maxHeight: '340px',
                  width: '320px',
                }}
              >
                <div className="px-2 py-2" style={{ borderBottom: '1px solid rgba(205,162,116,0.08)' }}>
                  <input
                    ref={jobSearchRef}
                    type="text"
                    placeholder="Type to search projects..."
                    value={jobSearch}
                    onChange={(e) => setJobSearch(e.target.value)}
                    autoFocus
                    className="w-full px-2 py-1.5 rounded text-xs outline-none"
                    style={{
                      background: '#242424',
                      color: '#e8e0d8',
                      border: '1px solid rgba(205,162,116,0.15)',
                    }}
                  />
                </div>

                <button
                  onClick={() => {
                    setSelectedJob(null);
                    setShowJobDropdown(false);
                    setJobSearch('');
                  }}
                  className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-[#242424]"
                  style={{ color: '#8a8078', borderBottom: '1px solid rgba(205,162,116,0.08)' }}
                >
                  No project selected (search all)
                </button>

                <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
                  {jobsLoading ? (
                    <div className="px-3 py-4 text-xs text-center" style={{ color: '#8a8078' }}>
                      <Loader2 size={14} className="animate-spin inline mr-2" />
                      Loading projects...
                    </div>
                  ) : jobs.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-center" style={{ color: '#8a8078' }}>
                      No active projects found
                    </div>
                  ) : (() => {
                    const q = jobSearch.toLowerCase().trim();
                    const filtered = q
                      ? jobs.filter((j) =>
                          j.name.toLowerCase().includes(q) ||
                          j.number.includes(q) ||
                          j.clientName.toLowerCase().includes(q)
                        )
                      : jobs;
                    if (filtered.length === 0) {
                      return (
                        <div className="px-3 py-4 text-xs text-center" style={{ color: '#8a8078' }}>
                          No projects match &ldquo;{jobSearch}&rdquo;
                        </div>
                      );
                    }
                    return filtered.map((job) => (
                      <button
                        key={job.id}
                        onClick={() => {
                          setSelectedJob(job);
                          setShowJobDropdown(false);
                          setJobSearch('');
                        }}
                        className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-[#242424] flex flex-col"
                        style={{
                          color: selectedJob?.id === job.id ? '#C9A84C' : '#e8e0d8',
                          background: selectedJob?.id === job.id ? 'rgba(201,168,76,0.06)' : 'transparent',
                        }}
                      >
                        <span className="font-medium">#{job.number} {job.name}</span>
                        {job.clientName && (
                          <span style={{ color: '#8a8078', fontSize: '10px' }}>{job.clientName}</span>
                        )}
                      </button>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Agent Mode Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => switchAgent('know-it-all')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={agentMode === 'know-it-all' ? {
              background: 'rgba(201,168,76,0.15)',
              color: '#C9A84C',
              border: '1px solid rgba(201,168,76,0.4)',
              boxShadow: '0 0 12px rgba(201,168,76,0.1)',
            } : {
              background: '#242424',
              color: '#8a8078',
              border: '1px solid rgba(205,162,116,0.12)',
            }}
          >
            <Brain size={16} />
            Know-it-All
          </button>
          <button
            onClick={() => switchAgent('project-details')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={agentMode === 'project-details' ? {
              background: 'rgba(201,168,76,0.15)',
              color: '#C9A84C',
              border: '1px solid rgba(201,168,76,0.4)',
              boxShadow: '0 0 12px rgba(201,168,76,0.1)',
            } : {
              background: '#242424',
              color: '#8a8078',
              border: '1px solid rgba(205,162,116,0.12)',
            }}
          >
            <FileSearch size={16} />
            Project Specs
          </button>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
          {messages.length === 0 && (
            <div
              className="flex flex-col items-center justify-center py-20 rounded-lg"
              style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}
            >
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                style={{ background: 'rgba(201,168,76,0.1)' }}
              >
                {agentMode === 'know-it-all'
                  ? <Brain size={28} style={{ color: '#C9A84C' }} />
                  : <FileSearch size={28} style={{ color: '#C9A84C' }} />
                }
              </div>
              <h2 className="text-lg font-bold mb-2" style={{ color: '#C9A84C' }}>
                {agentMode === 'know-it-all' ? 'BKB Project Assistant' : 'Project Specifications'}
              </h2>
              <p className="text-sm max-w-md text-center mb-6" style={{ color: '#8a8078' }}>
                {agentMode === 'know-it-all'
                  ? 'I can search JobTread and GHL to answer questions, create tasks, manage schedules, and more.'
                  : 'I pull specifications directly from the project\'s Specifications URL. Select a project and ask about materials, finishes, or selections.'}
                {selectedJob && (
                  <span style={{ color: '#C9A84C' }}>
                    {' '}Currently focused on <strong>#{selectedJob.number} {selectedJob.name}</strong>.
                  </span>
                )}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSuggestion(suggestion)}
                    className="text-left px-3 py-2 rounded-lg text-xs transition-colors hover:border-opacity-30"
                    style={{
                      background: '#1a1a1a',
                      color: '#8a8078',
                      border: '1px solid rgba(205,162,116,0.08)',
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i}>
              <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
                {msg.role === 'assistant' && (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
                    style={{ background: 'rgba(201,168,76,0.15)' }}
                  >
                    <Bot size={14} style={{ color: '#C9A84C' }} />
                  </div>
                )}
                <div className="flex flex-col max-w-[80%]">
                  {msg.role === 'assistant' && msg.agent && (
                    <span className="text-[10px] mb-1 px-1.5 py-0.5 rounded w-fit" style={{ color: '#C9A84C', background: 'rgba(201,168,76,0.08)' }}>
                      {msg.agent}
                    </span>
                  )}
                  <div
                    className="px-4 py-3 rounded-lg text-sm leading-relaxed"
                    style={
                      msg.role === 'user'
                        ? { background: '#1B3A5C', color: '#e8e0d8' }
                        : { background: '#242424', color: '#e8e0d8', border: '1px solid rgba(205,162,116,0.08)' }
                    }
                  >
                    {msg.role === 'assistant' ? formatContent(msg.content) : msg.content}
                  </div>
                </div>
                {msg.role === 'user' && (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
                    style={{ background: 'rgba(27,58,92,0.3)' }}
                  >
                    <User size={14} style={{ color: '#e8e0d8' }} />
                  </div>
                )}
              </div>

              {msg.needsConfirmation && i === messages.length - 1 && !loading && (
                <div className="flex gap-2 mt-2 ml-9">
                  <button
                    onClick={handleConfirm}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110"
                    style={{
                      background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                      color: '#fff',
                      boxShadow: '0 2px 8px rgba(34,197,94,0.3)',
                    }}
                  >
                    <CheckCircle size={16} />
                    Approve
                  </button>
                  <button
                    onClick={handleDecline}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110"
                    style={{
                      background: '#3a2a2a',
                      color: '#f87171',
                      border: '1px solid rgba(248,113,113,0.2)',
                    }}
                  >
                    <XCircle size={16} />
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(201,168,76,0.15)' }}
              >
                <Bot size={14} style={{ color: '#C9A84C' }} />
              </div>
              <div
                className="px-4 py-3 rounded-lg flex items-center gap-2"
                style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}
              >
                <Loader2 size={16} className="animate-spin" style={{ color: '#C9A84C' }} />
                <span className="text-xs" style={{ color: '#8a8078' }}>
                  {agentMode === 'project-details' ? 'Reading specifications...' : 'Searching your data...'}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="relative">
          {selectedJob && (
            <div
              className="absolute -top-6 left-0 text-[10px] px-2 py-0.5 rounded-t"
              style={{ color: '#C9A84C', background: 'rgba(201,168,76,0.08)' }}
            >
              Focused: #{selectedJob.number} {selectedJob.name}
            </div>
          )}

          {/* Attached file chips */}
          {uploadedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 py-2 rounded-t-lg" style={{ background: '#242424', borderTop: '1px solid rgba(205,162,116,0.12)', borderLeft: '1px solid rgba(205,162,116,0.12)', borderRight: '1px solid rgba(205,162,116,0.12)' }}>
              {uploadedFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px]"
                  style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)', color: '#C9A84C' }}
                >
                  {file.extracting ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <FileText size={12} />
                  )}
                  <span className="max-w-[150px] truncate">{file.name}</span>
                  {file.extracting ? (
                    <span style={{ color: '#8a8078' }}>Extracting...</span>
                  ) : (
                    <button type="button" onClick={() => removeFile(file.name)} className="hover:brightness-150">
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="relative">
            <textarea
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (query.trim() && !loading && extractingCount === 0) {
                    handleSubmit(e as any);
                  }
                }
              }}
              placeholder={
                agentMode === 'project-details'
                  ? (selectedJob ? `Ask about specs for #${selectedJob.number} ${selectedJob.name}...` : 'Select a project, then ask about specifications...')
                  : (selectedJob ? `Ask about #${selectedJob.number} ${selectedJob.name}...` : 'Ask about any project, create tasks, or check schedules...')
              }
              rows={1}
              className="w-full pl-10 pr-12 py-3 text-sm outline-none resize-none"
              style={{
                background: '#242424',
                color: '#e8e0d8',
                border: selectedJob ? '1px solid rgba(201,168,76,0.25)' : '1px solid rgba(205,162,116,0.12)',
                borderRadius: uploadedFiles.length > 0 ? '0 0 0.5rem 0.5rem' : '0.5rem',
                minHeight: '44px',
                maxHeight: '160px',
                overflowY: 'auto',
              }}
              disabled={loading}
            />

            {/* Paperclip button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded transition-colors hover:bg-white/5"
              style={{ color: uploadedFiles.length > 0 ? '#C9A84C' : '#8a8078' }}
              title="Attach PDF, TXT, or MD file"
            >
              <Paperclip size={16} />
            </button>

            {/* Send button */}
            <button
              type="submit"
              disabled={!query.trim() || loading || extractingCount > 0}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors"
              style={{
                color: query.trim() && !loading && extractingCount === 0 ? '#C9A84C' : '#8a8078',
                background: query.trim() && !loading && extractingCount === 0 ? 'rgba(201,168,76,0.1)' : 'transparent',
              }}
            >
              <Send size={18} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

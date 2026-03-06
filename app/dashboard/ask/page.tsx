// @ts-nocheck
'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, Loader2, Bot, User, ChevronDown, CheckCircle, XCircle, Brain, FileSearch, Paperclip, X, FileText } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  agent?: string;
  needsConfirmation?: boolean;
}

interface JobOption {
  id: string;
  name: string;
  number: string;
  clientName: string;
}

type AgentMode = 'know-it-all' | 'project-details';

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

  // Fetch active jobs on mount
  useEffect(() => {
    async function fetchJobs() {
      try {
        const pin = process.env.NEXT_PUBLIC_APP_PIN || '';
        const token = btoa(pin + ':');
        const res = await fetch('/api/dashboard/projects', {
          headers: { 'Authorization': `Bearer ${token}` },
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

  // When switching agents, clear conversation
  const switchAgent = (mode: AgentMode) => {
    if (mode !== agentMode) {
      setAgentMode(mode);
      setMessages([]);
      setLastAgent(null);
      setQuery('');
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

    try {
      const pin = process.env.NEXT_PUBLIC_APP_PIN || '';
      const token = btoa(pin + ':');

      const allMessages = [
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: messageForApi },
      ];

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
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

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || 'No response generated.',
          agent: data.agent,
          needsConfirmation: data.needsConfirmation || false,
        },
      ]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I ran into an error: ' + (err instanceof Error ? err.message : 'Unknown error') + '. Please try again.',
        },
      ]);
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
        // Add placeholder with extracting state
        setUploadedFiles(prev => [...prev, { name: file.name, content: '', extracting: true }]);
        setExtractingCount(prev => prev + 1);

        // Read as base64 and extract
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64 = (reader.result as string).split(',')[1];
            const pin = process.env.NEXT_PUBLIC_APP_PIN || '';
            const token = btoa(pin + ':');
            const res = await fetch('/api/extract-pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
        // Plain text files
        const text = await file.text();
        setUploadedFiles(prev => [...prev, { name: file.name, content: text, extracting: false }]);
      }
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (name: string) => {
    setUploadedFiles(prev => prev.filter(f => f.name !== name));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading || extractingCount > 0) return;
    let userMsg = query.trim();

    // Embed attached document content into the message
    const readyFiles = uploadedFiles.filter(f => !f.extracting && f.content);
    if (readyFiles.length > 0) {
      const docBlocks = readyFiles.map(f =>
        `--- ATTACHED DOCUMENT: ${f.name} ---\n${f.content}\n--- END DOCUMENT: ${f.name} ---`
      ).join('\n\n');
      userMsg = userMsg + '\n\n' + docBlocks;
    }

    setQuery('');
    setUploadedFiles([]);
    // Reset textarea height after clearing
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
      { role: 'assistant', content: 'No problem — action cancelled. Let me know if you need anything else.' },
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

      // Detect code block opening (```markdown or ``` anything)
      if (line.trim().startsWith('```')) {
        const codeLines: string[] = [];
        i++; // skip opening ```
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```
        const codeContent = codeLines.join('\n');
        elements.push(
          <div key={`code-${i}`} className="relative mt-3 mb-3 rounded-lg" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)' }}>
            <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid rgba(205,162,116,0.1)', background: 'rgba(205,162,116,0.04)' }}>
              <span className="text-[10px] font-medium" style={{ color: '#8a8078' }}>Markdown — Copy below</span>
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

      // Process regular lines: bold, then links
      let formatted = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      formatted = formatted.replace(
        /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#C9A84C;text-decoration:underline;word-break:break-all;">$1</a>'
      );
      // Convert ## headers to styled headers
      if (line.trim().startsWith('## ')) {
        const headerText = formatted.replace(/^[\s]*##\s+/, '');
        elements.push(<div key={i} className="font-bold mt-3 mb-1" style={{ color: '#C9A84C', fontSize: '0.9rem' }} dangerouslySetInnerHTML={{ __html: headerText }} />);
      } else if (line.trim().startsWith('### ')) {
        const headerText = formatted.replace(/^[\s]*###\s+/, '');
        elements.push(<div key={i} className="font-semibold mt-2 mb-0.5" style={{ color: '#e8e0d8', fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: headerText }} />);
      } else if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
        elements.push(<div key={i} className="ml-3" dangerouslySetInnerHTML={{ __html: '&bull; ' + formatted.replace(/^[\s]*[-•]\s*/, '') }} />);
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

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-3rem)]">
      <div className="mb-4 flex items-start justify-between">
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
  );
}

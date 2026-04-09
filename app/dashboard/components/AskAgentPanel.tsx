// @ts-nocheck
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/hooks/useAuth';
import { X, Send, Loader2, MessageSquare, ChevronDown, Search, Bot, Brain, FileSearch } from 'lucide-react';

/* ── Types ── */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  agent?: string;
}

interface JobOption {
  id: string;
  name: string;
  number: string;
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('bkb-token') || '' : '';
}

/* ── Simple Markdown-ish rendering ── */
function renderContent(text: string) {
  let html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br/>');
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ── COMPONENT ── */
export default function AskAgentPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const auth = useAuth();
  const isFieldStaff = auth.role === 'field_sup' || auth.role === 'field';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastAgent, setLastAgent] = useState<string>('');
  const [agentMode, setAgentMode] = useState<'know-it-all' | 'project-details' | 'field-staff'>(
    'know-it-all'
  );

  // Force field staff to their restricted agent mode
  useEffect(() => {
    if (isFieldStaff && agentMode !== 'field-staff') {
      setAgentMode('field-staff' as any);
    }
  }, [isFieldStaff]);

  // Job selection
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobOption | null>(null);
  const [jobSearch, setJobSearch] = useState('');
  const [jobDropdownOpen, setJobDropdownOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const jobSearchRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  // Fetch jobs on mount
  useEffect(() => {
    fetch('/api/dashboard/projects', {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setJobs(data.map((j: any) => ({ id: j.id, name: j.name, number: j.number || '' })));
        } else if (data.jobs) {
          setJobs(data.jobs.map((j: any) => ({ id: j.id, name: j.name, number: j.number || '' })));
        }
      })
      .catch(() => {});
  }, []);

  // Close job dropdown on click outside
  useEffect(() => {
    if (!jobDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.job-dropdown-container')) {
        setJobDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [jobDropdownOpen]);

  const filteredJobs = jobs
    .filter(
      (j) =>
        j.name.toLowerCase().includes(jobSearch.toLowerCase()) ||
        j.number.includes(jobSearch)
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  /* ── Send message ── */
  const sendMessage = useCallback(
    async (text?: string) => {
      const msg = (text || input).trim();
      if (!msg || loading) return;
      if (!text) setInput('');

      const userMsg: ChatMessage = { role: 'user', content: msg };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        let fullContent = msg;
        if (selectedJob) {
          fullContent = `[Context: job "${selectedJob.name}" #${selectedJob.number}, JT ID: ${selectedJob.id}]\n${msg}`;
        }

        const allMessages = [...messages, { role: 'user', content: fullContent }];

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({
            messages: allMessages.slice(-20),
            lastAgent: lastAgent || undefined,
            jtJobId: selectedJob?.id || undefined,
            forcedAgent: agentMode,
          }),
        });

        if (!res.ok) throw new Error('Chat failed');
        const data = await res.json();

        setLastAgent(data.agent || '');
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.reply, agent: data.agent },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [input, loading, messages, selectedJob, lastAgent, agentMode]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setLastAgent('');
  };

  const switchAgent = (mode: 'know-it-all' | 'project-details') => {
    if (mode === agentMode) return;
    setAgentMode(mode);
    setMessages([]);
    setLastAgent('');
  };

  const suggestions = isFieldStaff
    ? [
        'What are my tasks for today?',
        'What siding is specified?',
        'Mark my tasks as complete',
        'What plumbing fixtures are approved?',
      ]
    : agentMode === 'know-it-all'
    ? [
        'What am I waiting on?',
        'Which projects have gone quiet?',
        'What tasks are overdue?',
        "What's on my calendar today?",
      ]
    : [
        'What siding is specified?',
        'What are the flooring selections?',
        'Show me the countertop specs',
        'What plumbing fixtures are approved?',
      ];

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:bg-transparent"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`
          fixed top-0 right-0 z-50 h-full w-full md:w-[420px] flex flex-col
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
        style={{
          background: '#ffffff',
          borderLeft: '1px solid rgba(200,140,0,0.15)',
          boxShadow: isOpen ? '-4px 0 24px rgba(0,0,0,0.4)' : 'none',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ background: '#f8f6f3', borderBottom: '1px solid rgba(200,140,0,0.12)' }}
        >
          <div className="flex items-center gap-2">
            <Bot size={18} style={{ color: '#c88c00' }} />
            <span className="text-sm font-semibold" style={{ color: '#1a1a1a' }}>
              Ask Agent
            </span>
            {lastAgent && (
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(200,140,0,0.1)', color: '#c88c00' }}
              >
                {lastAgent}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="text-xs px-2 py-1 rounded hover:bg-white/10"
                style={{ color: '#8a8078' }}
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10"
            >
              <X size={18} style={{ color: '#8a8078' }} />
            </button>
          </div>
        </div>

        {/* Agent mode toggle — hidden for field staff */}
        {!isFieldStaff && (
        <div
          className="px-4 py-2 flex-shrink-0 flex gap-2"
          style={{ borderBottom: '1px solid rgba(200,140,0,0.08)' }}
        >
          <button
            onClick={() => switchAgent('know-it-all')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-1 justify-center"
            style={agentMode === 'know-it-all'
              ? { background: 'rgba(201,168,76,0.15)', color: '#c88c00', border: '1px solid rgba(201,168,76,0.4)' }
              : { background: '#f8f6f3', color: '#8a8078', border: '1px solid rgba(200,140,0,0.12)' }
            }
          >
            <Brain size={13} /> Know-it-All
          </button>
          <button
            onClick={() => switchAgent('project-details')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-1 justify-center"
            style={agentMode === 'project-details'
              ? { background: 'rgba(201,168,76,0.15)', color: '#c88c00', border: '1px solid rgba(201,168,76,0.4)' }
              : { background: '#f8f6f3', color: '#8a8078', border: '1px solid rgba(200,140,0,0.12)' }
            }
          >
            <FileSearch size={13} /> Approved Specs
          </button>
        </div>
        )}

        {/* Job selector */}
        <div
          className="px-4 py-2 flex-shrink-0 job-dropdown-container"
          style={{ borderBottom: '1px solid rgba(200,140,0,0.08)' }}
        >
          <div className="relative">
            <button
              onClick={() => {
                setJobDropdownOpen(!jobDropdownOpen);
                setTimeout(() => jobSearchRef.current?.focus(), 100);
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm"
              style={{
                background: '#ffffff',
                border: '1px solid rgba(200,140,0,0.12)',
                color: selectedJob ? '#1a1a1a' : '#8a8078',
              }}
            >
              <span className="truncate">
                {selectedJob
                  ? `${selectedJob.name} #${selectedJob.number}`
                  : 'All projects (select to focus)'}
              </span>
              <ChevronDown size={14} style={{ color: '#8a8078' }} />
            </button>

            {jobDropdownOpen && (
              <div
                className="absolute top-full left-0 right-0 mt-1 rounded-lg overflow-hidden shadow-xl z-10"
                style={{
                  background: '#f8f6f3',
                  border: '1px solid rgba(200,140,0,0.15)',
                  maxHeight: '240px',
                }}
              >
                <div className="p-2" style={{ borderBottom: '1px solid rgba(200,140,0,0.08)' }}>
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: '#ffffff' }}>
                    <Search size={12} style={{ color: '#8a8078' }} />
                    <input
                      ref={jobSearchRef}
                      type="text"
                      value={jobSearch}
                      onChange={(e) => setJobSearch(e.target.value)}
                      placeholder="Search jobs..."
                      className="flex-1 bg-transparent text-sm outline-none"
                      style={{ color: '#1a1a1a' }}
                    />
                  </div>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: '180px' }}>
                  <button
                    onClick={() => {
                      setSelectedJob(null);
                      setJobDropdownOpen(false);
                      setJobSearch('');
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-black/5"
                    style={{ color: !selectedJob ? '#c88c00' : '#8a8078' }}
                  >
                    All projects
                  </button>
                  {filteredJobs.map((j) => (
                    <button
                      key={j.id}
                      onClick={() => {
                        setSelectedJob(j);
                        setJobDropdownOpen(false);
                        setJobSearch('');
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 truncate"
                      style={{
                        color: selectedJob?.id === j.id ? '#c88c00' : '#1a1a1a',
                      }}
                    >
                      {j.name}{' '}
                      <span style={{ color: '#8a8078' }}>#{j.number}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: 0 }}>
          {messages.length === 0 && (
            <div className="text-center py-8">
              {agentMode === 'know-it-all'
                ? <Brain size={28} className="mx-auto mb-3" style={{ color: '#c88c00', opacity: 0.4 }} />
                : <FileSearch size={28} className="mx-auto mb-3" style={{ color: '#c88c00', opacity: 0.4 }} />
              }
              <p className="text-sm mb-1" style={{ color: '#1a1a1a' }}>
                {agentMode === 'know-it-all' ? 'Ask me anything' : 'Approved Specs Only'}
              </p>
              <p className="text-xs mb-4" style={{ color: '#8a8078' }}>
                {agentMode === 'know-it-all'
                  ? 'Projects, tasks, emails, schedule, specs, or log updates'
                  : 'Answers only from approved contracts & change orders'}
              </p>
              <div className="space-y-2">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s)}
                    className="block w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-white/[0.05]"
                    style={{
                      color: '#a09890',
                      border: '1px solid rgba(200,140,0,0.08)',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[88%] ${msg.role === 'assistant' ? 'space-y-1' : ''}`}>
                <div
                  className="px-3 py-2 rounded-xl text-sm"
                  style={
                    msg.role === 'user'
                      ? { background: '#c88c00', color: '#ffffff' }
                      : {
                          background: '#f8f6f3',
                          color: '#1a1a1a',
                          border: '1px solid rgba(200,140,0,0.08)',
                        }
                  }
                >
                  {renderContent(msg.content)}
                </div>
                {msg.agent && (
                  <div className="text-right">
                    <span className="text-[10px]" style={{ color: '#6a6058' }}>
                      via {msg.agent}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div
                className="px-3 py-2 rounded-xl flex items-center gap-2"
                style={{ background: '#f8f6f3' }}
              >
                <Loader2
                  size={14}
                  className="animate-spin"
                  style={{ color: '#c88c00' }}
                />
                <span className="text-xs" style={{ color: '#8a8078' }}>
                  {agentMode === 'project-details' ? 'Reading approved specs...' : 'Thinking...'}
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          className="px-3 py-3 flex-shrink-0"
          style={{
            background: '#f8f6f3',
            borderTop: '1px solid rgba(200,140,0,0.12)',
          }}
        >
          <div
            className="flex items-end gap-2 rounded-lg px-3 py-2"
            style={{
              background: '#ffffff',
              border: '1px solid rgba(200,140,0,0.12)',
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={agentMode === 'project-details'
                ? (selectedJob ? `Ask about approved specs for #${selectedJob.number}...` : 'Select a project, then ask about approved specs...')
                : 'Ask about projects, tasks, schedule...'}
              rows={1}
              className="flex-1 bg-transparent text-sm outline-none resize-none"
              style={{
                color: '#1a1a1a',
                maxHeight: '120px',
              }}
              disabled={loading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="p-1.5 rounded-lg disabled:opacity-30 hover:bg-white/10"
              style={{ color: '#c88c00' }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
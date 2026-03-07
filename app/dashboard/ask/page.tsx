// @ts-nocheck
'use client';

import { useState, useRef, useEffect } from 'react';
import {
  MessageSquare, Send, Loader2, Bot, User, ChevronDown, CheckCircle, XCircle,
  Brain, FileSearch, Paperclip, X, FileText, Plus, Clock, Trash2,
  PanelLeftClose, PanelLeft, RefreshCw,
} from 'lucide-react';
import {
  useAskAgent, formatContent, formatTimeAgo, getSuggestions,
  type ChatMessage, type AgentMode, type TaskConfirmData,
} from '@/app/hooks/useAskAgent';

/* ── Render formatted elements to JSX ── */
function RenderContent({ content }: { content: string }) {
  const elements = formatContent(content);
  return (
    <>
      {elements.map((el: any) => {
        if (el.type === 'code') {
          return (
            <div key={el.key} className="relative mt-3 mb-3 rounded-lg" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)' }}>
              <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid rgba(205,162,116,0.1)', background: 'rgba(205,162,116,0.04)' }}>
                <span className="text-[10px] font-medium" style={{ color: '#8a8078' }}>Markdown - Copy below</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(el.content);
                    const btn = document.activeElement as HTMLButtonElement;
                    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); }
                  }}
                  className="text-[10px] px-2 py-0.5 rounded"
                  style={{ color: '#C9A84C', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)' }}
                >Copy</button>
              </div>
              <pre className="px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap" style={{ color: '#c8c0b8', fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', lineHeight: '1.5' }}>{el.content}</pre>
            </div>
          );
        }
        if (el.type === 'h2') return <div key={el.key} className="font-bold mt-3 mb-1" style={{ color: '#C9A84C', fontSize: '0.9rem' }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'h3') return <div key={el.key} className="font-semibold mt-2 mb-0.5" style={{ color: '#e8e0d8', fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'bullet') return <div key={el.key} className="ml-3" dangerouslySetInnerHTML={{ __html: '&bull; ' + el.html }} />;
        if (el.type === 'numbered') return <div key={el.key} className="ml-3" dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'hr') return <hr key={el.key} className="my-3" style={{ borderColor: 'rgba(205,162,116,0.15)' }} />;
        if (el.type === 'spacer') return <div key={el.key} className="h-2" />;
        return <div key={el.key} dangerouslySetInnerHTML={{ __html: el.html }} />;
      })}
    </>
  );
}

const BKB_PHASES = [
  'Admin Tasks', 'Conceptual Design', 'Design Development', 'Contract',
  'Preconstruction', 'In Production', 'Inspections', 'Punch/Closeout', 'Project Completion',
];

/* ── Task Confirmation Card (editable phase) ── */
function TaskConfirmCard({ data, onPhaseChange }: { data: TaskConfirmData; onPhaseChange?: (phase: string) => void }) {
  const [editingPhase, setEditingPhase] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState(data.phase || '');

  const handlePhaseSelect = (phase: string) => {
    setSelectedPhase(phase);
    setEditingPhase(false);
    if (onPhaseChange) onPhaseChange(phase);
  };

  const displayPhase = selectedPhase || data.phase;
  const phaseChanged = displayPhase !== data.phase;

  return (
    <div className="mt-3 rounded-lg overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid rgba(201,168,76,0.25)' }}>
      <div className="px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(201,168,76,0.08)', borderBottom: '1px solid rgba(201,168,76,0.15)' }}>
        <span className="text-xs font-semibold" style={{ color: '#C9A84C' }}>Task Preview</span>
        {phaseChanged && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)' }}>Phase edited</span>}
      </div>
      <div className="px-3 py-2.5 space-y-1.5">
        {data.name && (
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-medium w-16 flex-shrink-0 pt-0.5" style={{ color: '#8a8078' }}>Name</span>
            <span className="text-sm font-medium" style={{ color: '#e8e0d8' }}>{data.name}</span>
          </div>
        )}
        <div className="flex items-start gap-2 relative">
          <span className="text-[10px] font-medium w-16 flex-shrink-0 pt-0.5" style={{ color: '#8a8078' }}>Phase</span>
          <button onClick={() => setEditingPhase(!editingPhase)} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors hover:brightness-125" style={{ color: phaseChanged ? '#22c55e' : '#C9A84C', background: phaseChanged ? 'rgba(34,197,94,0.1)' : 'rgba(201,168,76,0.1)', border: '1px solid ' + (phaseChanged ? 'rgba(34,197,94,0.2)' : 'rgba(201,168,76,0.2)'), cursor: 'pointer' }}>
            {displayPhase} <ChevronDown size={10} className={`transition-transform ${editingPhase ? 'rotate-180' : ''}`} />
          </button>
          {editingPhase && (
            <div className="absolute left-16 top-7 z-20 rounded-lg shadow-lg overflow-hidden" style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.2)', minWidth: '200px' }}>
              {BKB_PHASES.map(phase => (
                <button key={phase} onClick={() => handlePhaseSelect(phase)} className="w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-white/5" style={{ color: phase === displayPhase ? '#C9A84C' : '#e8e0d8', background: phase === displayPhase ? 'rgba(201,168,76,0.08)' : 'transparent' }}>
                  {phase}
                </button>
              ))}
            </div>
          )}
        </div>
        {data.assignee && (
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-medium w-16 flex-shrink-0 pt-0.5" style={{ color: '#8a8078' }}>Assignee</span>
            <span className="text-xs" style={{ color: '#e8e0d8' }}>{data.assignee}</span>
          </div>
        )}
        {(data.startDate || data.endDate) && (
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-medium w-16 flex-shrink-0 pt-0.5" style={{ color: '#8a8078' }}>Dates</span>
            <span className="text-xs" style={{ color: '#e8e0d8' }}>
              {data.startDate && data.endDate ? `${data.startDate} → ${data.endDate}` : data.endDate ? `Due: ${data.endDate}` : `Start: ${data.startDate}`}
            </span>
          </div>
        )}
        {data.description && (
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-medium w-16 flex-shrink-0 pt-0.5" style={{ color: '#8a8078' }}>Details</span>
            <span className="text-xs leading-relaxed" style={{ color: '#c8c0b8' }}>{data.description}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AskAgentPage() {
  const {
    query, setQuery, messages, loading,
    jobs, jobsLoading, selectedJob, setSelectedJob,
    jobSearch, setJobSearch, agentMode,
    uploadedFiles, extractingCount,
    syncing, syncResult,
    conversationId, conversations, convsLoading,
    fileInputRef, messagesEndRef,
    loadConversation, deleteConversation, startNewChat,
    switchAgent, forceSync, handleFileSelect, removeFile,
    handleSubmit, handleConfirm, handleDecline,
    lastMsgNeedsConfirm, canSend,
  } = useAskAgent();

  // Desktop-specific state
  const [showJobDropdown, setShowJobDropdown] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [phaseEdit, setPhaseEdit] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const jobSearchRef = useRef<HTMLInputElement>(null);

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

  const suggestions = getSuggestions(agentMode);

  const handleDeleteConv = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteConversation(convId);
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem-3rem)]">
      {/* Conversation Sidebar */}
      {showSidebar && (
        <div
          className="flex flex-col w-64 flex-shrink-0 mr-4 rounded-lg overflow-hidden"
          style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
        >
          <button
            onClick={startNewChat}
            className="flex items-center gap-2 m-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(135deg, rgba(201,168,76,0.2), rgba(201,168,76,0.1))', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}
          >
            <Plus size={16} /> New Conversation
          </button>

          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {convsLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 size={16} className="animate-spin" style={{ color: '#8a8078' }} /></div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 text-xs" style={{ color: '#8a8078' }}>No conversations yet</div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className="group w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-colors hover:bg-white/5 flex flex-col relative"
                  style={{ background: conversationId === conv.id ? 'rgba(201,168,76,0.08)' : 'transparent', borderLeft: conversationId === conv.id ? '2px solid #C9A84C' : '2px solid transparent' }}
                >
                  <span className="text-xs font-medium truncate w-full pr-6" style={{ color: conversationId === conv.id ? '#C9A84C' : '#e8e0d8' }}>
                    {conv.title}
                  </span>
                  <span className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: '#8a8078' }}>
                    <Clock size={9} />
                    {formatTimeAgo(conv.updated_at)}
                    {conv.jt_job_name && <span className="truncate ml-1" style={{ color: 'rgba(201,168,76,0.5)' }}>{conv.jt_job_name}</span>}
                  </span>
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => handleDeleteConv(conv.id, e)} className="p-1 rounded hover:bg-red-500/10" style={{ color: '#8a8078' }} title="Delete conversation">
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
            <button onClick={() => setShowSidebar(!showSidebar)} className="p-1.5 rounded-lg transition-colors hover:bg-white/5" style={{ color: '#8a8078' }} title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}>
              {showSidebar ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
            </button>
            <div>
              <h1 className="text-2xl font-bold" style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}>Ask Agent</h1>
              <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
                {agentMode === 'know-it-all'
                  ? 'Ask questions about your projects, execute tasks in JobTread, or look up client information.'
                  : 'Ask questions about project specifications from the Specifications URL.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {syncResult && <span className="text-[10px] px-2 py-1 rounded" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.08)' }}>{syncResult}</span>}
            <button onClick={forceSync} disabled={syncing} title="Sync GHL & JobTread data" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-all hover:brightness-110 disabled:opacity-40" style={{ background: '#242424', color: syncing ? '#C9A84C' : '#8a8078', border: '1px solid rgba(205,162,116,0.12)' }}>
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
          </div>

          <div className="relative" ref={dropdownRef}>
            <button type="button" onClick={() => setShowJobDropdown(!showJobDropdown)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors" style={{ background: selectedJob ? 'rgba(201,168,76,0.12)' : '#242424', color: selectedJob ? '#C9A84C' : '#8a8078', border: selectedJob ? '1px solid rgba(201,168,76,0.3)' : '1px solid rgba(205,162,116,0.12)', minWidth: '180px' }}>
              <span className="truncate flex-1 text-left">{selectedJob ? `#${selectedJob.number} ${selectedJob.name}` : 'Select a project (optional)'}</span>
              <ChevronDown size={14} className={`transition-transform ${showJobDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showJobDropdown && (
              <div className="absolute right-0 top-full mt-1 rounded-lg shadow-lg overflow-hidden z-50" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', maxHeight: '340px', width: '320px' }}>
                <div className="px-2 py-2" style={{ borderBottom: '1px solid rgba(205,162,116,0.08)' }}>
                  <input ref={jobSearchRef} type="text" placeholder="Type to search projects..." value={jobSearch} onChange={(e) => setJobSearch(e.target.value)} autoFocus className="w-full px-2 py-1.5 rounded text-xs outline-none" style={{ background: '#242424', color: '#e8e0d8', border: '1px solid rgba(205,162,116,0.15)' }} />
                </div>
                <button onClick={() => { setSelectedJob(null); setShowJobDropdown(false); setJobSearch(''); }} className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-[#242424]" style={{ color: '#8a8078', borderBottom: '1px solid rgba(205,162,116,0.08)' }}>
                  No project selected (search all)
                </button>
                <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
                  {jobsLoading ? (
                    <div className="px-3 py-4 text-xs text-center" style={{ color: '#8a8078' }}><Loader2 size={14} className="animate-spin inline mr-2" />Loading projects...</div>
                  ) : jobs.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-center" style={{ color: '#8a8078' }}>No active projects found</div>
                  ) : (() => {
                    const q = jobSearch.toLowerCase().trim();
                    const filtered = q ? jobs.filter(j => j.name.toLowerCase().includes(q) || j.number.includes(q) || j.clientName.toLowerCase().includes(q)) : jobs;
                    if (!filtered.length) return <div className="px-3 py-4 text-xs text-center" style={{ color: '#8a8078' }}>No projects match &ldquo;{jobSearch}&rdquo;</div>;
                    return filtered.map(job => (
                      <button key={job.id} onClick={() => { setSelectedJob(job); setShowJobDropdown(false); setJobSearch(''); }} className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-[#242424] flex flex-col" style={{ color: selectedJob?.id === job.id ? '#C9A84C' : '#e8e0d8', background: selectedJob?.id === job.id ? 'rgba(201,168,76,0.06)' : 'transparent' }}>
                        <span className="font-medium">#{job.number} {job.name}</span>
                        {job.clientName && <span style={{ color: '#8a8078', fontSize: '10px' }}>{job.clientName}</span>}
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
          <button onClick={() => switchAgent('know-it-all')} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all" style={agentMode === 'know-it-all' ? { background: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.4)', boxShadow: '0 0 12px rgba(201,168,76,0.1)' } : { background: '#242424', color: '#8a8078', border: '1px solid rgba(205,162,116,0.12)' }}>
            <Brain size={16} /> Know-it-All
          </button>
          <button onClick={() => switchAgent('project-details')} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all" style={agentMode === 'project-details' ? { background: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.4)', boxShadow: '0 0 12px rgba(201,168,76,0.1)' } : { background: '#242424', color: '#8a8078', border: '1px solid rgba(205,162,116,0.12)' }}>
            <FileSearch size={16} /> Project Specs
          </button>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 rounded-lg" style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}>
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'rgba(201,168,76,0.1)' }}>
                {agentMode === 'know-it-all' ? <Brain size={28} style={{ color: '#C9A84C' }} /> : <FileSearch size={28} style={{ color: '#C9A84C' }} />}
              </div>
              <h2 className="text-lg font-bold mb-2" style={{ color: '#C9A84C' }}>{agentMode === 'know-it-all' ? 'BKB Project Assistant' : 'Project Specifications'}</h2>
              <p className="text-sm max-w-md text-center mb-6" style={{ color: '#8a8078' }}>
                {agentMode === 'know-it-all' ? 'I can search JobTread and GHL to answer questions, create tasks, manage schedules, and more.' : 'I pull specifications directly from the project\'s Specifications URL. Select a project and ask about materials, finishes, or selections.'}
                {selectedJob && <span style={{ color: '#C9A84C' }}>{' '}Currently focused on <strong>#{selectedJob.number} {selectedJob.name}</strong>.</span>}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
                {suggestions.map(s => (
                  <button key={s} onClick={() => setQuery(s)} className="text-left px-3 py-2 rounded-lg text-xs transition-colors hover:border-opacity-30" style={{ background: '#1a1a1a', color: '#8a8078', border: '1px solid rgba(205,162,116,0.08)' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i}>
              <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1" style={{ background: 'rgba(201,168,76,0.15)' }}>
                    <Bot size={14} style={{ color: '#C9A84C' }} />
                  </div>
                )}
                <div className="flex flex-col max-w-[80%]">
                  {msg.role === 'assistant' && msg.agent && (
                    <span className="text-[10px] mb-1 px-1.5 py-0.5 rounded w-fit" style={{ color: '#C9A84C', background: 'rgba(201,168,76,0.08)' }}>{msg.agent}</span>
                  )}
                  <div className="px-4 py-3 rounded-lg text-sm leading-relaxed" style={msg.role === 'user' ? { background: '#1B3A5C', color: '#e8e0d8' } : { background: '#242424', color: '#e8e0d8', border: '1px solid rgba(205,162,116,0.08)' }}>
                    {msg.role === 'assistant' ? <RenderContent content={msg.content} /> : msg.content}
                  </div>
                </div>
                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1" style={{ background: 'rgba(27,58,92,0.3)' }}>
                    <User size={14} style={{ color: '#e8e0d8' }} />
                  </div>
                )}
              </div>

              {msg.needsConfirmation && i === messages.length - 1 && !loading && (
                <div className="ml-9">
                  {msg.taskConfirm && <TaskConfirmCard data={msg.taskConfirm} onPhaseChange={(phase) => setPhaseEdit(phase)} />}
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => { handleConfirm(phaseEdit ? { phase: phaseEdit } : undefined); setPhaseEdit(null); }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110" style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff', boxShadow: '0 2px 8px rgba(34,197,94,0.3)' }}>
                      <CheckCircle size={16} /> Approve
                    </button>
                    <button onClick={() => { handleDecline(); setPhaseEdit(null); }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110" style={{ background: '#3a2a2a', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}>
                      <XCircle size={16} /> Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(201,168,76,0.15)' }}>
                <Bot size={14} style={{ color: '#C9A84C' }} />
              </div>
              <div className="px-4 py-3 rounded-lg flex items-center gap-2" style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)' }}>
                <Loader2 size={16} className="animate-spin" style={{ color: '#C9A84C' }} />
                <span className="text-xs" style={{ color: '#8a8078' }}>{agentMode === 'project-details' ? 'Reading specifications...' : 'Searching your data...'}</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="relative">
          {selectedJob && (
            <div className="absolute -top-6 left-0 text-[10px] px-2 py-0.5 rounded-t" style={{ color: '#C9A84C', background: 'rgba(201,168,76,0.08)' }}>
              Focused: #{selectedJob.number} {selectedJob.name}
            </div>
          )}

          {uploadedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 py-2 rounded-t-lg" style={{ background: '#242424', borderTop: '1px solid rgba(205,162,116,0.12)', borderLeft: '1px solid rgba(205,162,116,0.12)', borderRight: '1px solid rgba(205,162,116,0.12)' }}>
              {uploadedFiles.map((file, idx) => (
                <div key={`${file.name}-${idx}`} className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px]" style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                  {file.extracting ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                  <span className="max-w-[150px] truncate">{file.name}</span>
                  {file.extracting ? <span style={{ color: '#8a8078' }}>Extracting...</span> : (
                    <button type="button" onClick={() => removeFile(file.name)} className="hover:brightness-150"><X size={12} /></button>
                  )}
                </div>
              ))}
            </div>
          )}

          <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md" multiple onChange={handleFileSelect} className="hidden" />

          <div className="relative">
            <textarea
              value={query}
              onChange={(e) => { setQuery(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) handleSubmit(e as any); } }}
              placeholder={agentMode === 'project-details' ? (selectedJob ? `Ask about specs for #${selectedJob.number} ${selectedJob.name}...` : 'Select a project, then ask about specifications...') : (selectedJob ? `Ask about #${selectedJob.number} ${selectedJob.name}...` : 'Ask about any project, create tasks, or check schedules...')}
              rows={1}
              className="w-full pl-10 pr-12 py-3 text-sm outline-none resize-none"
              style={{ background: '#242424', color: '#e8e0d8', border: selectedJob ? '1px solid rgba(201,168,76,0.25)' : '1px solid rgba(205,162,116,0.12)', borderRadius: uploadedFiles.length > 0 ? '0 0 0.5rem 0.5rem' : '0.5rem', minHeight: '44px', maxHeight: '160px', overflowY: 'auto' }}
              disabled={loading}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded transition-colors hover:bg-white/5" style={{ color: uploadedFiles.length > 0 ? '#C9A84C' : '#8a8078' }} title="Attach PDF, TXT, or MD file">
              <Paperclip size={16} />
            </button>
            <button type="submit" disabled={!canSend} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors" style={{ color: canSend ? '#C9A84C' : '#8a8078', background: canSend ? 'rgba(201,168,76,0.1)' : 'transparent' }}>
              <Send size={18} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

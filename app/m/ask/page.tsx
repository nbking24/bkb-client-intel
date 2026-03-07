// @ts-nocheck
'use client';

import { useState, useRef } from 'react';
import {
  Send, Loader2, Bot, User, CheckCircle, XCircle,
  Brain, FileSearch, Paperclip, X, FileText, Plus, Clock, Trash2,
  RefreshCw, Menu, ChevronDown, ArrowLeft,
} from 'lucide-react';
import {
  useAskAgent, formatContent, formatTimeAgo, getSuggestions,
  type TaskConfirmData,
} from '@/app/hooks/useAskAgent';

/* ── Render formatted elements to JSX (mobile sizing) ── */
function RenderContent({ content }: { content: string }) {
  const elements = formatContent(content);
  return (
    <>
      {elements.map((el: any) => {
        if (el.type === 'code') {
          return (
            <div key={el.key} className="relative mt-2 mb-2 rounded-lg overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)' }}>
              <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid rgba(205,162,116,0.1)', background: 'rgba(205,162,116,0.04)' }}>
                <span className="text-[10px] font-medium" style={{ color: '#8a8078' }}>Markdown</span>
                <button onClick={() => navigator.clipboard.writeText(el.content)} className="text-[10px] px-2 py-0.5 rounded" style={{ color: '#C9A84C', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)' }}>Copy</button>
              </div>
              <pre className="px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap" style={{ color: '#c8c0b8', fontFamily: 'ui-monospace, SFMono-Regular, monospace', lineHeight: '1.5' }}>{el.content}</pre>
            </div>
          );
        }
        if (el.type === 'h2') return <div key={el.key} className="font-bold mt-3 mb-1" style={{ color: '#C9A84C', fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'h3') return <div key={el.key} className="font-semibold mt-2 mb-0.5" style={{ color: '#e8e0d8', fontSize: '0.8rem' }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'bullet') return <div key={el.key} className="ml-2" dangerouslySetInnerHTML={{ __html: '&bull; ' + el.html }} />;
        if (el.type === 'numbered') return <div key={el.key} className="ml-2" dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'hr') return <hr key={el.key} className="my-2" style={{ borderColor: 'rgba(205,162,116,0.15)' }} />;
        if (el.type === 'spacer') return <div key={el.key} className="h-1.5" />;
        return <div key={el.key} dangerouslySetInnerHTML={{ __html: el.html }} />;
      })}
    </>
  );
}

const BKB_PHASES = [
  'Admin Tasks', 'Conceptual Design', 'Design Development', 'Contract',
  'Preconstruction', 'In Production', 'Inspections', 'Punch/Closeout', 'Project Completion',
];

/* ── Task Confirmation Card (mobile, editable phase) ── */
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
    <div className="mt-2 rounded-xl" style={{ background: '#1a1a1a', border: '1px solid rgba(201,168,76,0.25)' }}>
      <div className="px-3 py-1.5 flex items-center gap-2 rounded-t-xl" style={{ background: 'rgba(201,168,76,0.08)', borderBottom: '1px solid rgba(201,168,76,0.15)' }}>
        <span className="text-[11px] font-semibold" style={{ color: '#C9A84C' }}>Task Preview</span>
        {phaseChanged && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)' }}>Phase edited</span>}
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {data.name && (
          <div><span className="text-[10px] font-medium" style={{ color: '#8a8078' }}>Name: </span><span className="text-[13px] font-medium" style={{ color: '#e8e0d8' }}>{data.name}</span></div>
        )}
        <div className="relative">
          <span className="text-[10px] font-medium" style={{ color: '#8a8078' }}>Phase: </span>
          <button onClick={() => setEditingPhase(!editingPhase)} className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors active:brightness-125" style={{ color: phaseChanged ? '#22c55e' : '#C9A84C', background: phaseChanged ? 'rgba(34,197,94,0.1)' : 'rgba(201,168,76,0.1)', border: '1px solid ' + (phaseChanged ? 'rgba(34,197,94,0.2)' : 'rgba(201,168,76,0.2)'), cursor: 'pointer' }}>
            {displayPhase} <ChevronDown size={10} className={`transition-transform ${editingPhase ? 'rotate-180' : ''}`} />
          </button>
          {editingPhase && (
            <div className="absolute left-0 top-full mt-1 z-50 rounded-xl shadow-lg" style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.2)', minWidth: '200px', maxHeight: '280px', overflowY: 'auto' }}>
              {BKB_PHASES.map(phase => (
                <button key={phase} onClick={() => handlePhaseSelect(phase)} className="w-full text-left px-3 py-2 text-xs transition-colors active:bg-white/5" style={{ color: phase === displayPhase ? '#C9A84C' : '#e8e0d8', background: phase === displayPhase ? 'rgba(201,168,76,0.08)' : 'transparent' }}>
                  {phase}
                </button>
              ))}
            </div>
          )}
        </div>
        {data.assignee && (
          <div><span className="text-[10px] font-medium" style={{ color: '#8a8078' }}>Assignee: </span><span className="text-xs" style={{ color: '#e8e0d8' }}>{data.assignee}</span></div>
        )}
        {(data.startDate || data.endDate) && (
          <div><span className="text-[10px] font-medium" style={{ color: '#8a8078' }}>Due: </span><span className="text-xs" style={{ color: '#e8e0d8' }}>{data.endDate || data.startDate}</span></div>
        )}
        {data.description && (
          <div className="pt-0.5"><span className="text-[10px] font-medium" style={{ color: '#8a8078' }}>Details: </span><span className="text-xs leading-relaxed" style={{ color: '#c8c0b8' }}>{data.description}</span></div>
        )}
      </div>
    </div>
  );
}

export default function MobileAskAgentPage() {
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
    canSend,
  } = useAskAgent();

  // Mobile-specific state
  const [showDrawer, setShowDrawer] = useState(false);
  const [showJobPicker, setShowJobPicker] = useState(false);
  const [phaseEdit, setPhaseEdit] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = getSuggestions(agentMode);

  const handleLoadConv = async (convId: string) => {
    await loadConversation(convId);
    setShowDrawer(false);
  };

  const handleNewChat = () => {
    startNewChat();
    setShowDrawer(false);
  };

  const handleDeleteConv = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteConversation(convId);
  };

  return (
    <div className="flex flex-col h-[100dvh] relative" style={{ background: '#111', color: '#e8e0d8' }}>

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0" style={{ background: '#1a1a1a', borderBottom: '1px solid rgba(205,162,116,0.1)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => setShowDrawer(true)} className="p-2 -ml-1 rounded-lg active:bg-white/5" style={{ color: '#8a8078' }}>
            <Menu size={20} />
          </button>
          <h1 className="text-base font-bold truncate" style={{ fontFamily: 'Georgia, serif', color: '#C9A84C' }}>Ask Agent</h1>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {syncResult && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.08)' }}>{syncResult}</span>}
          <button onClick={forceSync} disabled={syncing} className="p-2 rounded-lg active:bg-white/5" style={{ color: syncing ? '#C9A84C' : '#8a8078' }}>
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          </button>
          <button onClick={handleNewChat} className="p-2 rounded-lg active:bg-white/5" style={{ color: '#C9A84C' }}>
            <Plus size={18} />
          </button>
        </div>
      </div>

      {/* ── Agent mode + Job selector ── */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0 overflow-x-auto" style={{ borderBottom: '1px solid rgba(205,162,116,0.06)' }}>
        <button onClick={() => switchAgent('know-it-all')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0"
          style={agentMode === 'know-it-all' ? { background: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.4)' } : { background: '#242424', color: '#8a8078', border: '1px solid rgba(205,162,116,0.12)' }}>
          <Brain size={13} /> Know-it-All
        </button>
        <button onClick={() => switchAgent('project-details')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0"
          style={agentMode === 'project-details' ? { background: 'rgba(201,168,76,0.15)', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.4)' } : { background: '#242424', color: '#8a8078', border: '1px solid rgba(205,162,116,0.12)' }}>
          <FileSearch size={13} /> Specs
        </button>
        <div className="h-4 w-px flex-shrink-0" style={{ background: 'rgba(205,162,116,0.12)' }} />
        <button onClick={() => setShowJobPicker(true)} className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs whitespace-nowrap flex-shrink-0"
          style={{ background: selectedJob ? 'rgba(201,168,76,0.1)' : '#242424', color: selectedJob ? '#C9A84C' : '#8a8078', border: selectedJob ? '1px solid rgba(201,168,76,0.25)' : '1px solid rgba(205,162,116,0.12)', maxWidth: '160px' }}>
          <span className="truncate">{selectedJob ? `#${selectedJob.number} ${selectedJob.name}` : 'Select project'}</span>
          <ChevronDown size={12} className="flex-shrink-0" />
        </button>
      </div>

      {/* ── Messages area ── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: 'rgba(201,168,76,0.1)' }}>
              {agentMode === 'know-it-all' ? <Brain size={24} style={{ color: '#C9A84C' }} /> : <FileSearch size={24} style={{ color: '#C9A84C' }} />}
            </div>
            <h2 className="text-base font-bold mb-1" style={{ color: '#C9A84C' }}>{agentMode === 'know-it-all' ? 'BKB Assistant' : 'Project Specs'}</h2>
            <p className="text-xs text-center mb-5 max-w-xs" style={{ color: '#8a8078' }}>
              {agentMode === 'know-it-all' ? 'Search JobTread, create tasks, manage schedules.' : 'Ask about project specifications and selections.'}
              {selectedJob && <span style={{ color: '#C9A84C' }}>{' '}Focused on #{selectedJob.number}.</span>}
            </p>
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
              {suggestions.map(s => (
                <button key={s} onClick={() => setQuery(s)} className="text-left px-3 py-2.5 rounded-lg text-xs active:brightness-110" style={{ background: '#1a1a1a', color: '#8a8078', border: '1px solid rgba(205,162,116,0.08)' }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-1" style={{ background: 'rgba(201,168,76,0.15)' }}>
                  <Bot size={12} style={{ color: '#C9A84C' }} />
                </div>
              )}
              <div className={`flex flex-col ${msg.role === 'user' ? 'max-w-[85%]' : 'max-w-[90%]'}`}>
                {msg.role === 'assistant' && msg.agent && (
                  <span className="text-[9px] mb-0.5 px-1.5 py-0.5 rounded w-fit" style={{ color: '#C9A84C', background: 'rgba(201,168,76,0.08)' }}>{msg.agent}</span>
                )}
                <div className="px-3 py-2.5 rounded-2xl text-[13px] leading-relaxed"
                  style={msg.role === 'user' ? { background: '#1B3A5C', color: '#e8e0d8', borderBottomRightRadius: '4px' } : { background: '#242424', color: '#e8e0d8', border: '1px solid rgba(205,162,116,0.08)', borderBottomLeftRadius: '4px' }}>
                  {msg.role === 'assistant' ? <RenderContent content={msg.content} /> : (
                    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {msg.content.includes('--- ATTACHED DOCUMENT:') ? msg.content.split('\n\n--- ATTACHED DOCUMENT:')[0] : msg.content}
                    </span>
                  )}
                </div>
              </div>
              {msg.role === 'user' && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-1" style={{ background: 'rgba(27,58,92,0.3)' }}>
                  <User size={12} style={{ color: '#e8e0d8' }} />
                </div>
              )}
            </div>

            {msg.needsConfirmation && i === messages.length - 1 && !loading && (
              <div className="ml-8">
                {msg.taskConfirm && <TaskConfirmCard data={msg.taskConfirm} onPhaseChange={(phase) => setPhaseEdit(phase)} />}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => { handleConfirm(phaseEdit ? { phase: phaseEdit } : undefined); setPhaseEdit(null); }} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium active:brightness-110"
                    style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff', boxShadow: '0 2px 8px rgba(34,197,94,0.3)' }}>
                    <CheckCircle size={16} /> Approve
                  </button>
                  <button onClick={() => { handleDecline(); setPhaseEdit(null); }} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium active:brightness-110"
                    style={{ background: '#3a2a2a', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}>
                    <XCircle size={16} /> Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(201,168,76,0.15)' }}>
              <Bot size={12} style={{ color: '#C9A84C' }} />
            </div>
            <div className="px-3 py-2.5 rounded-2xl flex items-center gap-2" style={{ background: '#242424', border: '1px solid rgba(205,162,116,0.08)', borderBottomLeftRadius: '4px' }}>
              <Loader2 size={14} className="animate-spin" style={{ color: '#C9A84C' }} />
              <span className="text-xs" style={{ color: '#8a8078' }}>{agentMode === 'project-details' ? 'Reading specs...' : 'Searching...'}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area (sticky bottom) ── */}
      <div className="flex-shrink-0 px-3 pb-[env(safe-area-inset-bottom,8px)] pt-2" style={{ background: '#111', borderTop: '1px solid rgba(205,162,116,0.1)' }}>
        {uploadedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {uploadedFiles.map((file, idx) => (
              <div key={`${file.name}-${idx}`} className="flex items-center gap-1 px-2 py-1 rounded text-[10px]" style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)', color: '#C9A84C' }}>
                {file.extracting ? <Loader2 size={10} className="animate-spin" /> : <FileText size={10} />}
                <span className="max-w-[100px] truncate">{file.name}</span>
                {file.extracting ? <span style={{ color: '#8a8078' }}>...</span> : <button type="button" onClick={() => removeFile(file.name)} className="active:brightness-150"><X size={10} /></button>}
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md" multiple onChange={handleFileSelect} className="hidden" />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2.5 rounded-xl flex-shrink-0 active:bg-white/5" style={{ color: uploadedFiles.length > 0 ? '#C9A84C' : '#8a8078' }}>
            <Paperclip size={20} />
          </button>
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
              placeholder={agentMode === 'project-details' ? (selectedJob ? `Ask about #${selectedJob.number}...` : 'Select a project first...') : (selectedJob ? `Ask about #${selectedJob.number}...` : 'Ask anything...')}
              rows={1}
              className="w-full px-3 py-2.5 text-sm outline-none resize-none rounded-2xl"
              style={{ background: '#242424', color: '#e8e0d8', border: selectedJob ? '1px solid rgba(201,168,76,0.25)' : '1px solid rgba(205,162,116,0.12)', minHeight: '42px', maxHeight: '120px', overflowY: 'auto' }}
              disabled={loading}
            />
          </div>
          <button type="submit" disabled={!canSend} className="p-2.5 rounded-xl flex-shrink-0 active:brightness-110"
            style={{ color: canSend ? '#111' : '#8a8078', background: canSend ? '#C9A84C' : 'transparent' }}>
            <Send size={20} />
          </button>
        </form>
        {selectedJob && <div className="text-[10px] text-center mt-1.5 pb-0.5" style={{ color: 'rgba(201,168,76,0.5)' }}>#{selectedJob.number} {selectedJob.name}</div>}
      </div>

      {/* ── Conversations Drawer ── */}
      {showDrawer && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowDrawer(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-[280px] flex flex-col" style={{ background: '#1a1a1a', boxShadow: '4px 0 24px rgba(0,0,0,0.5)' }}>
            <div className="flex items-center justify-between px-3 py-3" style={{ borderBottom: '1px solid rgba(205,162,116,0.1)' }}>
              <span className="text-sm font-bold" style={{ color: '#C9A84C' }}>Conversations</span>
              <button onClick={() => setShowDrawer(false)} className="p-2 rounded-lg active:bg-white/5" style={{ color: '#8a8078' }}><ArrowLeft size={18} /></button>
            </div>
            <button onClick={handleNewChat} className="flex items-center gap-2 mx-3 mt-3 px-3 py-2.5 rounded-lg text-sm font-medium active:brightness-110"
              style={{ background: 'linear-gradient(135deg, rgba(201,168,76,0.2), rgba(201,168,76,0.1))', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.3)' }}>
              <Plus size={16} /> New Conversation
            </button>
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1" style={{ WebkitOverflowScrolling: 'touch' }}>
              {convsLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 size={16} className="animate-spin" style={{ color: '#8a8078' }} /></div>
              ) : conversations.length === 0 ? (
                <div className="text-center py-8 text-xs" style={{ color: '#8a8078' }}>No conversations yet</div>
              ) : conversations.map(conv => (
                <button key={conv.id} onClick={() => handleLoadConv(conv.id)} className="group w-full text-left px-3 py-2.5 rounded-lg transition-colors active:bg-white/5 flex flex-col relative"
                  style={{ background: conversationId === conv.id ? 'rgba(201,168,76,0.08)' : 'transparent', borderLeft: conversationId === conv.id ? '2px solid #C9A84C' : '2px solid transparent' }}>
                  <span className="text-xs font-medium truncate w-full pr-8" style={{ color: conversationId === conv.id ? '#C9A84C' : '#e8e0d8' }}>{conv.title}</span>
                  <span className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: '#8a8078' }}>
                    <Clock size={9} />{formatTimeAgo(conv.updated_at)}
                    {conv.jt_job_name && <span className="truncate ml-1" style={{ color: 'rgba(201,168,76,0.5)' }}>{conv.jt_job_name}</span>}
                  </span>
                  <div className="absolute right-1 top-1/2 -translate-y-1/2">
                    <button onClick={(e) => handleDeleteConv(conv.id, e)} className="p-1.5 rounded active:bg-red-500/10" style={{ color: '#8a8078' }}><Trash2 size={14} /></button>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Job Picker Modal ── */}
      {showJobPicker && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => { setShowJobPicker(false); setJobSearch(''); }} />
          <div className="fixed inset-x-4 top-[15%] z-50 rounded-xl overflow-hidden max-h-[70vh] flex flex-col" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
            <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(205,162,116,0.1)' }}>
              <div className="text-sm font-bold mb-2" style={{ color: '#C9A84C' }}>Select Project</div>
              <input type="text" placeholder="Search projects..." value={jobSearch} onChange={(e) => setJobSearch(e.target.value)} autoFocus className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ background: '#242424', color: '#e8e0d8', border: '1px solid rgba(205,162,116,0.15)' }} />
            </div>
            <button onClick={() => { setSelectedJob(null); setShowJobPicker(false); setJobSearch(''); }} className="w-full text-left px-4 py-3 text-sm active:bg-[#242424]" style={{ color: '#8a8078', borderBottom: '1px solid rgba(205,162,116,0.08)' }}>No project (search all)</button>
            <div className="overflow-y-auto flex-1" style={{ WebkitOverflowScrolling: 'touch' }}>
              {jobsLoading ? (
                <div className="px-4 py-6 text-sm text-center" style={{ color: '#8a8078' }}><Loader2 size={16} className="animate-spin inline mr-2" />Loading...</div>
              ) : (() => {
                const q = jobSearch.toLowerCase().trim();
                const filtered = q ? jobs.filter(j => j.name.toLowerCase().includes(q) || j.number.includes(q) || j.clientName.toLowerCase().includes(q)) : jobs;
                if (!filtered.length) return <div className="px-4 py-6 text-sm text-center" style={{ color: '#8a8078' }}>No match</div>;
                return filtered.map(job => (
                  <button key={job.id} onClick={() => { setSelectedJob(job); setShowJobPicker(false); setJobSearch(''); }} className="w-full text-left px-4 py-3 text-sm active:bg-[#242424] flex flex-col"
                    style={{ color: selectedJob?.id === job.id ? '#C9A84C' : '#e8e0d8', background: selectedJob?.id === job.id ? 'rgba(201,168,76,0.06)' : 'transparent' }}>
                    <span className="font-medium">#{job.number} {job.name}</span>
                    {job.clientName && <span style={{ color: '#8a8078', fontSize: '11px' }}>{job.clientName}</span>}
                  </button>
                ));
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

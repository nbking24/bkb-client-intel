// @ts-nocheck
'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Calculator, Send, Loader2, Bot, User, ChevronDown, ChevronRight,
  Plus, DollarSign, Package, Hammer, FileText, CheckCircle2,
  AlertCircle, Upload, X, Paperclip, ClipboardPaste,
} from 'lucide-react';
import {
  getAuthToken, formatContent, type ChatMessage, type JobOption,
} from '@/app/hooks/useAskAgent';

/* ── Types ── */
interface BudgetLineItem {
  name: string;
  description: string;
  costCodeNumber: string;
  costTypeName: string;
  unitName: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  groupName: string;
  groupDescription: string;
  organizationCostItemId?: string;
}

interface ProposedBudget {
  estimateType: 'initial' | 'change-order';
  changeOrderName?: string;
  areaName: string;
  lineItems: BudgetLineItem[];
  totalCost: number;
  totalPrice: number;
  optionNumber?: number;
  optionLabel?: string;
}

interface UploadedFile {
  name: string;
  type: string;
  content: string; // extracted text (PDFs go through /api/extract-pdf; txt/csv read directly)
  size: number;
  extracting?: boolean; // true while PDF extraction is in flight
}

interface StructuredQuestion {
  id: string;
  question: string;
  options: string[];
  allowCustom: boolean;
}

interface QuestionAnswers {
  [questionId: string]: { selected: string | null; custom: string };
}

type EstimateType = 'initial' | 'change-order';

/* ── Style constants ── */
const CARD = { background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.12)' };
const GOLD = '#c88c00';
const TEXT = '#1a1a1a';
const TEXT_MUTED = '#8a8078';
const DARK_BG = '#ffffff';

const CODE_COLORS: Record<string, string> = {
  '01': '#6366f1', '02': '#ef4444', '03': '#78716c', '04': '#f59e0b',
  '05': '#3b82f6', '06': '#10b981', '08': '#dc2626', '09': '#f97316',
  '10': '#0ea5e9', '11': '#14b8a6', '12': '#eab308', '13': '#a3a3a3',
  '14': '#8b5cf6', '15': '#ec4899', '16': '#06b6d4', '17': '#f43f5e',
  '18': '#84cc16', '19': '#a78bfa', '20': '#22d3ee', '22': '#d946ef',
  '23': '#fbbf24',
};

/* ── Render formatted content ── */
function RenderContent({ content }: { content: string }) {
  const elements = formatContent(content);
  return (
    <>
      {elements.map((el: any) => {
        if (el.type === 'code') {
          return (
            <div key={el.key} className="mt-2 mb-2 rounded-lg" style={{ background: DARK_BG, border: '1px solid rgba(200,140,0,0.15)' }}>
              <pre className="px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap" style={{ color: '#3a3530', fontFamily: 'monospace', lineHeight: '1.5' }}>{el.content}</pre>
            </div>
          );
        }
        if (el.type === 'h2') return <div key={el.key} className="font-bold mt-3 mb-1" style={{ color: GOLD, fontSize: '0.9rem' }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'h3') return <div key={el.key} className="font-semibold mt-2 mb-0.5" style={{ color: TEXT, fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'bullet') return <div key={el.key} className="ml-3 text-sm" dangerouslySetInnerHTML={{ __html: '&bull; ' + el.html }} />;
        if (el.type === 'numbered') return <div key={el.key} className="ml-3 text-sm" dangerouslySetInnerHTML={{ __html: el.html }} />;
        if (el.type === 'hr') return <hr key={el.key} className="my-3" style={{ borderColor: 'rgba(200,140,0,0.15)' }} />;
        if (el.type === 'spacer') return <div key={el.key} className="h-1.5" />;
        return <div key={el.key} className="text-sm" dangerouslySetInnerHTML={{ __html: el.html }} />;
      })}
    </>
  );
}

/* ── Budget Tree View ── */
function BudgetPreview({ budget }: { budget: ProposedBudget | null }) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Auto-expand all groups when budget changes — must be before any early return
  useEffect(() => {
    if (!budget || budget.lineItems.length === 0) return;
    const tree = new Map<string, boolean>();
    for (const item of budget.lineItems) {
      tree.set(item.groupName, true);
    }
    setExpandedGroups(new Set(tree.keys()));
  }, [budget]);

  if (!budget || budget.lineItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full opacity-40 px-4">
        <Package size={40} style={{ color: TEXT_MUTED }} />
        <p className="mt-3 text-sm text-center" style={{ color: TEXT_MUTED }}>
          Budget preview will appear here once the AI develops a proposal
        </p>
      </div>
    );
  }

  // Build tree from flat items
  const tree = new Map<string, { description: string; items: BudgetLineItem[] }>();
  for (const item of budget.lineItems) {
    const key = item.groupName;
    if (!tree.has(key)) {
      tree.set(key, { description: item.groupDescription, items: [] });
    }
    tree.get(key)!.items.push(item);
  }

  const sortedGroups = [...tree.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const toggleGroup = (path: string) => {
    const next = new Set(expandedGroups);
    next.has(path) ? next.delete(path) : next.add(path);
    setExpandedGroups(next);
  };

  return (
    <div className="space-y-1">
      {/* Summary header */}
      <div className="px-3 py-2 rounded-lg mb-2" style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)' }}>
        <div className="flex justify-between items-center">
          <span className="text-xs font-semibold" style={{ color: GOLD }}>
            {budget.estimateType === 'change-order' ? 'Change Order' : 'Estimate'} Preview
          </span>
          <span className="text-xs" style={{ color: TEXT_MUTED }}>
            {budget.lineItems.length} items
          </span>
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs" style={{ color: TEXT_MUTED }}>Total Cost</span>
          <span className="text-xs font-medium" style={{ color: TEXT }}>
            ${budget.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs" style={{ color: TEXT_MUTED }}>Total Price</span>
          <span className="text-xs font-bold" style={{ color: GOLD }}>
            ${budget.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs" style={{ color: TEXT_MUTED }}>Margin</span>
          <span className="text-xs font-medium" style={{ color: '#22c55e' }}>
            ${(budget.totalPrice - budget.totalCost).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            {' '}({budget.totalPrice > 0 ? ((1 - budget.totalCost / budget.totalPrice) * 100).toFixed(1) : 0}%)
          </span>
        </div>
      </div>

      {/* Groups */}
      {sortedGroups.map(([path, group]) => {
        const parts = path.split(' > ');
        const depth = parts.length - 1;
        const groupLabel = parts[parts.length - 1];
        const isExpanded = expandedGroups.has(path);
        const groupPrice = group.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

        return (
          <div key={path}>
            <button
              onClick={() => toggleGroup(path)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-black/5 transition-colors"
              style={{ paddingLeft: `${8 + depth * 12}px` }}
            >
              {isExpanded ? <ChevronDown size={12} style={{ color: TEXT_MUTED }} /> : <ChevronRight size={12} style={{ color: TEXT_MUTED }} />}
              <span className="text-xs font-medium truncate flex-1 text-left" style={{ color: TEXT }}>
                {groupLabel}
              </span>
              <span className="text-[10px] tabular-nums" style={{ color: GOLD }}>
                ${groupPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </button>

            {isExpanded && group.items.map((item, idx) => {
              const codeColor = CODE_COLORS[item.costCodeNumber] || TEXT_MUTED;
              return (
                <div
                  key={`${path}-${idx}`}
                  className="flex items-start gap-2 px-2 py-1 ml-4 rounded"
                  style={{ paddingLeft: `${16 + depth * 12}px` }}
                >
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: codeColor }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-[11px] truncate" style={{ color: TEXT }}>{item.name}</span>
                      <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: TEXT_MUTED }}>
                        ${(item.quantity * item.unitPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="text-[10px]" style={{ color: TEXT_MUTED }}>
                      {item.quantity} {item.unitName} @ ${item.unitCost}/{item.unitPrice}
                      <span className="ml-2 opacity-60">{item.costTypeName}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ── Question Picker UI ── */
function QuestionPicker({
  questions,
  answers,
  onAnswer,
  onSubmit,
  submitting,
}: {
  questions: StructuredQuestion[];
  answers: QuestionAnswers;
  onAnswer: (qId: string, selected: string | null, custom: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const allAnswered = questions.every((q) => {
    const a = answers[q.id];
    return a && (a.selected || a.custom.trim());
  });

  return (
    <div className="space-y-3 w-full max-w-[85%]">
      <div className="flex items-center gap-2 mb-1">
        <Bot size={14} style={{ color: GOLD }} />
        <span className="text-xs font-medium" style={{ color: GOLD }}>A few questions before I build your estimate:</span>
      </div>

      {questions.map((q) => {
        const a = answers[q.id] || { selected: null, custom: '' };
        const isCustomActive = a.selected === '__custom__';

        return (
          <div
            key={q.id}
            className="rounded-lg px-3 py-2.5"
            style={{ background: '#f8f6f3', border: '1px solid rgba(200,140,0,0.1)' }}
          >
            <p className="text-xs font-medium mb-2" style={{ color: TEXT }}>{q.question}</p>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => onAnswer(q.id, opt, '')}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
                  style={{
                    background: a.selected === opt ? 'rgba(201,168,76,0.2)' : 'rgba(255,255,255,0.04)',
                    color: a.selected === opt ? GOLD : TEXT_MUTED,
                    border: `1px solid ${a.selected === opt ? 'rgba(201,168,76,0.4)' : 'rgba(200,140,0,0.1)'}`,
                  }}
                >
                  {a.selected === opt && <span className="mr-1">✓</span>}
                  {opt}
                </button>
              ))}
              {q.allowCustom && (
                <button
                  onClick={() => onAnswer(q.id, '__custom__', a.custom)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
                  style={{
                    background: isCustomActive ? 'rgba(201,168,76,0.2)' : 'rgba(255,255,255,0.04)',
                    color: isCustomActive ? GOLD : TEXT_MUTED,
                    border: `1px solid ${isCustomActive ? 'rgba(201,168,76,0.4)' : 'rgba(200,140,0,0.1)'}`,
                  }}
                >
                  ✏️ Other
                </button>
              )}
            </div>
            {isCustomActive && (
              <input
                type="text"
                value={a.custom}
                onChange={(e) => onAnswer(q.id, '__custom__', e.target.value)}
                placeholder="Type your answer..."
                autoFocus
                className="w-full mt-2 px-2.5 py-1.5 rounded-lg text-xs outline-none"
                style={{ background: DARK_BG, color: TEXT, border: '1px solid rgba(201,168,76,0.2)' }}
              />
            )}
          </div>
        );
      })}

      <button
        onClick={onSubmit}
        disabled={!allAnswered || submitting}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-30"
        style={{
          background: allAnswered ? 'rgba(201,168,76,0.15)' : 'transparent',
          color: allAnswered ? GOLD : TEXT_MUTED,
          border: `1px solid ${allAnswered ? 'rgba(201,168,76,0.3)' : 'rgba(200,140,0,0.08)'}`,
        }}
      >
        {submitting ? (
          <><Loader2 size={14} className="animate-spin" /> Sending Answers...</>
        ) : (
          <><Send size={14} /> Submit Answers</>
        )}
      </button>
    </div>
  );
}

/* ── Main Page ── */
export default function EstimatePage() {
  /* State */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobOption | null>(null);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobSearch, setJobSearch] = useState('');
  const [jobDropdownOpen, setJobDropdownOpen] = useState(false);
  const [estimateType, setEstimateType] = useState<EstimateType>('initial');
  const [changeOrderName, setChangeOrderName] = useState('');
  const [scopeText, setScopeText] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [quickEstimate, setQuickEstimate] = useState(false);
  const [proposedBudgets, setProposedBudgets] = useState<ProposedBudget[]>([]);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createResults, setCreateResults] = useState<Record<number, { success: boolean; message: string }>>({});
  const [pendingQuestions, setPendingQuestions] = useState<StructuredQuestion[] | null>(null);
  const [questionAnswers, setQuestionAnswers] = useState<QuestionAnswers>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Load jobs */
  useEffect(() => {
    async function fetchJobs() {
      try {
        const res = await fetch('/api/dashboard/projects', {
          headers: { Authorization: `Bearer ${getAuthToken()}` },
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

  /* Auto-scroll */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  /* Handle file upload — text files read directly, PDFs extracted via /api/extract-pdf */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (file.type === 'text/plain' || file.type === 'text/csv' || file.name.endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = () => {
          setUploadedFiles(prev => [...prev, {
            name: file.name,
            type: file.type || 'text/plain',
            content: reader.result as string,
            size: file.size,
          }]);
        };
        reader.readAsText(file);
      } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        // Placeholder while extraction is in flight so the chip shows immediately
        setUploadedFiles(prev => [...prev, {
          name: file.name, type: 'application/pdf', content: '', size: file.size, extracting: true,
        }]);

        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64 = (reader.result as string).split(',')[1] || '';
            const res = await fetch('/api/extract-pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
              body: JSON.stringify({ fileName: file.name, base64 }),
            });
            const data = await res.json();
            const extracted = (data.text && data.text.trim()) || '[PDF appeared empty — Claude could not read any text from it]';
            setUploadedFiles(prev => prev.map(f =>
              f.name === file.name && f.extracting
                ? { name: file.name, type: 'application/pdf', content: extracted, size: file.size, extracting: false }
                : f
            ));
          } catch {
            setUploadedFiles(prev => prev.map(f =>
              f.name === file.name && f.extracting
                ? { name: file.name, type: 'application/pdf', content: '[Error extracting PDF — please paste the content manually]', size: file.size, extracting: false }
                : f
            ));
          }
        };
        reader.readAsDataURL(file);
      } else {
        // Unsupported binary type — attach name only so user sees it didn't get ingested
        setUploadedFiles(prev => [...prev, {
          name: file.name, type: file.type, content: '[Unsupported file type — only .pdf, .txt, .csv are read]', size: file.size,
        }]);
      }
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (idx: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  /* Build initial message from scope + files */
  const buildScopeMessage = (): string => {
    const parts: string[] = [];

    if (scopeText.trim()) {
      parts.push(scopeText.trim());
    }

    // Include extracted text from uploaded files (PDFs already extracted via /api/extract-pdf)
    for (const file of uploadedFiles) {
      if (file.extracting) {
        // Defensive: submit should be disabled while extracting, but guard anyway
        parts.push(`\n[Attached: ${file.name} — still extracting, please wait]`);
      } else if (file.content) {
        parts.push(`\n--- Attached: ${file.name} ---\n${file.content}`);
      } else {
        parts.push(`\n[Attached file: ${file.name} (${(file.size / 1024).toFixed(0)} KB) — no content extracted]`);
      }
    }

    return parts.join('\n');
  };

  /* Submit scope as first message */
  const handleSubmitScope = async () => {
    const scopeMessage = buildScopeMessage();
    if (!scopeMessage.trim() || loading || !selectedJob) return;

    const userMsg: ChatMessage = { role: 'user', content: scopeMessage };
    const updatedMessages = [userMsg];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      const res = await fetch('/api/estimating', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          jobId: selectedJob.id,
          jobName: `#${selectedJob.number} ${selectedJob.name}`,
          estimateType,
          changeOrderName: estimateType === 'change-order' ? changeOrderName : undefined,
          quickEstimate,
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Request failed');
      }

      const data = await res.json();
      const assistantMsg: ChatMessage = { role: 'assistant', content: data.reply };
      setMessages([...updatedMessages, assistantMsg]);

      if (data.proposedBudgets && data.proposedBudgets.length > 0) {
        setProposedBudgets(data.proposedBudgets);
        setActiveOptionIndex(0);
        setCreateResults({});
      } else if (data.proposedBudget) {
        setProposedBudgets([data.proposedBudget]);
        setActiveOptionIndex(0);
        setCreateResults({});
      }

      // Check for structured questions
      if (data.structuredQuestions && data.structuredQuestions.length > 0) {
        setPendingQuestions(data.structuredQuestions);
        setQuestionAnswers({});
      } else {
        setPendingQuestions(null);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong';
      setMessages([...updatedMessages, { role: 'assistant', content: `Error: ${errMsg}` }]);
    } finally {
      setLoading(false);
    }
  };

  /* Handle question answer selection */
  const handleQuestionAnswer = (qId: string, selected: string | null, custom: string) => {
    setQuestionAnswers((prev) => ({
      ...prev,
      [qId]: { selected, custom },
    }));
  };

  /* Submit compiled answers from question pickers */
  const handleSubmitAnswers = async () => {
    if (!pendingQuestions || loading || !selectedJob) return;

    // Compile answers into a readable message
    const answerLines = pendingQuestions.map((q) => {
      const a = questionAnswers[q.id];
      if (!a) return `${q.question}: (no answer)`;
      const value = a.selected === '__custom__' ? a.custom.trim() : a.selected;
      return `${q.question}: ${value}`;
    });

    const compiledMessage = answerLines.join('\n');

    // Clear the pickers
    setPendingQuestions(null);
    setQuestionAnswers({});

    // Submit as a regular follow-up message
    const userMsg: ChatMessage = { role: 'user', content: compiledMessage };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      const res = await fetch('/api/estimating', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          jobId: selectedJob.id,
          jobName: `#${selectedJob.number} ${selectedJob.name}`,
          estimateType,
          changeOrderName: estimateType === 'change-order' ? changeOrderName : undefined,
          quickEstimate,
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Request failed');
      }

      const data = await res.json();
      const assistantMsg: ChatMessage = { role: 'assistant', content: data.reply };
      setMessages([...updatedMessages, assistantMsg]);

      if (data.proposedBudgets && data.proposedBudgets.length > 0) {
        setProposedBudgets(data.proposedBudgets);
        setActiveOptionIndex(0);
        setCreateResults({});
      } else if (data.proposedBudget) {
        setProposedBudgets([data.proposedBudget]);
        setActiveOptionIndex(0);
        setCreateResults({});
      }

      if (data.structuredQuestions && data.structuredQuestions.length > 0) {
        setPendingQuestions(data.structuredQuestions);
        setQuestionAnswers({});
      } else {
        setPendingQuestions(null);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong';
      setMessages([...updatedMessages, { role: 'assistant', content: `Error: ${errMsg}` }]);
    } finally {
      setLoading(false);
    }
  };

  /* Submit follow-up message */
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim() || loading || !selectedJob) return;

    const userMsg: ChatMessage = { role: 'user', content: query.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setQuery('');
    setLoading(true);
    setPendingQuestions(null); // Clear any pending pickers

    try {
      const res = await fetch('/api/estimating', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          jobId: selectedJob.id,
          jobName: `#${selectedJob.number} ${selectedJob.name}`,
          estimateType,
          changeOrderName: estimateType === 'change-order' ? changeOrderName : undefined,
          quickEstimate,
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Request failed');
      }

      const data = await res.json();
      const assistantMsg: ChatMessage = { role: 'assistant', content: data.reply };
      setMessages([...updatedMessages, assistantMsg]);

      if (data.proposedBudgets && data.proposedBudgets.length > 0) {
        setProposedBudgets(data.proposedBudgets);
        setActiveOptionIndex(0);
        setCreateResults({});
      } else if (data.proposedBudget) {
        setProposedBudgets([data.proposedBudget]);
        setActiveOptionIndex(0);
        setCreateResults({});
      }

      if (data.structuredQuestions && data.structuredQuestions.length > 0) {
        setPendingQuestions(data.structuredQuestions);
        setQuestionAnswers({});
      } else {
        setPendingQuestions(null);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong';
      setMessages([...updatedMessages, { role: 'assistant', content: `Error: ${errMsg}` }]);
    } finally {
      setLoading(false);
    }
  };

  /* Create budget in JobTread (for active option) */
  const handleCreateBudget = async (optionIdx?: number) => {
    const idx = optionIdx ?? activeOptionIndex;
    const budget = proposedBudgets[idx];
    if (!budget || !selectedJob || creating) return;
    setCreating(true);

    try {
      const res = await fetch('/api/estimating/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          jobId: selectedJob.id,
          budget,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setCreateResults(prev => ({
          ...prev,
          [idx]: {
            success: true,
            message: `Created ${data.createdCount} items in ${data.groupsCreated} groups`,
          },
        }));
      } else {
        setCreateResults(prev => ({
          ...prev,
          [idx]: {
            success: false,
            message: data.errors?.join('; ') || data.error || 'Creation failed',
          },
        }));
      }
    } catch (err) {
      setCreateResults(prev => ({
        ...prev,
        [idx]: {
          success: false,
          message: err instanceof Error ? err.message : 'Creation failed',
        },
      }));
    } finally {
      setCreating(false);
    }
  };

  /* Reset */
  const handleReset = () => {
    setMessages([]);
    setProposedBudgets([]);
    setActiveOptionIndex(0);
    setCreateResults({});
    setChangeOrderName('');
    setScopeText('');
    setUploadedFiles([]);
    setQuickEstimate(false);
    setPendingQuestions(null);
    setQuestionAnswers({});
  };

  /* Filtered jobs for dropdown */
  const filteredJobs = jobs.filter((j) => {
    const q = jobSearch.toLowerCase();
    return j.name.toLowerCase().includes(q) || j.number.includes(q) || j.clientName?.toLowerCase().includes(q);
  });

  /* Key handler for textarea */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasStarted = messages.length > 0;
  const anyFileExtracting = uploadedFiles.some(f => f.extracting);
  const canStartEstimate = selectedJob && !anyFileExtracting && (scopeText.trim() || uploadedFiles.length > 0);

  return (
    <div className="flex flex-col md:flex-row md:h-[calc(100vh-3.5rem)]">
      {/* ── LEFT PANEL: Config & Scope Input ── */}
      <div
        className="w-full md:w-80 md:flex-shrink-0 flex flex-col border-b md:border-b-0 md:border-r md:overflow-y-auto"
        style={{ background: DARK_BG, borderColor: 'rgba(200,140,0,0.12)' }}
      >
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center gap-2">
            <Calculator size={18} style={{ color: GOLD }} />
            <h2 className="text-sm font-semibold" style={{ color: TEXT }}>Estimating</h2>
          </div>

          {/* Job Selector */}
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
              Job
            </label>
            <div className="relative mt-1">
              <button
                onClick={() => setJobDropdownOpen(!jobDropdownOpen)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs"
                style={{ ...CARD, color: selectedJob ? TEXT : TEXT_MUTED }}
              >
                <span className="truncate">
                  {jobsLoading ? 'Loading...' : selectedJob ? `#${selectedJob.number} ${selectedJob.name}` : 'Select a job...'}
                </span>
                <ChevronDown size={14} />
              </button>

              {jobDropdownOpen && (
                <div
                  className="absolute z-50 w-full mt-1 rounded-lg shadow-xl max-h-60 overflow-y-auto"
                  style={{ background: '#f0eeeb', border: '1px solid rgba(200,140,0,0.2)' }}
                >
                  <div className="p-2">
                    <input
                      type="text"
                      placeholder="Search jobs..."
                      value={jobSearch}
                      onChange={(e) => setJobSearch(e.target.value)}
                      className="w-full px-2 py-1.5 rounded text-xs outline-none"
                      style={{ background: DARK_BG, color: TEXT, border: '1px solid rgba(200,140,0,0.1)' }}
                      autoFocus
                    />
                  </div>
                  {filteredJobs.map((j) => (
                    <button
                      key={j.id}
                      onClick={() => {
                        setSelectedJob(j);
                        setJobDropdownOpen(false);
                        setJobSearch('');
                      }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-black/5 transition-colors"
                      style={{ color: TEXT }}
                    >
                      <span style={{ color: GOLD }}>#{j.number}</span>{' '}
                      {j.name}
                      {j.clientName && (
                        <span className="ml-1" style={{ color: TEXT_MUTED }}>— {j.clientName}</span>
                      )}
                    </button>
                  ))}
                  {filteredJobs.length === 0 && (
                    <p className="px-3 py-2 text-xs" style={{ color: TEXT_MUTED }}>No jobs found</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Estimate Type */}
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
              Type
            </label>
            <div className="flex gap-1 mt-1">
              {(['initial', 'change-order'] as EstimateType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setEstimateType(type)}
                  className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
                  style={{
                    background: estimateType === type ? 'rgba(201,168,76,0.15)' : 'transparent',
                    color: estimateType === type ? GOLD : TEXT_MUTED,
                    border: `1px solid ${estimateType === type ? 'rgba(201,168,76,0.3)' : 'rgba(200,140,0,0.08)'}`,
                  }}
                >
                  {type === 'initial' ? 'Initial Estimate' : 'Change Order'}
                </button>
              ))}
            </div>
          </div>

          {/* Change Order Name */}
          {estimateType === 'change-order' && (
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
                Change Order Name
              </label>
              <input
                type="text"
                value={changeOrderName}
                onChange={(e) => setChangeOrderName(e.target.value)}
                placeholder="e.g., Upgraded Countertops"
                className="w-full mt-1 px-3 py-2 rounded-lg text-xs outline-none"
                style={{ ...CARD, color: TEXT }}
              />
              <p className="text-[10px] mt-1" style={{ color: TEXT_MUTED }}>
                Groups under: Post Pricing Changes &gt; Client Requested &gt; [Name]
              </p>
            </div>
          )}

          {/* Divider */}
          <hr style={{ borderColor: 'rgba(200,140,0,0.1)' }} />

          {/* ── SCOPE INPUT SECTION ── */}
          {!hasStarted ? (
            <>
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wide flex items-center gap-1.5" style={{ color: TEXT_MUTED }}>
                  <ClipboardPaste size={11} />
                  Scope / Transcript / Notes
                </label>
                <textarea
                  value={scopeText}
                  onChange={(e) => setScopeText(e.target.value)}
                  placeholder={"Paste or type the scope of work here.\n\nExamples:\n• Project scope description\n• Meeting transcript or notes\n• Vendor estimate details\n• Change order description"}
                  rows={8}
                  className="w-full mt-1 px-3 py-2 rounded-lg text-xs resize-none outline-none"
                  style={{ ...CARD, color: TEXT, lineHeight: '1.6' }}
                />
              </div>

              {/* File Upload */}
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wide flex items-center gap-1.5" style={{ color: TEXT_MUTED }}>
                  <Paperclip size={11} />
                  Attach Files
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.txt,.csv,.doc,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!selectedJob}
                  className="w-full mt-1 flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-xs transition-colors hover:bg-black/5 disabled:opacity-30"
                  style={{
                    border: '1px dashed rgba(200,140,0,0.2)',
                    color: TEXT_MUTED,
                    background: 'rgba(36,36,36,0.5)',
                  }}
                >
                  <Upload size={14} />
                  Upload PDF, TXT, or DOC
                </button>

                {/* Uploaded files list */}
                {uploadedFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {uploadedFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px]"
                        style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.12)' }}
                      >
                        <FileText size={12} style={{ color: GOLD }} />
                        <span className="flex-1 truncate" style={{ color: TEXT }}>
                          {file.name}
                        </span>
                        <span style={{ color: TEXT_MUTED }}>
                          {(file.size / 1024).toFixed(0)}K
                        </span>
                        <button onClick={() => removeFile(idx)} className="hover:bg-white/10 rounded p-0.5">
                          <X size={12} style={{ color: TEXT_MUTED }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Estimate Mode Toggle */}
              <label
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-black/5"
                style={{
                  border: `1px solid ${quickEstimate ? 'rgba(201,168,76,0.25)' : 'rgba(200,140,0,0.08)'}`,
                  background: quickEstimate ? 'rgba(201,168,76,0.06)' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={quickEstimate}
                  onChange={(e) => setQuickEstimate(e.target.checked)}
                  className="mt-0.5 rounded"
                  style={{ accentColor: GOLD }}
                />
                <div>
                  <span className="text-[11px] font-medium" style={{ color: quickEstimate ? GOLD : TEXT }}>
                    Quick estimate — I'll fill in quantities
                  </span>
                  <p className="text-[10px] mt-0.5" style={{ color: TEXT_MUTED }}>
                    Builds structure with placeholder quantities. Faster, but you refine the numbers.
                  </p>
                </div>
              </label>

              {/* Start Estimate Button */}
              <button
                onClick={handleSubmitScope}
                disabled={!canStartEstimate || loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-30"
                style={{
                  background: canStartEstimate ? 'rgba(201,168,76,0.15)' : 'transparent',
                  color: canStartEstimate ? GOLD : TEXT_MUTED,
                  border: `1px solid ${canStartEstimate ? 'rgba(201,168,76,0.3)' : 'rgba(200,140,0,0.08)'}`,
                }}
              >
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Analyzing Scope...
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    Start Estimating
                  </>
                )}
              </button>

              {/* Quick suggestions */}
              {selectedJob && !scopeText && uploadedFiles.length === 0 && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: TEXT_MUTED }}>
                    Quick Start
                  </p>
                  {[
                    'Kitchen renovation: new cabinets, countertops, plumbing, electrical, flooring, and painting',
                    'Bathroom remodel: demo existing, new tile, vanity, plumbing fixtures, and lighting',
                    'Build a 400 SF addition with foundation, framing, roofing, siding, HVAC, and electrical',
                  ].map((suggestion, idx) => (
                    <button
                      key={idx}
                      onClick={() => setScopeText(suggestion)}
                      className="w-full text-left px-3 py-2 mb-1 rounded-lg text-[11px] hover:bg-black/5 transition-colors"
                      style={{ color: TEXT_MUTED, border: '1px solid rgba(200,140,0,0.06)' }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Already started — show summary and new estimate button */}
              <div className="space-y-2">
                <div className="px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.1)' }}>
                  <p className="font-medium" style={{ color: GOLD }}>
                    {estimateType === 'change-order' ? `CO: ${changeOrderName || 'Change Order'}` : 'Initial Estimate'}
                  </p>
                  <p className="mt-0.5 line-clamp-3" style={{ color: TEXT_MUTED }}>
                    {messages[0]?.content.slice(0, 150)}...
                  </p>
                  {uploadedFiles.length > 0 && (
                    <p className="mt-1" style={{ color: TEXT_MUTED }}>
                      {uploadedFiles.length} file{uploadedFiles.length > 1 ? 's' : ''} attached
                    </p>
                  )}
                </div>

                <button
                  onClick={handleReset}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
                  style={{ color: TEXT_MUTED, border: '1px solid rgba(200,140,0,0.08)' }}
                >
                  <Plus size={14} />
                  New Estimate
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── CENTER PANEL: Chat ── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-[70vh] md:min-h-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!hasStarted && (
            <div className="flex flex-col items-center justify-center h-full opacity-40">
              <Hammer size={40} style={{ color: TEXT_MUTED }} />
              <p className="mt-3 text-sm text-center" style={{ color: TEXT_MUTED }}>
                {selectedJob
                  ? 'Enter the scope of work in the left panel to start building your estimate'
                  : 'Select a job to get started'}
              </p>
              {selectedJob && (
                <p className="mt-1 text-xs text-center" style={{ color: TEXT_MUTED }}>
                  Paste a transcript, scope description, or upload a PDF
                </p>
              )}
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(201,168,76,0.12)' }}>
                  <Bot size={14} style={{ color: GOLD }} />
                </div>
              )}
              <div
                className="max-w-[80%] rounded-lg px-3 py-2"
                style={{
                  background: msg.role === 'user' ? 'rgba(201,168,76,0.1)' : '#f8f6f3',
                  border: `1px solid ${msg.role === 'user' ? 'rgba(201,168,76,0.2)' : 'rgba(200,140,0,0.08)'}`,
                  color: TEXT,
                }}
              >
                <RenderContent content={msg.content} />
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(200,140,0,0.12)' }}>
                  <User size={14} style={{ color: '#c88c00' }} />
                </div>
              )}
            </div>
          ))}

          {/* Structured Question Pickers */}
          {pendingQuestions && pendingQuestions.length > 0 && !loading && (
            <QuestionPicker
              questions={pendingQuestions}
              answers={questionAnswers}
              onAnswer={handleQuestionAnswer}
              onSubmit={handleSubmitAnswers}
              submitting={loading}
            />
          )}

          {loading && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(201,168,76,0.12)' }}>
                <Bot size={14} style={{ color: GOLD }} />
              </div>
              <div className="rounded-lg px-3 py-2" style={{ ...CARD }}>
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" style={{ color: GOLD }} />
                  <span className="text-xs" style={{ color: TEXT_MUTED }}>Analyzing scope...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input — only shown after conversation has started */}
        {hasStarted && (
          <div className="p-4 border-t" style={{ borderColor: 'rgba(200,140,0,0.08)' }}>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <textarea
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a follow-up, provide more details, or request changes..."
                disabled={loading}
                rows={2}
                className="flex-1 px-3 py-2 rounded-lg text-sm resize-none outline-none disabled:opacity-50"
                style={{ ...CARD, color: TEXT }}
              />
              <button
                type="submit"
                disabled={!query.trim() || loading}
                className="self-end px-3 py-2 rounded-lg transition-colors disabled:opacity-30"
                style={{ background: 'rgba(201,168,76,0.15)', color: GOLD }}
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL: Budget Preview ── */}
      <div
        className="w-full md:w-80 md:flex-shrink-0 flex flex-col border-t md:border-t-0 md:border-l md:overflow-y-auto"
        style={{ background: DARK_BG, borderColor: 'rgba(200,140,0,0.12)' }}
      >
        <div className="p-3 border-b" style={{ borderColor: 'rgba(200,140,0,0.08)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign size={14} style={{ color: GOLD }} />
              <span className="text-xs font-semibold" style={{ color: TEXT }}>Budget Preview</span>
            </div>
            {proposedBudgets.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                {proposedBudgets.length > 1 ? `${proposedBudgets.length} Options` : 'Ready'}
              </span>
            )}
          </div>

          {/* Option tabs — only shown when multiple options exist */}
          {proposedBudgets.length > 1 && (
            <div className="flex gap-1 mt-2">
              {proposedBudgets.map((b, idx) => {
                const isActive = activeOptionIndex === idx;
                const isImported = createResults[idx]?.success;
                return (
                  <button
                    key={idx}
                    onClick={() => setActiveOptionIndex(idx)}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-colors relative"
                    style={{
                      background: isActive ? 'rgba(201,168,76,0.15)' : 'transparent',
                      color: isActive ? GOLD : TEXT_MUTED,
                      border: `1px solid ${isActive ? 'rgba(201,168,76,0.3)' : 'rgba(200,140,0,0.08)'}`,
                    }}
                  >
                    {isImported && (
                      <CheckCircle2 size={10} className="inline mr-1" style={{ color: '#22c55e' }} />
                    )}
                    {b.optionLabel || `Option ${idx + 1}`}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 p-3">
          <BudgetPreview budget={proposedBudgets[activeOptionIndex] || null} />
        </div>

        {/* Create button — for active option */}
        {proposedBudgets.length > 0 && proposedBudgets[activeOptionIndex] && (
          <div className="p-3 border-t space-y-2" style={{ borderColor: 'rgba(200,140,0,0.08)' }}>
            {createResults[activeOptionIndex] && (
              <div
                className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
                style={{
                  background: createResults[activeOptionIndex].success ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                  border: `1px solid ${createResults[activeOptionIndex].success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                  color: createResults[activeOptionIndex].success ? '#22c55e' : '#ef4444',
                }}
              >
                {createResults[activeOptionIndex].success ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                <span>{createResults[activeOptionIndex].message}</span>
              </div>
            )}

            <button
              onClick={() => handleCreateBudget(activeOptionIndex)}
              disabled={creating || createResults[activeOptionIndex]?.success}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              style={{
                background: createResults[activeOptionIndex]?.success ? 'rgba(34,197,94,0.15)' : 'rgba(201,168,76,0.15)',
                color: createResults[activeOptionIndex]?.success ? '#22c55e' : GOLD,
                border: `1px solid ${createResults[activeOptionIndex]?.success ? 'rgba(34,197,94,0.3)' : 'rgba(201,168,76,0.3)'}`,
              }}
            >
              {creating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Creating in JobTread...
                </>
              ) : createResults[activeOptionIndex]?.success ? (
                <>
                  <CheckCircle2 size={14} />
                  Created in JobTread
                </>
              ) : (
                <>
                  <FileText size={14} />
                  {proposedBudgets.length > 1
                    ? `Create ${proposedBudgets[activeOptionIndex]?.optionLabel || `Option ${activeOptionIndex + 1}`} in JobTread`
                    : 'Create in JobTread'}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  DollarSign,
  Clock,
  AlertTriangle,
  CheckCircle,
  TrendingDown,
  TrendingUp,
  Search,
  Loader2,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  RefreshCw,
  Users,
  FileText,
  X,
  MessageSquare,
  Send,
  Sparkles,
  Briefcase,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================
interface JobSummary {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  priceType: string | null;
  customStatus: string | null;
  isCostPlus: boolean;
  // New fields
  contractPrice?: number;
  pendingCost?: number;
  totalCosts?: number;
  margin?: number;
  marginPct?: number;
  // Legacy fields (kept for backward compat)
  estimatedCost: number;
  estimatedPrice?: number;
  estimatedMargin?: number;
  estimatedMarginPct?: number;
  actualCost: number;
  costVariance?: number;
  costVariancePct?: number;
  invoicedAmount: number;
  collectedAmount: number;
  estimatedHours: number;
  actualHours: number;
  hoursVariance: number;
  health: 'on-track' | 'watch' | 'over-budget';
  alerts: string[];
}

interface Totals {
  totalContractPrice?: number;
  totalEstimatedCost: number;
  totalActualCost: number;
  totalPendingCost?: number;
  totalCosts?: number;
  totalMargin?: number;
  totalEstimatedPrice?: number;
  totalInvoiced: number;
  totalCollected?: number;
  totalEstimatedHours: number;
  totalActualHours: number;
  jobsOverBudget: number;
  jobsOnWatch: number;
  jobCount: number;
}

interface CostCodeRow {
  costCodeName: string;
  costCodeNumber: string;
  estimatedCost: number;
  estimatedPrice: number;
  actualCost: number;
  pendingCost: number;
  committedCost: number;
  remaining: number;
  variance: number;
  pctUsed: number;
  pctCommitted: number;
  status: string;
  itemCount: number;
  topItems: { name: string; cost: number; price: number; quantity: number }[];
  // Per-line breakdowns surfaced when a row is expanded.
  actualLines?: CostLine[];
  pendingLines?: CostLine[];
}

interface CostLine {
  label: string;          // vendor name (bills/POs) or worker name (labor)
  docNumber: string | null;
  itemName: string | null;
  cost: number;
  date: string | null;
  kind: 'bill' | 'po' | 'labor';
  // For labor: total hours rolled up across all of this worker's time entries
  // for this cost code. Null for bills/POs.
  hours: number | null;
}

interface TimeUser {
  name: string;
  work: number;
  travel: number;
  break_: number;
  total: number;
}

interface JobDetail {
  // Cache metadata: present on every detail response. `cachedAt` is
  // when the server computed the underlying data; `cacheHit` is true
  // when the response came straight from Supabase, false when freshly
  // computed. `cacheComputeMs` is how long the most recent compute
  // took (useful for sanity-checking that caching is helping).
  cachedAt?: string;
  cacheAgeMs?: number;
  cacheHit?: boolean;
  cacheComputeMs?: number;
  job: { id: string; name: string; number: string; clientName: string; priceType: string; customStatus: string; isCostPlus: boolean; isCompleted: boolean };
  financialSummary: {
    isCostPlus: boolean;
    contractPrice?: number;
    estimatedCost: number;
    estimatedPrice: number;
    estimatedMargin?: number;
    estimatedMarginPct?: number;
    actualCost: number;
    pendingCost: number;
    totalCosts?: number;
    committedCost: number;
    remainingBudget: number;
    costVariance: number;
    costVariancePct: number;
    margin?: number;
    marginPct?: number;
    projectedMargin: number;
    projectedMarginPct: number;
    contractValue: number;
    invoicedTotal: number;
    draftInvoiceTotal?: number;
    collectedAmount: number;
    scheduleProgress: number;
    // Manual % complete override state (server reads from job_manual_progress)
    progressSource?: 'manual' | 'none';
    effectiveProgress?: number | null;
    manualProgress?: number | null;
    manualSetBy?: string | null;
    manualSetAt?: string | null;
    manualNotes?: string | null;
  };
  costCodeBreakdown: CostCodeRow[];
  timeAnalysis: {
    estimatedHours: number;
    actualWorkHours: number;
    actualTravelHours: number;
    actualBreakHours: number;
    totalActualHours: number;
    hoursVariance: number;
    efficiencyRatio: number;
    byUser: TimeUser[];
    byCostCode: { name: string; hours: number }[];
  };
  pmAnalysis?: {
    basisCost: number;
    basisLabel: string;
    pctOfCost: number;
    hourlyRate: number;
    projectedHours: number;
    actualHours: number;
    actualCost: number;
    actualPctOfCost: number;
    actualPctBasis: number;
    pctUsed: number;
    remainingHours: number;
    byUser: { name: string; hours: number; cost: number }[];
  };
  docSummary: {
    customerOrders: any[];
    customerInvoices: any[];
    vendorBills: any[];
    vendorOrders: any[];
  };
  aiAnalysis: string;
}

// ============================================================
// Helpers
// ============================================================
function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%';
}

function healthColor(health: string) {
  if (health === 'over-budget') return { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)', text: '#ef4444' };
  if (health === 'watch') return { bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.25)', text: '#eab308' };
  return { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)', text: '#22c55e' };
}

function statusColor(status: string) {
  if (status === 'over') return '#ef4444';
  if (status === 'watch') return '#eab308';
  if (status === 'under') return '#22c55e';
  return '#8a8078';
}

// ============================================================
// Component
// ============================================================
export default function JobCostingDashboard() {
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<JobSummary[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [search, setSearch] = useState('');
  const [filterHealth, setFilterHealth] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('health');

  // Detail view
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  // Per-cost-code "show all budget items" toggle. Keys match the row's
  // cost code key (number+name). When a key is in this set, the budget
  // line item list renders ALL items for that row instead of the top 5.
  const [showAllItems, setShowAllItems] = useState<Set<string>>(new Set());

  // Manual % complete override editor state. Open/closed, current input
  // value, and whether a save is in flight.
  const [progressEditOpen, setProgressEditOpen] = useState(false);
  const [progressInput, setProgressInput] = useState('');
  const [progressSaving, setProgressSaving] = useState(false);
  const [progressNotes, setProgressNotes] = useState('');

  async function saveManualProgress() {
    if (!detail) return;
    const pct = Number(progressInput);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      alert('Enter a number between 0 and 100.');
      return;
    }
    setProgressSaving(true);
    try {
      const res = await fetch('/api/dashboard/job-costing/manual-progress', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: detail.job.id, percentComplete: pct, notes: progressNotes || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Save failed: ${j.error || res.status}`);
        return;
      }
      setProgressEditOpen(false);
      // Refetch so the cards + AI analysis re-render with the new value.
      await loadDetail(detail.job.id);
    } finally {
      setProgressSaving(false);
    }
  }

  // On-demand AI analysis state. The detail endpoint no longer auto-runs
  // the AI — we hold the analysis text in component state and only
  // populate it when the user clicks "Run AI Analysis". When the user
  // switches jobs, the analysis resets so they don't see a stale summary
  // from a different project.
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [aiAnalysisAt, setAiAnalysisAt] = useState<string | null>(null);
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false);
  const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);

  async function runAiAnalysis() {
    if (!detail || aiAnalysisLoading) return;
    setAiAnalysisLoading(true);
    setAiAnalysisError(null);
    try {
      const res = await fetch('/api/dashboard/job-costing/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiAnalysisError(data.error || `Analysis failed (${res.status})`);
      } else {
        setAiAnalysis(data.analysis || '');
        setAiAnalysisAt(new Date().toISOString());
      }
    } catch (e: any) {
      setAiAnalysisError(e?.message || 'Network error');
    } finally {
      setAiAnalysisLoading(false);
    }
  }

  async function clearManualProgress() {
    if (!detail) return;
    if (!confirm('Clear the saved % complete? The dashboard and AI analysis will show "Not set" until you save a new value.')) return;
    setProgressSaving(true);
    try {
      const res = await fetch(`/api/dashboard/job-costing/manual-progress?jobId=${encodeURIComponent(detail.job.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Clear failed: ${j.error || res.status}`);
        return;
      }
      setProgressEditOpen(false);
      await loadDetail(detail.job.id);
    } finally {
      setProgressSaving(false);
    }
  }

  // Per-job Ask AI chat state. Each turn is { role, content }. Resets when
  // the user opens a different job so the conversation stays scoped.
  type ChatMsg = { role: 'user' | 'assistant'; content: string };
  const [askMessages, setAskMessages] = useState<ChatMsg[]>([]);
  const [askInput, setAskInput] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  async function sendAskQuestion(text: string) {
    const question = (text || '').trim();
    if (!question || !detail || askLoading) return;
    setAskError(null);
    const next = [...askMessages, { role: 'user' as const, content: question }];
    setAskMessages(next);
    setAskInput('');
    setAskLoading(true);
    try {
      const res = await fetch('/api/dashboard/job-costing/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history: askMessages, // pass prior turns, NOT including the new question
          detail,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Ask failed (${res.status})`);
      }
      const answer = (data.answer || '').trim();
      setAskMessages([...next, { role: 'assistant', content: answer || 'No response.' }]);
    } catch (err: any) {
      setAskError(err?.message || 'Ask failed');
      // Roll back the user turn so they can edit and retry
      setAskMessages(askMessages);
      setAskInput(question);
    } finally {
      setAskLoading(false);
    }
  }

  // ---- Load summary data ----
  async function loadSummary() {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/job-costing', { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSummaries(data.summaries || []);
      setTotals(data.totals || null);
    } catch (err: any) {
      console.error('Failed to load job costing:', err);
    }
    setLoading(false);
  }

  useEffect(() => { loadSummary(); }, []);

  // ---- Load detail for a job ----
  // forceRefresh=true appends ?refresh=1 so the API bypasses its
  // 5-min cache and re-computes from JT. Used by the Refresh button
  // on the detail panel.
  async function loadDetail(jobId: string, forceRefresh = false) {
    setSelectedJobId(jobId);
    setDetailLoading(true);
    setDetail(null);
    setExpandedCodes(new Set());
    setShowAllItems(new Set());
    setAskMessages([]);
    setAskInput('');
    setAskError(null);
    setProgressEditOpen(false);
    setProgressInput('');
    setProgressNotes('');
    setAiAnalysis('');
    setAiAnalysisAt(null);
    setAiAnalysisError(null);
    try {
      const url = forceRefresh
        ? '/api/dashboard/job-costing/detail?refresh=1'
        : '/api/dashboard/job-costing/detail';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDetail(data);
    } catch (err: any) {
      console.error('Failed to load job detail:', err);
    }
    setDetailLoading(false);
  }

  // ---- Stage bucketing ----
  // Map a JobTread customStatus to one of the four kanban buckets shown on
  // the dashboard. Order matters: "Final Billing" must match before
  // "Production" because some statuses contain both words. Anything that
  // doesn't match drops into 'other' which is hidden by default but
  // returned so callers can audit what fell through.
  const bucketForStatus = (status: string | null): 'design' | 'ready' | 'production' | 'final' | 'other' => {
    const s = (status || '').toLowerCase();
    if (!s) return 'other';
    if (/final\s*billing|closeout|punch\s*list|warrant/.test(s)) return 'final';
    if (/in\s*production|production|building|under\s*construction|construction/.test(s)) return 'production';
    if (/^ready\b|ready to build|ready to start|approved|signed|contract\s*signed/.test(s)) return 'ready';
    if (/design|consult|estimate|estimat|proposal|pre[-\s]?con|preconstruction|selection/.test(s)) return 'design';
    return 'other';
  };

  // ---- Filter & sort ----
  const filteredJobs = useMemo(() => {
    let jobs = [...summaries];
    if (search) {
      const q = search.toLowerCase();
      jobs = jobs.filter(
        (j) =>
          j.jobName.toLowerCase().includes(q) ||
          j.clientName.toLowerCase().includes(q) ||
          j.jobNumber.includes(q)
      );
    }
    if (filterHealth !== 'all') {
      jobs = jobs.filter((j) => j.health === filterHealth);
    }
    // Sort
    if (sortBy === 'health') {
      const order = { 'over-budget': 0, watch: 1, 'on-track': 2 };
      jobs.sort((a, b) => (order[a.health] ?? 2) - (order[b.health] ?? 2));
    } else if (sortBy === 'variance') {
      jobs.sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0)); // worst margin first
    } else if (sortBy === 'name') {
      jobs.sort((a, b) => a.jobName.localeCompare(b.jobName));
    } else if (sortBy === 'cost') {
      jobs.sort((a, b) => (b.totalCosts ?? b.actualCost) - (a.totalCosts ?? a.actualCost));
    }
    return jobs;
  }, [summaries, search, filterHealth, sortBy]);

  // Group filtered jobs into the four kanban columns. Memoized so React
  // doesn't re-bucket on every render; depends only on the filtered list.
  const jobsByBucket = useMemo(() => {
    const groups: Record<'design' | 'ready' | 'production' | 'final' | 'other', JobSummary[]> = {
      design: [], ready: [], production: [], final: [], other: [],
    };
    for (const j of filteredJobs) {
      groups[bucketForStatus(j.customStatus)].push(j);
    }
    return groups;
  }, [filteredJobs]);

  // ============================================================
  // DETAIL VIEW
  // ============================================================
  if (selectedJobId) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Back button */}
        <button
          onClick={() => { setSelectedJobId(null); setDetail(null); }}
          className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity"
          style={{ color: '#c88c00' }}
        >
          <ArrowLeft size={16} />
          Back to All Jobs
        </button>

        {detailLoading ? (
          <div className="flex items-center justify-center py-20 gap-3" style={{ color: '#8a8078' }}>
            <Loader2 size={24} className="animate-spin" />
            <span>Analyzing job costs...</span>
          </div>
        ) : detail ? (
          <>
            {/* Job Header */}
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold" style={{ color: '#c88c00', fontFamily: 'Georgia, serif' }}>
                {detail.job.name}
              </h1>
              <span className="text-sm px-2 py-0.5 rounded" style={{ background: '#222', color: '#f0c060', fontWeight: 600 }}>
                #{detail.job.number}
              </span>
              {detail.job.isCompleted && (
                <span className="text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1"
                  style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}>
                  <CheckCircle size={12} />
                  Project Complete
                </span>
              )}
              {detail.job.clientName && (
                <span className="text-sm" style={{ color: '#8a8078' }}>
                  — {detail.job.clientName}
                </span>
              )}
              {/* Freshness indicator + manual refresh.
                  The detail endpoint caches its expensive PAVE computation
                  for 5 minutes; on cache hits the response comes back in
                  ~100ms instead of 30-60s. Show "as of X ago" so the user
                  can tell whether they're looking at fresh data, and a
                  Refresh button that bypasses the cache for a force-pull
                  (e.g., after editing something in JT). */}
              {detail.cachedAt && (() => {
                const ageMs = Date.now() - new Date(detail.cachedAt).getTime();
                const ageMin = Math.floor(ageMs / 60000);
                const ageSec = Math.floor(ageMs / 1000);
                const ageLabel = ageMin >= 1
                  ? `${ageMin} min${ageMin === 1 ? '' : 's'} ago`
                  : ageSec >= 5
                    ? `${ageSec} sec ago`
                    : 'just now';
                return (
                  <div className="ml-auto flex items-center gap-2 text-xs" style={{ color: '#8a8078' }}>
                    <span>
                      Data as of {ageLabel}
                      {detail.cacheHit ? '' : ` · loaded in ${((detail.cacheComputeMs || 0) / 1000).toFixed(1)}s`}
                    </span>
                    <button
                      type="button"
                      onClick={() => loadDetail(detail.job.id, true)}
                      disabled={detailLoading}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:opacity-80"
                      style={{
                        background: '#ffffff',
                        border: '1px solid rgba(200,140,0,0.20)',
                        color: '#c88c00',
                        cursor: detailLoading ? 'not-allowed' : 'pointer',
                      }}
                      title="Force a fresh pull from JobTread (bypasses the 5-minute cache)"
                    >
                      <RefreshCw size={11} className={detailLoading ? 'animate-spin' : ''} />
                      Refresh
                    </button>
                  </div>
                );
              })()}
            </div>

            {/* AI Analysis — on-demand. The detail endpoint stopped auto-
                running this so a job page loads fast and per-% saves don't
                trigger a fresh Haiku call. The user clicks "Run AI Analysis"
                when they want a summary; result lives in component state
                until they switch jobs or re-run. Three states: placeholder
                (no analysis yet), loading, and result. */}
            <div
              className="rounded-lg p-4"
              style={{
                background: 'rgba(201,168,76,0.06)',
                border: '1px solid rgba(201,168,76,0.25)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 size={16} style={{ color: '#a06f00' }} />
                <span className="text-sm font-semibold" style={{ color: '#a06f00' }}>
                  {detail.job.isCompleted ? 'AI Final Assessment' : 'AI Cost Analysis'}
                </span>
                {aiAnalysisAt && !aiAnalysisLoading && (
                  <span className="text-[11px]" style={{ color: '#8a8078' }}>
                    last run {new Date(aiAnalysisAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                {aiAnalysis && !aiAnalysisLoading && (
                  <button
                    type="button"
                    onClick={runAiAnalysis}
                    className="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded"
                    style={{
                      background: 'rgba(160,111,0,0.10)',
                      color: '#a06f00',
                      border: '1px solid rgba(160,111,0,0.25)',
                    }}
                    title="Re-run with the current numbers and overrides"
                  >
                    <RefreshCw size={11} /> Re-run
                  </button>
                )}
              </div>

              {aiAnalysisError && (
                <div
                  className="mb-2 rounded-md px-3 py-2 text-xs"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.20)' }}
                >
                  {aiAnalysisError}
                </div>
              )}

              {aiAnalysisLoading ? (
                <div className="flex items-center gap-2 text-sm" style={{ color: '#8a8078' }}>
                  <Loader2 size={14} className="animate-spin" />
                  Generating analysis…
                </div>
              ) : aiAnalysis ? (
                <div className="text-sm" style={{ color: '#1a1a1a', lineHeight: '1.7' }}
                  dangerouslySetInnerHTML={{
                    __html: aiAnalysis
                      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                      .replace(/^### (.+)$/gm, '<div style="font-weight:600;color:#a06f00;margin-top:0.75rem">$1</div>')
                      .replace(/^## (.+)$/gm, '<div style="font-weight:600;color:#a06f00;margin-top:0.75rem">$1</div>')
                      .replace(/^# (.+)$/gm, '<div style="font-weight:700;color:#a06f00;margin-top:0.75rem;font-size:1rem">$1</div>')
                      .replace(/\n/g, '<br/>')
                  }}
                />
              ) : (
                <div className="text-sm flex items-center justify-between gap-3 flex-wrap" style={{ color: '#5a5550' }}>
                  <span>
                    Set your % complete overrides above, then click <strong>Run AI Analysis</strong> to get
                    an executive summary based on the current numbers.
                  </span>
                  <button
                    type="button"
                    onClick={runAiAnalysis}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium"
                    style={{
                      background: '#a06f00',
                      color: '#ffffff',
                      border: '1px solid #a06f00',
                    }}
                  >
                    <BarChart3 size={13} />
                    Run AI Analysis
                  </button>
                </div>
              )}
            </div>

            {/* Ask AI about this job. Chat is scoped to the currently-open
                job — passes the full detail object on every request so the
                AI reasons over exactly what's on screen. State resets when
                the user opens a different job. */}
            <div
              className="rounded-lg p-4"
              style={{
                background: 'rgba(79,70,229,0.04)',
                border: '1px solid rgba(79,70,229,0.20)',
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={16} style={{ color: '#3730a3' }} />
                <span className="text-sm font-semibold" style={{ color: '#3730a3' }}>
                  Ask AI about this job
                </span>
                {askMessages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setAskMessages([]); setAskError(null); }}
                    className="ml-auto text-xs underline-offset-2 hover:underline"
                    style={{ color: '#8a8078' }}
                  >
                    Clear chat
                  </button>
                )}
              </div>

              {/* Message history */}
              {askMessages.length > 0 && (
                <div className="space-y-2 mb-3 max-h-[420px] overflow-y-auto pr-1">
                  {askMessages.map((m, i) => (
                    <div
                      key={i}
                      className="rounded-md px-3 py-2 text-sm"
                      style={{
                        background: m.role === 'user' ? 'rgba(79,70,229,0.08)' : '#ffffff',
                        border: m.role === 'user' ? '1px solid rgba(79,70,229,0.18)' : '1px solid rgba(200,140,0,0.12)',
                        color: '#1a1a1a',
                        lineHeight: '1.55',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      <div
                        className="text-[10px] uppercase tracking-wide font-semibold mb-1"
                        style={{ color: m.role === 'user' ? '#3730a3' : '#a06f00' }}
                      >
                        {m.role === 'user' ? 'You' : 'AI'}
                      </div>
                      {m.content}
                    </div>
                  ))}
                  {askLoading && (
                    <div className="flex items-center gap-2 text-xs px-2" style={{ color: '#8a8078' }}>
                      <Loader2 size={12} className="animate-spin" />
                      Thinking…
                    </div>
                  )}
                </div>
              )}

              {/* Error banner */}
              {askError && (
                <div
                  className="rounded-md px-3 py-2 text-xs mb-2"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.2)' }}
                >
                  {askError}
                </div>
              )}

              {/* Input row */}
              <form
                onSubmit={(e) => { e.preventDefault(); void sendAskQuestion(askInput); }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={askInput}
                  onChange={(e) => setAskInput(e.target.value)}
                  placeholder={`Ask anything about ${detail.job.name}'s costing…`}
                  disabled={askLoading}
                  className="flex-1 rounded-md px-3 py-2 text-sm"
                  style={{
                    background: '#ffffff',
                    border: '1px solid rgba(200,140,0,0.20)',
                    color: '#1a1a1a',
                  }}
                />
                <button
                  type="submit"
                  disabled={askLoading || !askInput.trim()}
                  className="rounded-md px-3 py-2 text-sm font-medium flex items-center gap-1.5"
                  style={{
                    background: askLoading || !askInput.trim() ? 'rgba(79,70,229,0.30)' : '#4f46e5',
                    color: '#ffffff',
                    cursor: askLoading || !askInput.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {askLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  <span>Ask</span>
                </button>
              </form>

              {/* Quick suggested questions — only shown when the chat is empty
                  so the user has a starting point. Click sends immediately. */}
              {askMessages.length === 0 && !askLoading && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {[
                    'Which categories are most over budget and why?',
                    detail.financialSummary.isCostPlus
                      ? 'Are collections keeping pace with costs?'
                      : 'What is my projected final margin?',
                    'Which vendors have the largest bills on this job?',
                    'What pending bills or POs do I still need to resolve?',
                  ].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void sendAskQuestion(q)}
                      className="text-xs px-2 py-1 rounded hover:opacity-80"
                      style={{
                        background: 'rgba(79,70,229,0.06)',
                        color: '#3730a3',
                        border: '1px solid rgba(79,70,229,0.18)',
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Completed project banner */}
            {detail.job.isCompleted && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                style={{
                  background: detail.financialSummary.pendingCost > 0
                    ? 'rgba(245,158,11,0.08)'
                    : 'rgba(34,197,94,0.06)',
                  border: detail.financialSummary.pendingCost > 0
                    ? '1px solid rgba(245,158,11,0.2)'
                    : '1px solid rgba(34,197,94,0.15)',
                  color: detail.financialSummary.pendingCost > 0 ? '#f59e0b' : '#22c55e',
                }}>
                <CheckCircle size={12} />
                <span>
                  {detail.financialSummary.pendingCost > 0
                    ? `Project complete — $${fmt(detail.financialSummary.pendingCost)} in pending bills/POs included in total costs. Final margin: ${fmtPct(detail.financialSummary.marginPct ?? detail.financialSummary.projectedMarginPct)} ($${fmt(detail.financialSummary.margin ?? detail.financialSummary.projectedMargin)})`
                    : `Project complete — all costs finalized. Final margin: ${fmtPct(detail.financialSummary.marginPct ?? detail.financialSummary.projectedMarginPct)} ($${fmt(detail.financialSummary.margin ?? detail.financialSummary.projectedMargin)})`}
                </span>
              </div>
            )}

            {/* Cost-plus indicator */}
            {detail.financialSummary.isCostPlus && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
                style={{ background: 'rgba(79,70,229,0.10)', border: '1px solid rgba(79,70,229,0.35)', color: '#3730a3' }}>
                <DollarSign size={12} />
                <span>Cost-Plus Project — showing collected vs. actual costs</span>
              </div>
            )}

            {/* Financial Summary Cards - Row 1
                Layout swaps based on price type. Fixed-price jobs track
                budget vs contract; cost-plus jobs don't have a budget, so
                we show how spend, invoicing, collections, and profit are
                tracking against each other instead. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(detail.financialSummary.isCostPlus
                ? [
                    {
                      label: 'Total Costs',
                      value: '$' + fmt(detail.financialSummary.totalCosts || detail.financialSummary.committedCost),
                      sub: detail.financialSummary.pendingCost > 0
                        ? `$${fmt(detail.financialSummary.actualCost)} paid · $${fmt(detail.financialSummary.pendingCost)} pending`
                        : `$${fmt(detail.financialSummary.actualCost)} paid`,
                      color: '#1a1a1a',
                    },
                    {
                      label: 'Invoiced',
                      value: '$' + fmt(detail.financialSummary.invoicedTotal),
                      sub: (() => {
                        const tc = detail.financialSummary.totalCosts || detail.financialSummary.committedCost || 0;
                        if (tc <= 0) return 'No costs yet';
                        return `${Math.round((detail.financialSummary.invoicedTotal / tc) * 100)}% of costs billed`
                          + (detail.financialSummary.draftInvoiceTotal > 0
                            ? ` · $${fmt(detail.financialSummary.draftInvoiceTotal)} in draft`
                            : '');
                      })(),
                      color: '#c88c00',
                    },
                    {
                      label: 'Collected',
                      value: '$' + fmt(detail.financialSummary.collectedAmount),
                      sub: detail.financialSummary.invoicedTotal > 0
                        ? `${Math.round((detail.financialSummary.collectedAmount / detail.financialSummary.invoicedTotal) * 100)}% of invoiced`
                        : 'Nothing invoiced',
                      color: '#c88c00',
                    },
                    {
                      label: detail.job.isCompleted ? 'Final Profit' : 'Profit',
                      value: '$' + fmt(detail.financialSummary.margin ?? detail.financialSummary.projectedMargin),
                      sub: `${(detail.financialSummary.marginPct ?? detail.financialSummary.projectedMarginPct ?? 0).toFixed(1)}% of collected`,
                      color: (detail.financialSummary.margin ?? detail.financialSummary.projectedMargin) >= 0 ? '#22c55e' : '#ef4444',
                    },
                  ]
                : [
                    {
                      label: 'Contract Price',
                      value: '$' + fmt(detail.financialSummary.contractPrice || detail.financialSummary.estimatedPrice),
                      sub: `$${fmt(detail.financialSummary.estimatedCost)} internal cost budget`,
                      color: '#c88c00',
                    },
                    {
                      label: 'Total Costs',
                      value: '$' + fmt(detail.financialSummary.totalCosts || detail.financialSummary.committedCost),
                      sub: detail.financialSummary.pendingCost > 0
                        ? `$${fmt(detail.financialSummary.actualCost)} paid · $${fmt(detail.financialSummary.pendingCost)} pending`
                        : `$${fmt(detail.financialSummary.actualCost)} paid`,
                      color: (detail.financialSummary.totalCosts || detail.financialSummary.committedCost) > detail.financialSummary.estimatedCost && detail.financialSummary.estimatedCost > 0
                        ? '#ef4444' : '#1a1a1a',
                    },
                    {
                      label: detail.job.isCompleted ? 'Final Margin' : 'Margin',
                      value: '$' + fmt(detail.financialSummary.margin ?? detail.financialSummary.projectedMargin),
                      sub: (detail.financialSummary.marginPct ?? detail.financialSummary.projectedMarginPct) !== undefined
                        ? `${(detail.financialSummary.marginPct ?? detail.financialSummary.projectedMarginPct).toFixed(1)}% of contract`
                        : '',
                      color: (detail.financialSummary.margin ?? detail.financialSummary.projectedMargin) >= 0 ? '#22c55e' : '#ef4444',
                    },
                    {
                      label: 'Invoiced',
                      value: '$' + fmt(detail.financialSummary.invoicedTotal),
                      sub: detail.financialSummary.contractValue > 0
                        ? `${Math.round((detail.financialSummary.invoicedTotal / detail.financialSummary.contractValue) * 100)}% of contract`
                        + (detail.financialSummary.draftInvoiceTotal > 0
                          ? ` · $${fmt(detail.financialSummary.draftInvoiceTotal)} in draft`
                          : '')
                        : 'No contract',
                      color: '#c88c00',
                    },
                  ]
              ).map((card: any, i) => {
                // The Progress card is clickable — opens an inline editor to
                // set/clear the manual override. All other cards stay static.
                const isProgress = !!card.isProgress;
                return (
                  <div
                    key={i}
                    onClick={isProgress
                      ? () => {
                          setProgressInput(detail.financialSummary.effectiveProgress != null
                            ? String(detail.financialSummary.effectiveProgress)
                            : '');
                          setProgressNotes(detail.financialSummary.manualNotes || '');
                          setProgressEditOpen(true);
                        }
                      : undefined}
                    className={`rounded-lg p-3 ${isProgress ? 'cursor-pointer hover:bg-stone-50 transition-colors' : ''}`}
                    style={{
                      background: '#ffffff',
                      border: isProgress
                        ? '1px solid rgba(79,70,229,0.30)'
                        : '1px solid rgba(200,140,0,0.1)',
                    }}
                  >
                    <p className="text-xs mb-1" style={{ color: '#8a8078' }}>{card.label}</p>
                    <p className="text-xl font-bold" style={{ color: card.color }}>{card.value}</p>
                    <p className="text-xs mt-1" style={{ color: card.color }}>{card.sub}</p>
                  </div>
                );
              })}
            </div>

            {/* Manual % complete override editor. Inline form that appears
                below the cards when the user clicks the Progress card. Save
                writes to job_manual_progress and refetches the detail so
                the AI analysis reruns with the new value. "Clear override"
                removes the row and falls back to the schedule-derived %. */}
            {progressEditOpen && (
              <div
                className="rounded-lg p-4"
                style={{
                  background: 'rgba(79,70,229,0.04)',
                  border: '1px solid rgba(79,70,229,0.20)',
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-semibold" style={{ color: '#3730a3' }}>
                    Set project % complete for {detail.job.name}
                  </span>
                  {detail.financialSummary.progressSource === 'manual' && (
                    <span className="text-xs" style={{ color: '#8a8078' }}>
                      currently {detail.financialSummary.manualProgress}%
                      {detail.financialSummary.manualSetAt
                        ? ` · set ${new Date(detail.financialSummary.manualSetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                        : ''}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setProgressEditOpen(false)}
                    className="ml-auto text-xs underline-offset-2 hover:underline"
                    style={{ color: '#8a8078' }}
                  >
                    Close
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm" style={{ color: '#1a1a1a' }}>
                    <span>%:</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={progressInput}
                      onChange={(e) => setProgressInput(e.target.value)}
                      disabled={progressSaving}
                      className="rounded-md px-2 py-1 text-sm w-24"
                      style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.20)', color: '#1a1a1a' }}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm flex-1 min-w-[240px]" style={{ color: '#1a1a1a' }}>
                    <span className="shrink-0">Note (optional):</span>
                    <input
                      type="text"
                      value={progressNotes}
                      onChange={(e) => setProgressNotes(e.target.value)}
                      disabled={progressSaving}
                      placeholder="e.g. drywall done, paint started"
                      className="rounded-md px-2 py-1 text-sm flex-1"
                      style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.20)', color: '#1a1a1a' }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={saveManualProgress}
                    disabled={progressSaving}
                    className="rounded-md px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
                    style={{
                      background: progressSaving ? 'rgba(79,70,229,0.30)' : '#4f46e5',
                      color: '#ffffff',
                      cursor: progressSaving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {progressSaving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                    Save
                  </button>
                  {detail.financialSummary.progressSource === 'manual' && (
                    <button
                      type="button"
                      onClick={clearManualProgress}
                      disabled={progressSaving}
                      className="rounded-md px-3 py-1.5 text-sm"
                      style={{
                        background: '#ffffff',
                        border: '1px solid rgba(239,68,68,0.30)',
                        color: '#b91c1c',
                        cursor: progressSaving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-xs mt-2" style={{ color: '#8a8078' }}>
                  The value you save here is the only project % the dashboard and AI cost analysis use.
                  It persists across page loads and only changes when you update it.
                </p>
              </div>
            )}

            {/* Financial Summary Cards - Row 2
                Fixed-price: collected, remaining to bill, cost budget, progress.
                Cost-plus: cost-vs-billing cashflow gap, markup yield, paid
                breakout, progress — these are the levers Brett actually
                manages on a cost-plus job. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(detail.financialSummary.isCostPlus
                ? [
                    (() => {
                      // Costs Awaiting Billing = total costs incurred but not
                      // yet invoiced. On cost-plus this is the cashflow gap
                      // — every dollar here is one we're floating the client.
                      const tc = detail.financialSummary.totalCosts || detail.financialSummary.committedCost || 0;
                      const gap = Math.max(0, tc - detail.financialSummary.invoicedTotal);
                      return {
                        label: 'Costs Awaiting Billing',
                        value: '$' + fmt(gap),
                        sub: tc > 0
                          ? `${Math.round((gap / tc) * 100)}% of costs not yet invoiced`
                          : 'No costs yet',
                        color: gap > 0 ? '#f59e0b' : '#22c55e',
                      };
                    })(),
                    (() => {
                      // Markup Yield = profit / total costs. Effective markup
                      // we're earning on top of costs. Compare to the markup
                      // promised in the cost-plus agreement.
                      const tc = detail.financialSummary.totalCosts || detail.financialSummary.committedCost || 0;
                      const profit = detail.financialSummary.margin ?? detail.financialSummary.projectedMargin ?? 0;
                      const yieldPct = tc > 0 ? (profit / tc) * 100 : 0;
                      return {
                        label: 'Markup Yield',
                        value: tc > 0 ? `${yieldPct.toFixed(1)}%` : '—',
                        sub: tc > 0 ? `profit ÷ costs` : 'No costs yet',
                        color: yieldPct >= 0 ? '#22c55e' : '#ef4444',
                      };
                    })(),
                    {
                      label: 'Pending Costs',
                      value: '$' + fmt(detail.financialSummary.pendingCost),
                      sub: detail.financialSummary.pendingCost > 0
                        ? 'draft / pending bills + POs'
                        : 'No pending bills',
                      color: detail.financialSummary.pendingCost > 0 ? '#f59e0b' : '#8a8078',
                    },
                    (() => {
                      const eff = detail.financialSummary.effectiveProgress;
                      const hasValue = typeof eff === 'number';
                      return {
                        label: 'Project % Complete',
                        value: hasValue ? eff + '%' : 'Not set',
                        sub: hasValue ? 'click to edit' : 'click to set',
                        color: hasValue
                          ? (eff >= 75 ? '#22c55e' : eff >= 25 ? '#c88c00' : '#8a8078')
                          : '#8a8078',
                        isProgress: true,
                      } as any;
                    })(),
                  ]
                : [
                    {
                      label: 'Collected',
                      value: '$' + fmt(detail.financialSummary.collectedAmount),
                      sub: detail.financialSummary.invoicedTotal > 0
                        ? `${Math.round((detail.financialSummary.collectedAmount / detail.financialSummary.invoicedTotal) * 100)}% of invoiced`
                        : 'Nothing invoiced',
                      color: '#c88c00',
                    },
                    {
                      label: 'Remaining to Bill',
                      value: '$' + fmt(Math.max(0, detail.financialSummary.contractValue - detail.financialSummary.invoicedTotal)),
                      sub: detail.financialSummary.contractValue > 0
                        ? `${Math.round(((detail.financialSummary.contractValue - detail.financialSummary.invoicedTotal) / detail.financialSummary.contractValue) * 100)}% unbilled`
                        : 'No contract',
                      color: detail.financialSummary.contractValue - detail.financialSummary.invoicedTotal > 0 ? '#f59e0b' : '#22c55e',
                    },
                    {
                      label: 'Internal Cost Budget',
                      value: '$' + fmt(detail.financialSummary.estimatedCost),
                      sub: detail.financialSummary.estimatedCost > 0
                        ? `${Math.round(((detail.financialSummary.totalCosts || detail.financialSummary.committedCost) / detail.financialSummary.estimatedCost) * 100)}% of budget spent`
                        : 'No budget set',
                      color: '#8a8078',
                    },
                    (() => {
                      // Progress card. Manual-only — schedule data is no longer
                      // displayed or used as a fallback. Shows "Not set" until
                      // Nathan saves a value; once set, the value persists across
                      // page loads and stays put until he edits it.
                      const eff = detail.financialSummary.effectiveProgress;
                      const hasValue = typeof eff === 'number';
                      return {
                        label: 'Project % Complete',
                        value: hasValue ? eff + '%' : 'Not set',
                        sub: hasValue
                          ? 'click to edit'
                          : 'click to set',
                        color: hasValue
                          ? (eff >= 75 ? '#22c55e' : eff >= 25 ? '#c88c00' : '#8a8078')
                          : '#8a8078',
                        isProgress: true,
                      } as any;
                    })(),
                  ]
              ).map((card: any, i) => {
                // The Progress card in this row is clickable — opens the
                // inline editor below the cards. Other cards are static.
                const isProgress = !!card.isProgress;
                return (
                  <div
                    key={i}
                    onClick={isProgress
                      ? () => {
                          setProgressInput(detail.financialSummary.effectiveProgress != null
                            ? String(detail.financialSummary.effectiveProgress)
                            : '');
                          setProgressNotes(detail.financialSummary.manualNotes || '');
                          setProgressEditOpen(true);
                        }
                      : undefined}
                    className={`rounded-lg p-3 ${isProgress ? 'cursor-pointer hover:bg-stone-50 transition-colors' : ''}`}
                    style={{
                      background: '#ffffff',
                      border: isProgress
                        ? '1px solid rgba(79,70,229,0.30)'
                        : '1px solid rgba(200,140,0,0.1)',
                    }}
                  >
                    <p className="text-xs mb-1" style={{ color: '#8a8078' }}>{card.label}</p>
                    <p className="text-xl font-bold" style={{ color: card.color }}>{card.value}</p>
                    <p className="text-xs mt-1" style={{ color: card.color }}>{card.sub}</p>
                  </div>
                );
              })}
            </div>

            {/* Cost Code Breakdown */}
            <div
              className="rounded-lg overflow-hidden"
              style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
            >
              <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(200,140,0,0.08)' }}>
                <h2 className="text-sm font-bold" style={{ color: '#1a1a1a' }}>
                  Cost Breakdown by Category
                </h2>
                <p className="text-xs mt-1" style={{ color: '#8a8078' }}>
                  {detail.financialSummary.isCostPlus
                    ? 'Actual from approved bills/POs · Pending from draft/pending bills/POs'
                    : 'Budget from approved proposals · Actual from approved bills/POs · Pending from draft/pending bills/POs'}
                </p>
              </div>

              {/* Table header. Cost-plus drops Budgeted + Remaining since
                  there's no budget on cost-plus jobs. */}
              {(() => {
                const cp = detail.financialSummary.isCostPlus;
                const gridCols = cp
                  ? '2.5fr 1fr 1fr 1fr 80px'
                  : '2.5fr 1fr 1fr 1fr 1fr 80px';
                return (
                  <div
                    className="grid gap-2 px-4 py-2 text-xs font-medium"
                    style={{
                      color: '#8a8078',
                      borderBottom: '1px solid rgba(200,140,0,0.06)',
                      gridTemplateColumns: gridCols,
                    }}
                  >
                    <div>Cost Code</div>
                    {!cp && <div className="text-right">Budgeted</div>}
                    <div className="text-right">Actual</div>
                    <div className="text-right">Pending</div>
                    <div className="text-right">{cp ? 'Total' : 'Remaining'}</div>
                    <div className="text-right">{cp ? '% of spend' : 'Status'}</div>
                  </div>
                );
              })()}

              {/* Rows */}
              {detail.costCodeBreakdown.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs" style={{ color: '#8a8078' }}>
                  {detail.financialSummary.isCostPlus
                    ? 'No spend recorded yet on this job.'
                    : 'No cost code breakdown available. Budget totals are shown in summary cards above.'}
                </div>
              ) : (
                detail.costCodeBreakdown.map((cc) => {
                  const key = cc.costCodeNumber + cc.costCodeName;
                  const isExpanded = expandedCodes.has(key);
                  const cp = detail.financialSummary.isCostPlus;
                  // On cost-plus, "% of spend" is this cost code's share of
                  // the job's total spend — the biggest spend drivers float
                  // to the top of the eye instead of "% of budget".
                  const totalJobSpend = (detail.financialSummary.totalCosts || detail.financialSummary.committedCost || 0);
                  const codeTotal = cc.committedCost; // actual + pending
                  const shareOfSpend = totalJobSpend > 0 ? (codeTotal / totalJobSpend) * 100 : 0;
                  const gridCols = cp
                    ? '2.5fr 1fr 1fr 1fr 80px'
                    : '2.5fr 1fr 1fr 1fr 1fr 80px';
                  return (
                    <div key={key}>
                      <button
                        onClick={() => {
                          setExpandedCodes((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        }}
                        className="w-full grid gap-2 px-4 py-2.5 text-sm hover:bg-white/[0.02] transition-colors items-center"
                        style={{
                          borderBottom: '1px solid rgba(200,140,0,0.04)',
                          gridTemplateColumns: gridCols,
                        }}
                      >
                        <div className="flex items-center gap-2 text-left min-w-0">
                          {isExpanded ? (
                            <ChevronDown size={12} className="shrink-0" style={{ color: '#8a8078' }} />
                          ) : (
                            <ChevronRight size={12} className="shrink-0" style={{ color: '#8a8078' }} />
                          )}
                          <span
                            className="text-xs px-1 py-0.5 rounded font-mono shrink-0"
                            style={{ background: '#222', color: '#f0c060', fontWeight: 600 }}
                          >
                            {cc.costCodeNumber}
                          </span>
                          <span className="truncate" style={{ color: '#1a1a1a' }}>{cc.costCodeName}</span>
                        </div>
                        {!cp && (
                          <div className="text-right" style={{ color: '#8a8078' }}>
                            ${fmt(cc.estimatedCost)}
                          </div>
                        )}
                        <div className="text-right" style={{ color: '#1a1a1a' }}>
                          ${fmt(cc.actualCost)}
                        </div>
                        <div className="text-right" style={{ color: cc.pendingCost > 0 ? '#f59e0b' : '#555' }}>
                          {cc.pendingCost > 0 ? `$${fmt(cc.pendingCost)}` : '—'}
                        </div>
                        {cp ? (
                          // Cost-plus: show total spend per code instead of
                          // "Remaining" — there's no budget to remain against.
                          <div className="text-right" style={{ color: codeTotal > 0 ? '#1a1a1a' : '#555', fontWeight: 600 }}>
                            {codeTotal > 0 ? `$${fmt(codeTotal)}` : '—'}
                          </div>
                        ) : (
                          // Fixed-price: Remaining column with over-budget surfacing.
                          (() => {
                            const overAmount = cc.committedCost - cc.estimatedCost;
                            const isOver = cc.estimatedCost > 0 && overAmount > 0;
                            const hasAnyData = cc.estimatedCost > 0 || cc.committedCost > 0;
                            return (
                              <div className="text-right" style={{
                                color: isOver
                                  ? '#ef4444'
                                  : cc.remaining > 0
                                    ? '#22c55e'
                                    : cc.remaining === 0 && cc.estimatedCost === 0
                                      ? '#555'
                                      : '#ef4444',
                                fontWeight: isOver ? 600 : undefined,
                              }}>
                                {!hasAnyData
                                  ? '—'
                                  : isOver
                                    ? `−$${fmt(overAmount)} over`
                                    : `$${fmt(cc.remaining)}`}
                              </div>
                            );
                          })()
                        )}
                        {cp ? (
                          // Cost-plus status column = share of total job spend.
                          <div className="text-right flex items-center justify-end gap-1.5">
                            <div className="w-12 h-1.5 rounded-full overflow-hidden relative" style={{ background: '#333' }}>
                              <div
                                className="h-full rounded-full absolute left-0 top-0"
                                style={{
                                  width: `${Math.min(shareOfSpend, 100)}%`,
                                  background: '#c88c00',
                                }}
                              />
                            </div>
                            <span className="text-xs w-8 text-right" style={{ color: '#8a8078' }}>
                              {Math.round(shareOfSpend)}%
                            </span>
                          </div>
                        ) : (
                          <div className="text-right flex items-center justify-end gap-1.5">
                            {/* Stacked progress bar: actual (solid) + pending (striped) */}
                            <div className="w-12 h-1.5 rounded-full overflow-hidden relative" style={{ background: '#333' }}>
                              <div
                                className="h-full rounded-full absolute left-0 top-0"
                                style={{
                                  width: `${Math.min(cc.pctUsed, 100)}%`,
                                  background: statusColor(cc.status),
                                }}
                              />
                              {cc.pendingCost > 0 && cc.estimatedCost > 0 && (
                                <div
                                  className="h-full absolute top-0"
                                  style={{
                                    left: `${Math.min(cc.pctUsed, 100)}%`,
                                    width: `${Math.min((cc.pendingCost / cc.estimatedCost) * 100, 100 - Math.min(cc.pctUsed, 100))}%`,
                                    background: 'rgba(245,158,11,0.5)',
                                  }}
                                />
                              )}
                            </div>
                            <span className="text-xs w-8 text-right" style={{ color: statusColor(cc.status) }}>
                              {cc.pctUsed}%
                            </span>
                          </div>
                        )}
                      </button>

                      {/* Expanded drawer: budget line items + actual + pending breakdowns */}
                      {isExpanded && (
                        <div className="px-4 pb-3 pt-1 ml-8 space-y-3">
                          {/* Actual costs — what's been spent so far.
                              Labor lines are rolled up per-employee
                              server-side, so a single Labor row can
                              represent dozens of time entries. */}
                          {cc.actualLines && cc.actualLines.length > 0 && (
                            <div>
                              <div className="text-xs font-semibold mb-1.5 flex items-center gap-2" style={{ color: '#1a1a1a' }}>
                                <span>Actual Costs</span>
                                <span style={{ color: '#8a8078', fontWeight: 400 }}>
                                  ({cc.actualLines.filter(l => l.kind !== 'labor').length} bill{cc.actualLines.filter(l => l.kind !== 'labor').length === 1 ? '' : 's'}
                                  {cc.actualLines.some(l => l.kind === 'labor') && (
                                    <> · {cc.actualLines.filter(l => l.kind === 'labor').length} worker{cc.actualLines.filter(l => l.kind === 'labor').length === 1 ? '' : 's'}</>
                                  )}
                                  {' · '}${fmt(cc.actualCost)})
                                </span>
                              </div>
                              {cc.actualLines.map((line, i) => (
                                <div
                                  key={'a' + i}
                                  className="flex items-center gap-3 py-1 text-xs"
                                  style={{ color: '#8a8078' }}
                                >
                                  <span
                                    className="text-[10px] uppercase tracking-wide font-mono shrink-0 px-1.5 py-0.5 rounded"
                                    style={{
                                      background: line.kind === 'labor' ? 'rgba(59,130,246,0.12)' : line.kind === 'po' ? 'rgba(168,85,247,0.12)' : 'rgba(34,197,94,0.12)',
                                      color: line.kind === 'labor' ? '#3b82f6' : line.kind === 'po' ? '#a855f7' : '#22c55e',
                                    }}
                                  >
                                    {line.kind === 'labor' ? 'Labor' : line.kind === 'po' ? 'PO' : 'Bill'}
                                  </span>
                                  <span className="flex-1 truncate" style={{ color: '#1a1a1a' }}>
                                    {line.label}
                                    {line.kind !== 'labor' && line.docNumber ? <span style={{ color: '#8a8078' }}> · #{line.docNumber}</span> : null}
                                    {line.kind !== 'labor' && line.itemName ? <span style={{ color: '#8a8078' }}> — {line.itemName}</span> : null}
                                  </span>
                                  {/* Labor rows show total hours instead of a date (the rollup spans many days). */}
                                  {line.kind === 'labor' && line.hours != null ? (
                                    <span className="shrink-0 text-[11px]" style={{ color: '#8a8078' }}>
                                      {line.hours} {line.hours === 1 ? 'hr' : 'hrs'}
                                    </span>
                                  ) : line.date ? (
                                    <span className="shrink-0 text-[11px]" style={{ color: '#8a8078' }}>
                                      {new Date(line.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                  ) : null}
                                  <span className="shrink-0 w-24 text-right" style={{ color: '#1a1a1a' }}>
                                    ${fmt(line.cost)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Pending costs — committed but not yet final */}
                          {cc.pendingLines && cc.pendingLines.length > 0 && (
                            <div>
                              <div className="text-xs font-semibold mb-1.5 flex items-center gap-2" style={{ color: '#f59e0b' }}>
                                <span>Pending Costs</span>
                                <span style={{ color: '#8a8078', fontWeight: 400 }}>
                                  ({cc.pendingLines.length} {cc.pendingLines.length === 1 ? 'entry' : 'entries'} · ${fmt(cc.pendingCost)})
                                </span>
                              </div>
                              {cc.pendingLines.map((line, i) => (
                                <div
                                  key={'p' + i}
                                  className="flex items-center gap-3 py-1 text-xs"
                                  style={{ color: '#8a8078' }}
                                >
                                  <span
                                    className="text-[10px] uppercase tracking-wide font-mono shrink-0 px-1.5 py-0.5 rounded"
                                    style={{
                                      background: line.kind === 'po' ? 'rgba(168,85,247,0.12)' : 'rgba(245,158,11,0.12)',
                                      color: line.kind === 'po' ? '#a855f7' : '#f59e0b',
                                    }}
                                  >
                                    {line.kind === 'po' ? 'PO' : 'Bill'}
                                  </span>
                                  <span className="flex-1 truncate" style={{ color: '#1a1a1a' }}>
                                    {line.label}
                                    {line.docNumber ? <span style={{ color: '#8a8078' }}> · #{line.docNumber}</span> : null}
                                    {line.itemName ? <span style={{ color: '#8a8078' }}> — {line.itemName}</span> : null}
                                  </span>
                                  {line.date && (
                                    <span className="shrink-0 text-[11px]" style={{ color: '#8a8078' }}>
                                      {new Date(line.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                  )}
                                  <span className="shrink-0 w-24 text-right" style={{ color: '#f59e0b' }}>
                                    ${fmt(line.cost)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Budget line items — original estimate breakdown.
                              Renders the top 5 by default; the "Show all"
                              link toggles the rest into view (state lives in
                              showAllItems, keyed on the row's cost code key).
                              Hidden on cost-plus jobs since there's no budget
                              to compare actuals against. */}
                          {!cp && cc.topItems.length > 0 && (() => {
                            const showAll = showAllItems.has(key);
                            const items = showAll ? cc.topItems : cc.topItems.slice(0, 5);
                            const hidden = cc.topItems.length - items.length;
                            return (
                              <div>
                                <div className="text-xs font-semibold mb-1.5" style={{ color: '#8a8078' }}>
                                  Budget Line Items ({cc.itemCount} {cc.itemCount === 1 ? 'item' : 'items'})
                                </div>
                                {items.map((item, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center gap-3 py-1 text-xs"
                                    style={{ color: '#8a8078' }}
                                  >
                                    <span className="flex-1 truncate" style={{ color: '#1a1a1a' }}>{item.name}</span>
                                    <span className="shrink-0">Qty: {item.quantity}</span>
                                    <span className="shrink-0 w-20 text-right">${fmt(item.cost)} cost</span>
                                    <span className="shrink-0 w-20 text-right">${fmt(item.price)} price</span>
                                  </div>
                                ))}
                                {(hidden > 0 || showAll) && cc.topItems.length > 5 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowAllItems((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(key)) next.delete(key);
                                        else next.add(key);
                                        return next;
                                      });
                                    }}
                                    className="text-xs mt-1.5 underline-offset-2 hover:underline"
                                    style={{ color: '#a06f00', cursor: 'pointer' }}
                                  >
                                    {showAll
                                      ? 'Show less'
                                      : `Show all ${cc.topItems.length} items (${hidden} more)`}
                                  </button>
                                )}
                              </div>
                            );
                          })()}

                          {/* Empty state — should be rare since the row only exists if there's data, but defensive */}
                          {(!cc.actualLines || cc.actualLines.length === 0)
                            && (!cc.pendingLines || cc.pendingLines.length === 0)
                            && cc.topItems.length === 0 && (
                            <div className="text-xs italic" style={{ color: '#8a8078' }}>
                              No detail available for this cost code.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* Totals row. Mirrors the per-row column layout — drops
                  Budgeted + Remaining on cost-plus jobs, shows job-wide
                  spend total instead. */}
              {detail.costCodeBreakdown.length > 0 && (() => {
                const cp = detail.financialSummary.isCostPlus;
                const totActual = detail.financialSummary.actualCost || 0;
                const totPending = detail.financialSummary.pendingCost || 0;
                const totSpend = totActual + totPending;
                const gridCols = cp
                  ? '2.5fr 1fr 1fr 1fr 80px'
                  : '2.5fr 1fr 1fr 1fr 1fr 80px';
                return (
                  <div
                    className="grid gap-2 px-4 py-3 text-sm font-bold"
                    style={{
                      borderTop: '1px solid rgba(200,140,0,0.15)',
                      background: 'rgba(201,168,76,0.04)',
                      gridTemplateColumns: gridCols,
                    }}
                  >
                    <div style={{ color: '#c88c00' }}>TOTAL</div>
                    {!cp && (
                      <div className="text-right" style={{ color: '#8a8078' }}>
                        ${fmt(detail.financialSummary.estimatedCost)}
                      </div>
                    )}
                    <div className="text-right" style={{ color: '#1a1a1a' }}>
                      ${fmt(totActual)}
                    </div>
                    <div className="text-right" style={{ color: totPending > 0 ? '#f59e0b' : '#555' }}>
                      {totPending > 0 ? `$${fmt(totPending)}` : '—'}
                    </div>
                    {cp ? (
                      <div className="text-right" style={{ color: '#1a1a1a' }}>
                        ${fmt(totSpend)}
                      </div>
                    ) : (
                      (() => {
                        const totBudget = detail.financialSummary.estimatedCost || 0;
                        const totCommitted = totActual + totPending;
                        const totOver = totCommitted - totBudget;
                        const totIsOver = totBudget > 0 && totOver > 0;
                        return (
                          <div className="text-right" style={{
                            color: totIsOver ? '#ef4444' : detail.financialSummary.remainingBudget > 0 ? '#22c55e' : '#ef4444',
                          }}>
                            {totIsOver
                              ? `−$${fmt(totOver)} over`
                              : `$${fmt(detail.financialSummary.remainingBudget)}`}
                          </div>
                        );
                      })()
                    )}
                    <div className="text-right text-xs" style={{ color: '#8a8078' }}>
                      {cp
                        ? (totSpend > 0 ? '100%' : '—')
                        : (detail.financialSummary.estimatedCost > 0
                            ? Math.round((detail.financialSummary.actualCost / detail.financialSummary.estimatedCost) * 100) + '%'
                            : '—')}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Time Analysis */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Hours summary */}
              <div
                className="rounded-lg p-4"
                style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
              >
                <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: '#1a1a1a' }}>
                  <Clock size={14} style={{ color: '#c88c00' }} />
                  Labor Hours
                </h2>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: '#8a8078' }}>Estimated</span>
                    <span className="text-sm font-medium" style={{ color: '#8a8078' }}>
                      {detail.timeAnalysis.estimatedHours} hrs
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: '#8a8078' }}>Actual Work</span>
                    <span className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
                      {detail.timeAnalysis.actualWorkHours} hrs
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: '#8a8078' }}>Travel</span>
                    <span className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
                      {detail.timeAnalysis.actualTravelHours} hrs
                    </span>
                  </div>
                  <div
                    className="flex justify-between items-center pt-2"
                    style={{ borderTop: '1px solid rgba(200,140,0,0.1)' }}
                  >
                    <span className="text-xs font-medium" style={{ color: '#c88c00' }}>Variance</span>
                    <span
                      className="text-sm font-bold"
                      style={{ color: detail.timeAnalysis.hoursVariance >= 0 ? '#22c55e' : '#ef4444' }}
                    >
                      {detail.timeAnalysis.hoursVariance >= 0 ? '+' : ''}
                      {detail.timeAnalysis.hoursVariance} hrs
                    </span>
                  </div>
                  {detail.timeAnalysis.estimatedHours > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs" style={{ color: '#8a8078' }}>Efficiency</span>
                      <span
                        className="text-sm font-medium"
                        style={{ color: detail.timeAnalysis.efficiencyRatio <= 100 ? '#22c55e' : '#ef4444' }}
                      >
                        {detail.timeAnalysis.efficiencyRatio}%
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Hours by user */}
              <div
                className="rounded-lg p-4"
                style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
              >
                <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: '#1a1a1a' }}>
                  <Users size={14} style={{ color: '#c88c00' }} />
                  Hours by Team Member
                </h2>

                {detail.timeAnalysis.byUser.length === 0 ? (
                  <p className="text-xs" style={{ color: '#8a8078' }}>No time entries logged.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.timeAnalysis.byUser.map((user) => (
                      <div key={user.name} className="flex items-center gap-2">
                        <span className="text-xs flex-1 truncate" style={{ color: '#1a1a1a' }}>
                          {user.name}
                        </span>
                        <span className="text-xs" style={{ color: '#8a8078' }}>
                          {user.work}w
                        </span>
                        {user.travel > 0 && (
                          <span className="text-xs" style={{ color: '#8a8078' }}>
                            {user.travel}t
                          </span>
                        )}
                        <span className="text-xs font-medium w-12 text-right" style={{ color: '#c88c00' }}>
                          {user.total}h
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Project Management Hours
                BKB tracks PM time as a percent-of-project-cost metric:
                projected PM hours = (total cost × 6%) ÷ $85. Actual PM
                hours come from time entries on cc01 "Planning, Admin".
                This card shows projected vs actual side-by-side so
                Nathan can see at a glance whether PM is tracking close
                to the budgeted formula. The breakdown lists who's
                logging the PM time. */}
            {detail.pmAnalysis && (
              <div
                className="rounded-lg p-4"
                style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Briefcase size={14} style={{ color: '#c88c00' }} />
                  <h2 className="text-sm font-bold" style={{ color: '#1a1a1a' }}>Project Management Hours</h2>
                  <span className="text-[10px] ml-auto" style={{ color: '#8a8078' }}>
                    cc01 Planning, Admin · {detail.pmAnalysis.pctOfCost}% of {detail.pmAnalysis.basisLabel.toLowerCase()} ÷ ${detail.pmAnalysis.hourlyRate}/hr
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {/* Projected */}
                  <div className="rounded-lg p-3" style={{ background: 'rgba(200,140,0,0.04)', border: '1px solid rgba(200,140,0,0.1)' }}>
                    <p className="text-xs mb-1" style={{ color: '#8a8078' }}>Projected</p>
                    <p className="text-xl font-bold" style={{ color: '#8a8078' }}>
                      {detail.pmAnalysis.projectedHours} hrs
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: '#8a8078' }}>
                      from ${fmt(detail.pmAnalysis.basisCost)}
                    </p>
                  </div>
                  {/* Actual */}
                  <div className="rounded-lg p-3" style={{ background: 'rgba(200,140,0,0.04)', border: '1px solid rgba(200,140,0,0.1)' }}>
                    <p className="text-xs mb-1" style={{ color: '#8a8078' }}>Actual</p>
                    <p className="text-xl font-bold" style={{ color: '#1a1a1a' }}>
                      {detail.pmAnalysis.actualHours} hrs
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: '#8a8078' }}>
                      ${fmt(detail.pmAnalysis.actualCost)} burdened
                    </p>
                  </div>
                  {/* % used */}
                  {(() => {
                    const pct = detail.pmAnalysis.pctUsed;
                    const projHrs = detail.pmAnalysis.projectedHours;
                    const color = projHrs <= 0 ? '#8a8078'
                      : pct > 100 ? '#ef4444'
                      : pct >= 85 ? '#f59e0b'
                      : '#22c55e';
                    return (
                      <div className="rounded-lg p-3" style={{ background: 'rgba(200,140,0,0.04)', border: '1px solid rgba(200,140,0,0.1)' }}>
                        <p className="text-xs mb-1" style={{ color: '#8a8078' }}>% of Projected</p>
                        <p className="text-xl font-bold" style={{ color }}>
                          {projHrs > 0 ? pct.toFixed(1) + '%' : '—'}
                        </p>
                        <p className="text-[11px] mt-1" style={{ color: '#8a8078' }}>
                          {projHrs > 0
                            ? pct > 100 ? 'over' : pct >= 85 ? 'approaching' : 'on track'
                            : 'no projection (no cost basis)'}
                        </p>
                      </div>
                    );
                  })()}
                  {/* Actual % of Cost
                      Reads as the answer to: "what percent would I plug
                      into the formula on future projects to project the
                      same PM hours THIS project actually used?"
                        = actual PM cost / total committed costs
                      Denominator is paid + pending (totalCommitted), NOT
                      the budgeted estimate. Across past projects this
                      number tells Nathan whether the 6% rule should
                      stay, go up, or come down. */}
                  {(() => {
                    const actualPct = detail.pmAnalysis.actualPctOfCost;
                    const assumedPct = detail.pmAnalysis.pctOfCost;
                    const basis = detail.pmAnalysis.actualPctBasis;
                    const variance = actualPct - assumedPct;
                    // Color follows the same convention as % of Projected:
                    // under the assumption is green, near it is amber,
                    // over is red. Threshold is +/- 1pp on either side of
                    // the assumed value for the amber zone.
                    const color = basis <= 0 ? '#8a8078'
                      : variance > 1 ? '#ef4444'
                      : variance >= -1 ? '#f59e0b'
                      : '#22c55e';
                    const subText = basis <= 0
                      ? 'no costs yet'
                      : variance > 0
                        ? `+${variance.toFixed(2)}pp vs ${assumedPct}% rule · of $${fmt(basis)} total costs`
                        : variance < 0
                          ? `${variance.toFixed(2)}pp vs ${assumedPct}% rule · of $${fmt(basis)} total costs`
                          : `at the ${assumedPct}% rule · of $${fmt(basis)} total costs`;
                    return (
                      <div className="rounded-lg p-3" style={{ background: 'rgba(200,140,0,0.04)', border: '1px solid rgba(200,140,0,0.1)' }}>
                        <p className="text-xs mb-1" style={{ color: '#8a8078' }}>Actual % of Cost</p>
                        <p className="text-xl font-bold" style={{ color }}>
                          {basis > 0 ? actualPct.toFixed(2) + '%' : '—'}
                        </p>
                        <p className="text-[11px] mt-1" style={{ color: '#8a8078' }}>{subText}</p>
                      </div>
                    );
                  })()}
                </div>

                {/* Breakdown by team member */}
                {detail.pmAnalysis.byUser.length > 0 && (
                  <div className="pt-3" style={{ borderTop: '1px solid rgba(200,140,0,0.1)' }}>
                    <div className="text-xs font-semibold mb-2" style={{ color: '#8a8078' }}>
                      Who's logging PM time
                    </div>
                    <div className="space-y-1.5">
                      {detail.pmAnalysis.byUser.map((u) => (
                        <div key={u.name} className="flex items-center gap-3 text-xs">
                          <span className="flex-1 truncate" style={{ color: '#1a1a1a' }}>{u.name}</span>
                          <span className="font-medium" style={{ color: '#c88c00' }}>{u.hours} hrs</span>
                          <span className="w-20 text-right" style={{ color: '#8a8078' }}>${fmt(u.cost)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {detail.pmAnalysis.actualHours === 0 && (
                  <div className="text-xs italic mt-2" style={{ color: '#8a8078' }}>
                    No PM time logged yet on this job.
                  </div>
                )}
              </div>
            )}

            {/* Documents */}
            <div
              className="rounded-lg p-4"
              style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
            >
              <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: '#1a1a1a' }}>
                <FileText size={14} style={{ color: '#c88c00' }} />
                Documents
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                {[
                  {
                    label: 'Proposals/COs',
                    items: detail.docSummary.customerOrders,
                    type: 'revenue',
                    // Only show approved customer orders total (the committed contract).
                    // Skip docs with "Exclude from Budget" toggled on in JT.
                    totalOverride: detail.docSummary.customerOrders
                      .filter((d: any) => d.status === 'approved' && d.includeInBudget !== false)
                      .reduce((s: number, d: any) => s + (d.price || 0), 0),
                    countOverride: detail.docSummary.customerOrders.filter((d: any) => d.status === 'approved' && d.includeInBudget !== false).length,
                    sublabel: 'approved',
                  },
                  {
                    label: 'Invoices',
                    items: detail.docSummary.customerInvoices,
                    type: 'revenue',
                    // Show sent (non-draft) invoice total; draft invoices noted separately.
                    // Skip invoices excluded from budget in JT.
                    totalOverride: detail.docSummary.customerInvoices
                      .filter((d: any) => d.status !== 'draft' && d.includeInBudget !== false)
                      .reduce((s: number, d: any) => s + (d.price || 0), 0),
                    countOverride: detail.docSummary.customerInvoices.filter((d: any) => d.status !== 'draft' && d.includeInBudget !== false).length,
                    sublabel: (() => {
                      const drafts = detail.docSummary.customerInvoices.filter((d: any) => d.status === 'draft' && d.includeInBudget !== false);
                      return drafts.length > 0 ? `sent · ${drafts.length} draft ($${fmt(drafts.reduce((s: number, d: any) => s + (d.price || 0), 0))})` : 'sent';
                    })(),
                  },
                  { label: 'Vendor Bills', items: detail.docSummary.vendorBills, type: 'cost' },
                  { label: 'Purchase Orders', items: detail.docSummary.vendorOrders, type: 'cost' },
                ].map((cat: any) => (
                  <div key={cat.label} className="p-2 rounded" style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}>
                    <p className="text-xs mb-1" style={{ color: '#8a8078' }}>{cat.label}</p>
                    <p className="text-lg font-bold" style={{ color: '#1a1a1a' }}>{cat.countOverride ?? cat.items.length}</p>
                    <p className="text-xs" style={{ color: '#8a8078' }}>
                      ${fmt(cat.totalOverride ?? cat.items.reduce((s: number, d: any) => s + (cat.type === 'cost' ? d.cost : d.price), 0))}
                      {cat.sublabel ? ` ${cat.sublabel}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm" style={{ color: '#8a8078' }}>Failed to load job details.</p>
        )}
      </div>
    );
  }

  // ============================================================
  // SUMMARY VIEW
  // ============================================================
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#c88c00', fontFamily: 'Georgia, serif' }}>
            Job Costing
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8a8078' }}>
            Budget vs. actual cost analysis across all active projects
          </p>
        </div>
        <button
          onClick={loadSummary}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm disabled:opacity-50"
          style={{ border: '1px solid rgba(200,140,0,0.15)', color: '#8a8078' }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 gap-3" style={{ color: '#8a8078' }}>
          <Loader2 size={24} className="animate-spin" />
          <span>Loading job cost data...</span>
        </div>
      ) : (
        <>
          {/* Portfolio KPI cards */}
          {totals && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-lg p-3" style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}>
                <p className="text-xs" style={{ color: '#8a8078' }}>Active Jobs</p>
                <p className="text-2xl font-bold" style={{ color: '#1a1a1a' }}>{totals.jobCount}</p>
              </div>
              <div className="rounded-lg p-3" style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}>
                <p className="text-xs" style={{ color: '#8a8078' }}>Total Contract</p>
                <p className="text-2xl font-bold" style={{ color: '#c88c00' }}>${fmt(totals.totalContractPrice || totals.totalEstimatedCost)}</p>
              </div>
              <div className="rounded-lg p-3" style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}>
                <p className="text-xs" style={{ color: '#8a8078' }}>Total Costs</p>
                <p className="text-2xl font-bold" style={{ color: (totals.totalCosts || totals.totalActualCost) > totals.totalEstimatedCost ? '#ef4444' : '#1a1a1a' }}>
                  ${fmt(totals.totalCosts || totals.totalActualCost)}
                </p>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                <p className="text-xs" style={{ color: '#ef4444' }}>Over Budget</p>
                <p className="text-2xl font-bold" style={{ color: '#ef4444' }}>{totals.jobsOverBudget}</p>
                <p className="text-xs" style={{ color: '#8a8078' }}>jobs</p>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.15)' }}>
                <p className="text-xs" style={{ color: '#eab308' }}>Watch List</p>
                <p className="text-2xl font-bold" style={{ color: '#eab308' }}>{totals.jobsOnWatch}</p>
                <p className="text-xs" style={{ color: '#8a8078' }}>jobs</p>
              </div>
            </div>
          )}

          {/* Search + filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#8a8078' }} />
              <input
                type="text"
                placeholder="Search job name, client, or number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
                style={{
                  background: '#ffffff',
                  border: '1px solid rgba(200,140,0,0.15)',
                  color: '#1a1a1a',
                }}
              />
            </div>
            <select
              value={filterHealth}
              onChange={(e) => setFilterHealth(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm"
              style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', color: '#1a1a1a' }}
            >
              <option value="all">All Health</option>
              <option value="over-budget">Over Budget</option>
              <option value="watch">Watch</option>
              <option value="on-track">On Track</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm"
              style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.15)', color: '#1a1a1a' }}
            >
              <option value="health">Sort by Health</option>
              <option value="variance">Sort by Variance</option>
              <option value="cost">Sort by Actual Cost</option>
              <option value="name">Sort by Name</option>
            </select>
          </div>

          {/* Kanban-style job cards: 4 columns by stage. On smaller viewports
              the columns stack (mobile: 1, tablet: 2, desktop: 4). Cards
              themselves are compact — meant to fit ~6-10 jobs per column at
              a glance. Click any card to drill into the detail view. */}
          {filteredJobs.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: '#8a8078' }}>
              No jobs match your filters.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {([
                { id: 'design', label: 'In Design' },
                { id: 'ready', label: 'Ready' },
                { id: 'production', label: 'In Production' },
                { id: 'final', label: 'Final Billing' },
              ] as const).map((col) => {
                const colJobs = jobsByBucket[col.id];
                return (
                  <div
                    key={col.id}
                    className="rounded-lg p-2"
                    style={{
                      background: 'rgba(201,168,76,0.04)',
                      border: '1px solid rgba(201,168,76,0.15)',
                    }}
                  >
                    {/* Column header */}
                    <div
                      className="px-2 py-1.5 mb-2 flex items-center justify-between text-xs font-semibold"
                      style={{
                        color: '#a06f00',
                        borderBottom: '1px solid rgba(200,140,0,0.2)',
                      }}
                    >
                      <span className="uppercase tracking-wide">{col.label}</span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: '#222', color: '#f0c060', fontWeight: 600 }}
                      >
                        {colJobs.length}
                      </span>
                    </div>

                    {/* Cards in this column */}
                    {colJobs.length === 0 ? (
                      <p className="text-xs italic px-2 py-3 text-center" style={{ color: '#8a8078' }}>
                        No jobs in this stage.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {colJobs.map((job) => {
                          const hc = healthColor(job.health);
                          const jobTotalCosts = job.totalCosts ?? job.actualCost;
                          const marginPct = job.marginPct ?? job.estimatedMarginPct ?? 0;
                          const overAmount = jobTotalCosts - job.estimatedCost;
                          // "Over budget" is a fixed-price-only concept.
                          // Cost-plus jobs don't have a budget to be over.
                          const isOverBudget = !job.isCostPlus && job.estimatedCost > 0 && overAmount > 0;
                          // Progress bar: fixed-price shows spend vs cost budget;
                          // cost-plus shows costs vs collections (cashflow pace).
                          const budgetPct = job.isCostPlus
                            ? (job.collectedAmount > 0
                                ? Math.min((jobTotalCosts / job.collectedAmount) * 100, 120)
                                : 0)
                            : (job.estimatedCost > 0
                                ? Math.min((jobTotalCosts / job.estimatedCost) * 100, 120)
                                : 0);
                          return (
                            <button
                              key={job.jobId}
                              onClick={() => loadDetail(job.jobId)}
                              className="w-full rounded-md p-2 text-left hover:bg-white/[0.04] transition-all"
                              style={{
                                background: hc.bg,
                                border: `1px solid ${hc.border}`,
                              }}
                            >
                              {/* Title row */}
                              <div className="flex items-center gap-1.5 mb-1">
                                <span
                                  className="text-xs font-bold truncate flex-1 min-w-0"
                                  style={{ color: '#1a1a1a' }}
                                  title={job.jobName}
                                >
                                  {job.jobName}
                                </span>
                                <span
                                  className="text-[10px] px-1 py-0.5 rounded shrink-0"
                                  style={{ background: '#222', color: '#f0c060', fontWeight: 600 }}
                                >
                                  #{job.jobNumber}
                                </span>
                              </div>

                              {/* Client + tags row */}
                              {(job.clientName || job.isCostPlus) && (
                                <div className="flex items-center gap-1.5 mb-1.5 text-[11px]" style={{ color: '#8a8078' }}>
                                  {job.clientName && (
                                    <span className="truncate flex-1 min-w-0" title={job.clientName}>
                                      {job.clientName}
                                    </span>
                                  )}
                                  {job.isCostPlus && (
                                    <span
                                      className="text-[10px] px-1 py-0.5 rounded shrink-0"
                                      style={{ background: 'rgba(79,70,229,0.10)', color: '#3730a3', fontWeight: 600 }}
                                    >
                                      Cost+
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Budget bar with % */}
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#333' }}>
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${Math.min(budgetPct, 100)}%`,
                                      background: budgetPct > 100 ? '#ef4444' : budgetPct > 85 ? '#eab308' : '#22c55e',
                                    }}
                                  />
                                </div>
                                <span className="text-[10px] w-9 text-right" style={{ color: hc.text, fontWeight: 600 }}>
                                  {Math.round(budgetPct)}%
                                </span>
                              </div>

                              {/* Single-line metric: margin% (or collected/costs for cost-plus) plus
                                  over-budget call-out when applicable. */}
                              <div className="flex items-center justify-between text-[11px]">
                                {job.isCostPlus ? (
                                  <span style={{ color: job.collectedAmount >= jobTotalCosts ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                                    ${fmt(job.collectedAmount)} / ${fmt(jobTotalCosts)}
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      color: marginPct > 15 ? '#22c55e' : marginPct > 5 ? '#eab308' : '#ef4444',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {fmtPct(marginPct)} margin
                                  </span>
                                )}
                                {isOverBudget && (
                                  <span style={{ color: '#ef4444', fontWeight: 600 }}>
                                    −${fmt(overAmount)} over
                                  </span>
                                )}
                              </div>

                              {/* Alerts (compact, max 2 visible) */}
                              {job.alerts.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {job.alerts.slice(0, 2).map((alert, i) => (
                                    <span
                                      key={i}
                                      className="text-[10px] px-1 py-0.5 rounded flex items-center gap-0.5"
                                      style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                                      title={alert}
                                    >
                                      <AlertTriangle size={8} />
                                      <span className="truncate max-w-[120px]">{alert}</span>
                                    </span>
                                  ))}
                                  {job.alerts.length > 2 && (
                                    <span className="text-[10px]" style={{ color: '#ef4444' }}>
                                      +{job.alerts.length - 2}
                                    </span>
                                  )}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Other-bucket jobs (statuses that didn't match any of the four
              kanban columns). Hidden by default but listed below so nothing
              silently disappears from the dashboard if a status changes. */}
          {jobsByBucket.other.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs cursor-pointer hover:underline" style={{ color: '#8a8078' }}>
                {jobsByBucket.other.length} job{jobsByBucket.other.length === 1 ? '' : 's'} in other stages — click to expand
              </summary>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {jobsByBucket.other.map((job) => {
                  const hc = healthColor(job.health);
                  return (
                    <button
                      key={job.jobId}
                      onClick={() => loadDetail(job.jobId)}
                      className="rounded-md p-2 text-left hover:bg-white/[0.04] transition-all"
                      style={{ background: hc.bg, border: `1px solid ${hc.border}` }}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs font-bold truncate flex-1" style={{ color: '#1a1a1a' }}>
                          {job.jobName}
                        </span>
                        <span className="text-[10px] px-1 py-0.5 rounded shrink-0" style={{ background: '#222', color: '#f0c060', fontWeight: 600 }}>
                          #{job.jobNumber}
                        </span>
                      </div>
                      <div className="text-[10px]" style={{ color: '#8a8078' }}>
                        {job.customStatus || 'No status'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

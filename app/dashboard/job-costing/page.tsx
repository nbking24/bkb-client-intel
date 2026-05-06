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
  async function loadDetail(jobId: string) {
    setSelectedJobId(jobId);
    setDetailLoading(true);
    setDetail(null);
    setExpandedCodes(new Set());
    setShowAllItems(new Set());
    try {
      const res = await fetch('/api/dashboard/job-costing/detail', {
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
              <span className="text-sm px-2 py-0.5 rounded" style={{ background: '#222', color: '#8a8078' }}>
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
            </div>

            {/* AI Analysis. Body text is dark so it reads on the page's
                near-white background; inline replacements inherit the body
                color (strong is just bolded, no color override). Headers stay
                gold to anchor the section visually. */}
            {detail.aiAnalysis && (
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
                </div>
                <div className="text-sm" style={{ color: '#1a1a1a', lineHeight: '1.7' }}
                  dangerouslySetInnerHTML={{
                    __html: detail.aiAnalysis
                      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                      .replace(/^### (.+)$/gm, '<div style="font-weight:600;color:#a06f00;margin-top:0.75rem">$1</div>')
                      .replace(/^## (.+)$/gm, '<div style="font-weight:600;color:#a06f00;margin-top:0.75rem">$1</div>')
                      .replace(/^# (.+)$/gm, '<div style="font-weight:700;color:#a06f00;margin-top:0.75rem;font-size:1rem">$1</div>')
                      .replace(/\n/g, '<br/>')
                  }}
                />
              </div>
            )}

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

            {/* Financial Summary Cards - Row 1: Budget overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                {
                  label: 'Contract Price',
                  value: '$' + fmt(detail.financialSummary.contractPrice || detail.financialSummary.estimatedPrice),
                  sub: detail.financialSummary.isCostPlus
                    ? 'Cost-Plus'
                    : `$${fmt(detail.financialSummary.estimatedCost)} internal cost budget`,
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
              ].map((card, i) => (
                <div
                  key={i}
                  className="rounded-lg p-3"
                  style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
                >
                  <p className="text-xs mb-1" style={{ color: '#8a8078' }}>{card.label}</p>
                  <p className="text-xl font-bold" style={{ color: card.color }}>{card.value}</p>
                  <p className="text-xs mt-1" style={{ color: card.color }}>{card.sub}</p>
                </div>
              ))}
            </div>

            {/* Financial Summary Cards - Row 2: Revenue & margin */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
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
                {
                  label: 'Schedule',
                  value: detail.financialSummary.scheduleProgress + '%',
                  sub: 'tasks complete',
                  color: detail.financialSummary.scheduleProgress >= 75 ? '#22c55e' : detail.financialSummary.scheduleProgress >= 25 ? '#c88c00' : '#8a8078',
                },
              ].map((card, i) => (
                <div
                  key={i}
                  className="rounded-lg p-3"
                  style={{ background: '#ffffff', border: '1px solid rgba(200,140,0,0.1)' }}
                >
                  <p className="text-xs mb-1" style={{ color: '#8a8078' }}>{card.label}</p>
                  <p className="text-xl font-bold" style={{ color: card.color }}>{card.value}</p>
                  <p className="text-xs mt-1" style={{ color: card.color }}>{card.sub}</p>
                </div>
              ))}
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
                  Budget from approved proposals · Actual from approved bills/POs · Pending from draft/pending bills/POs
                </p>
              </div>

              {/* Table header */}
              <div
                className="grid gap-2 px-4 py-2 text-xs font-medium"
                style={{
                  color: '#8a8078',
                  borderBottom: '1px solid rgba(200,140,0,0.06)',
                  gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 80px',
                }}
              >
                <div>Cost Code</div>
                <div className="text-right">Budgeted</div>
                <div className="text-right">Actual</div>
                <div className="text-right">Pending</div>
                <div className="text-right">Remaining</div>
                <div className="text-right">Status</div>
              </div>

              {/* Rows */}
              {detail.costCodeBreakdown.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs" style={{ color: '#8a8078' }}>
                  No cost code breakdown available. Budget totals are shown in summary cards above.
                </div>
              ) : (
                detail.costCodeBreakdown.map((cc) => {
                  const key = cc.costCodeNumber + cc.costCodeName;
                  const isExpanded = expandedCodes.has(key);
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
                          gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 80px',
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
                            style={{ background: '#222', color: '#8a8078' }}
                          >
                            {cc.costCodeNumber}
                          </span>
                          <span className="truncate" style={{ color: '#1a1a1a' }}>{cc.costCodeName}</span>
                        </div>
                        <div className="text-right" style={{ color: '#8a8078' }}>
                          ${fmt(cc.estimatedCost)}
                        </div>
                        <div className="text-right" style={{ color: '#1a1a1a' }}>
                          ${fmt(cc.actualCost)}
                        </div>
                        <div className="text-right" style={{ color: cc.pendingCost > 0 ? '#f59e0b' : '#555' }}>
                          {cc.pendingCost > 0 ? `$${fmt(cc.pendingCost)}` : '—'}
                        </div>
                        <div className="text-right" style={{
                          color: cc.remaining > 0 ? '#22c55e' : cc.remaining === 0 && cc.estimatedCost === 0 ? '#555' : '#ef4444'
                        }}>
                          {cc.estimatedCost > 0 || cc.committedCost > 0
                            ? `$${fmt(cc.remaining)}`
                            : '—'}
                        </div>
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
                              showAllItems, keyed on the row's cost code key). */}
                          {cc.topItems.length > 0 && (() => {
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

              {/* Totals row */}
              {detail.costCodeBreakdown.length > 0 && (
                <div
                  className="grid gap-2 px-4 py-3 text-sm font-bold"
                  style={{
                    borderTop: '1px solid rgba(200,140,0,0.15)',
                    background: 'rgba(201,168,76,0.04)',
                    gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 80px',
                  }}
                >
                  <div style={{ color: '#c88c00' }}>TOTAL</div>
                  <div className="text-right" style={{ color: '#8a8078' }}>
                    ${fmt(detail.financialSummary.estimatedCost)}
                  </div>
                  <div className="text-right" style={{ color: '#1a1a1a' }}>
                    ${fmt(detail.financialSummary.actualCost)}
                  </div>
                  <div className="text-right" style={{ color: detail.financialSummary.pendingCost > 0 ? '#f59e0b' : '#555' }}>
                    {detail.financialSummary.pendingCost > 0 ? `$${fmt(detail.financialSummary.pendingCost)}` : '—'}
                  </div>
                  <div className="text-right" style={{
                    color: detail.financialSummary.remainingBudget > 0 ? '#22c55e' : '#ef4444'
                  }}>
                    ${fmt(detail.financialSummary.remainingBudget)}
                  </div>
                  <div className="text-right text-xs" style={{ color: '#8a8078' }}>
                    {detail.financialSummary.estimatedCost > 0
                      ? Math.round((detail.financialSummary.actualCost / detail.financialSummary.estimatedCost) * 100) + '%'
                      : '—'}
                  </div>
                </div>
              )}
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

          {/* Job cards */}
          <div className="space-y-2">
            {filteredJobs.length === 0 ? (
              <p className="text-sm py-8 text-center" style={{ color: '#8a8078' }}>
                No jobs match your filters.
              </p>
            ) : (
              filteredJobs.map((job) => {
                const hc = healthColor(job.health);
                const jobTotalCosts = job.totalCosts ?? job.actualCost;
                const budgetPct = job.estimatedCost > 0 ? Math.min((jobTotalCosts / job.estimatedCost) * 100, 120) : 0;

                return (
                  <button
                    key={job.jobId}
                    onClick={() => loadDetail(job.jobId)}
                    className="w-full rounded-lg p-4 text-left hover:bg-white/[0.02] transition-all"
                    style={{
                      background: hc.bg,
                      border: `1px solid ${hc.border}`,
                    }}
                  >
                    <div className="flex items-start gap-4">
                      {/* Left: name + status */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold truncate" style={{ color: '#1a1a1a' }}>
                            {job.jobName}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: '#222', color: '#8a8078' }}>
                            #{job.jobNumber}
                          </span>
                          {job.isCostPlus && (
                            <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8' }}>
                              Cost+
                            </span>
                          )}
                          {job.customStatus && (job.customStatus.toLowerCase().includes('final billing') || job.customStatus.toLowerCase().includes('closed')) && (
                            <span className="text-xs px-1.5 py-0.5 rounded shrink-0 flex items-center gap-1" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
                              <CheckCircle size={10} />
                              Complete
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs" style={{ color: '#8a8078' }}>
                          {job.clientName && <span>{job.clientName}</span>}
                          {job.customStatus && (
                            <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(200,140,0,0.08)' }}>
                              {job.customStatus}
                            </span>
                          )}
                        </div>

                        {/* Budget bar */}
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#333' }}>
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(budgetPct, 100)}%`,
                                background: budgetPct > 100 ? '#ef4444' : budgetPct > 85 ? '#eab308' : '#22c55e',
                              }}
                            />
                          </div>
                          <span className="text-xs w-10 text-right" style={{ color: hc.text }}>
                            {Math.round(budgetPct)}%
                          </span>
                        </div>
                      </div>

                      {/* Right: key metrics */}
                      <div className="flex gap-6 shrink-0">
                        <div className="text-right">
                          <p className="text-xs" style={{ color: '#8a8078' }}>Contract / Costs</p>
                          <p className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
                            ${fmt(job.contractPrice ?? job.estimatedPrice ?? job.estimatedCost)} / ${fmt(jobTotalCosts)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs" style={{ color: '#8a8078' }}>
                            {job.isCostPlus ? 'Collected / Costs' : 'Margin'}
                          </p>
                          {job.isCostPlus ? (
                            <p className="text-sm font-medium" style={{
                              color: job.collectedAmount >= jobTotalCosts ? '#22c55e' : '#ef4444',
                            }}>
                              ${fmt(job.collectedAmount)} / ${fmt(jobTotalCosts)}
                            </p>
                          ) : (
                            <p
                              className="text-sm font-medium"
                              style={{
                                color: (job.marginPct ?? job.estimatedMarginPct ?? 0) > 15 ? '#22c55e' : (job.marginPct ?? job.estimatedMarginPct ?? 0) > 5 ? '#eab308' : '#ef4444',
                              }}
                            >
                              {fmtPct(job.marginPct ?? job.estimatedMarginPct ?? 0)}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-xs" style={{ color: '#8a8078' }}>Hours</p>
                          <p className="text-sm font-medium" style={{ color: '#1a1a1a' }}>
                            {job.actualHours}/{job.estimatedHours}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Alerts */}
                    {job.alerts.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {job.alerts.map((alert, i) => (
                          <span
                            key={i}
                            className="text-xs px-2 py-0.5 rounded flex items-center gap-1"
                            style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                          >
                            <AlertTriangle size={10} />
                            {alert}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

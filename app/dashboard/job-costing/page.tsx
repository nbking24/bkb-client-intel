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
  estimatedCost: number;
  estimatedPrice: number;
  estimatedMargin: number;
  estimatedMarginPct: number;
  actualCost: number;
  costVariance: number;
  costVariancePct: number;
  invoicedAmount: number;
  collectedAmount: number;
  estimatedHours: number;
  actualHours: number;
  hoursVariance: number;
  health: 'on-track' | 'watch' | 'over-budget';
  alerts: string[];
}

interface Totals {
  totalEstimatedCost: number;
  totalActualCost: number;
  totalEstimatedPrice: number;
  totalInvoiced: number;
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
  variance: number;
  pctUsed: number;
  status: string;
  itemCount: number;
  topItems: { name: string; cost: number; price: number; quantity: number }[];
}

interface TimeUser {
  name: string;
  work: number;
  travel: number;
  break_: number;
  total: number;
}

interface JobDetail {
  job: { id: string; name: string; number: string; clientName: string; priceType: string; customStatus: string };
  financialSummary: {
    estimatedCost: number;
    estimatedPrice: number;
    estimatedMargin: number;
    estimatedMarginPct: number;
    actualCost: number;
    costVariance: number;
    costVariancePct: number;
    projectedMargin: number;
    projectedMarginPct: number;
    contractValue: number;
    invoicedTotal: number;
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
      jobs.sort((a, b) => a.costVariance - b.costVariance); // most over-budget first
    } else if (sortBy === 'name') {
      jobs.sort((a, b) => a.jobName.localeCompare(b.jobName));
    } else if (sortBy === 'cost') {
      jobs.sort((a, b) => b.actualCost - a.actualCost);
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
          style={{ color: '#C9A84C' }}
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
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold" style={{ color: '#C9A84C', fontFamily: 'Georgia, serif' }}>
                {detail.job.name}
              </h1>
              <span className="text-sm px-2 py-0.5 rounded" style={{ background: '#222', color: '#8a8078' }}>
                #{detail.job.number}
              </span>
              {detail.job.clientName && (
                <span className="text-sm" style={{ color: '#8a8078' }}>
                  — {detail.job.clientName}
                </span>
              )}
            </div>

            {/* AI Analysis */}
            {detail.aiAnalysis && (
              <div
                className="rounded-lg p-4"
                style={{
                  background: 'rgba(201,168,76,0.04)',
                  border: '1px solid rgba(201,168,76,0.15)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 size={16} style={{ color: '#C9A84C' }} />
                  <span className="text-sm font-semibold" style={{ color: '#C9A84C' }}>AI Cost Analysis</span>
                </div>
                <div className="text-sm" style={{ color: '#d0c8c0', lineHeight: '1.7' }}
                  dangerouslySetInnerHTML={{
                    __html: detail.aiAnalysis
                      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#e8e0d8">$1</strong>')
                      .replace(/^### (.+)$/gm, '<div style="font-weight:600;color:#C9A84C;margin-top:0.75rem">$1</div>')
                      .replace(/^## (.+)$/gm, '<div style="font-weight:600;color:#C9A84C;margin-top:0.75rem">$1</div>')
                      .replace(/^# (.+)$/gm, '<div style="font-weight:600;color:#C9A84C;margin-top:0.75rem">$1</div>')
                      .replace(/\n/g, '<br/>')
                  }}
                />
              </div>
            )}

            {/* Financial Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                {
                  label: 'Estimated Cost',
                  value: '$' + fmt(detail.financialSummary.estimatedCost),
                  sub: 'Budget',
                  color: '#8a8078',
                },
                {
                  label: 'Actual Cost',
                  value: '$' + fmt(detail.financialSummary.actualCost),
                  sub: detail.financialSummary.costVariance >= 0
                    ? `$${fmt(detail.financialSummary.costVariance)} under`
                    : `$${fmt(Math.abs(detail.financialSummary.costVariance))} over`,
                  color: detail.financialSummary.costVariance >= 0 ? '#22c55e' : '#ef4444',
                },
                {
                  label: 'Projected Margin',
                  value: fmtPct(detail.financialSummary.projectedMarginPct),
                  sub: '$' + fmt(detail.financialSummary.projectedMargin),
                  color: detail.financialSummary.projectedMarginPct > 15 ? '#22c55e' : detail.financialSummary.projectedMarginPct > 5 ? '#eab308' : '#ef4444',
                },
                {
                  label: 'Invoiced / Contract',
                  value: '$' + fmt(detail.financialSummary.invoicedTotal),
                  sub: detail.financialSummary.contractValue > 0
                    ? `of $${fmt(detail.financialSummary.contractValue)}`
                    : 'No contract',
                  color: '#C9A84C',
                },
              ].map((card, i) => (
                <div
                  key={i}
                  className="rounded-lg p-3"
                  style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
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
              style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
            >
              <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(205,162,116,0.08)' }}>
                <h2 className="text-sm font-bold" style={{ color: '#e8e0d8' }}>
                  Cost Breakdown by Code
                </h2>
              </div>

              {/* Table header */}
              <div
                className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium"
                style={{ color: '#8a8078', borderBottom: '1px solid rgba(205,162,116,0.06)' }}
              >
                <div className="col-span-4">Cost Code</div>
                <div className="col-span-2 text-right">Estimated</div>
                <div className="col-span-2 text-right">Actual</div>
                <div className="col-span-2 text-right">Variance</div>
                <div className="col-span-2 text-right">% Used</div>
              </div>

              {/* Rows */}
              {detail.costCodeBreakdown.map((cc) => (
                <div key={cc.costCodeNumber + cc.costCodeName}>
                  <button
                    onClick={() => {
                      setExpandedCodes((prev) => {
                        const next = new Set(prev);
                        const key = cc.costCodeNumber + cc.costCodeName;
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                    }}
                    className="w-full grid grid-cols-12 gap-2 px-4 py-2.5 text-sm hover:bg-white/[0.02] transition-colors items-center"
                    style={{ borderBottom: '1px solid rgba(205,162,116,0.04)' }}
                  >
                    <div className="col-span-4 flex items-center gap-2 text-left">
                      {expandedCodes.has(cc.costCodeNumber + cc.costCodeName) ? (
                        <ChevronDown size={12} style={{ color: '#8a8078' }} />
                      ) : (
                        <ChevronRight size={12} style={{ color: '#8a8078' }} />
                      )}
                      <span
                        className="text-xs px-1 py-0.5 rounded font-mono"
                        style={{ background: '#222', color: '#8a8078' }}
                      >
                        {cc.costCodeNumber}
                      </span>
                      <span style={{ color: '#e8e0d8' }}>{cc.costCodeName}</span>
                    </div>
                    <div className="col-span-2 text-right" style={{ color: '#8a8078' }}>
                      ${fmt(cc.estimatedCost)}
                    </div>
                    <div className="col-span-2 text-right" style={{ color: '#e8e0d8' }}>
                      ${fmt(cc.actualCost)}
                    </div>
                    <div className="col-span-2 text-right" style={{ color: cc.variance >= 0 ? '#22c55e' : '#ef4444' }}>
                      {cc.variance >= 0 ? '+' : ''}${fmt(cc.variance)}
                    </div>
                    <div className="col-span-2 text-right flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: '#333' }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(cc.pctUsed, 100)}%`,
                            background: statusColor(cc.status),
                          }}
                        />
                      </div>
                      <span style={{ color: statusColor(cc.status) }}>{cc.pctUsed}%</span>
                    </div>
                  </button>

                  {/* Expanded: top items */}
                  {expandedCodes.has(cc.costCodeNumber + cc.costCodeName) && cc.topItems.length > 0 && (
                    <div className="px-4 pb-3 pt-1 ml-8">
                      {cc.topItems.map((item, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 py-1 text-xs"
                          style={{ color: '#8a8078' }}
                        >
                          <span className="flex-1" style={{ color: '#b0a898' }}>{item.name}</span>
                          <span>Qty: {item.quantity}</span>
                          <span>${fmt(item.cost)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Totals row */}
              <div
                className="grid grid-cols-12 gap-2 px-4 py-3 text-sm font-bold"
                style={{ borderTop: '1px solid rgba(205,162,116,0.15)', background: 'rgba(201,168,76,0.04)' }}
              >
                <div className="col-span-4" style={{ color: '#C9A84C' }}>TOTAL</div>
                <div className="col-span-2 text-right" style={{ color: '#8a8078' }}>
                  ${fmt(detail.financialSummary.estimatedCost)}
                </div>
                <div className="col-span-2 text-right" style={{ color: '#e8e0d8' }}>
                  ${fmt(detail.financialSummary.actualCost)}
                </div>
                <div
                  className="col-span-2 text-right"
                  style={{ color: detail.financialSummary.costVariance >= 0 ? '#22c55e' : '#ef4444' }}
                >
                  {detail.financialSummary.costVariance >= 0 ? '+' : ''}${fmt(detail.financialSummary.costVariance)}
                </div>
                <div className="col-span-2 text-right" style={{ color: '#8a8078' }}>
                  {detail.financialSummary.estimatedCost > 0
                    ? Math.round((detail.financialSummary.actualCost / detail.financialSummary.estimatedCost) * 100) + '%'
                    : '—'}
                </div>
              </div>
            </div>

            {/* Time Analysis */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Hours summary */}
              <div
                className="rounded-lg p-4"
                style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
              >
                <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: '#e8e0d8' }}>
                  <Clock size={14} style={{ color: '#C9A84C' }} />
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
                    <span className="text-sm font-medium" style={{ color: '#e8e0d8' }}>
                      {detail.timeAnalysis.actualWorkHours} hrs
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: '#8a8078' }}>Travel</span>
                    <span className="text-sm font-medium" style={{ color: '#b0a898' }}>
                      {detail.timeAnalysis.actualTravelHours} hrs
                    </span>
                  </div>
                  <div
                    className="flex justify-between items-center pt-2"
                    style={{ borderTop: '1px solid rgba(205,162,116,0.1)' }}
                  >
                    <span className="text-xs font-medium" style={{ color: '#C9A84C' }}>Variance</span>
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
                style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
              >
                <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: '#e8e0d8' }}>
                  <Users size={14} style={{ color: '#C9A84C' }} />
                  Hours by Team Member
                </h2>

                {detail.timeAnalysis.byUser.length === 0 ? (
                  <p className="text-xs" style={{ color: '#8a8078' }}>No time entries logged.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.timeAnalysis.byUser.map((user) => (
                      <div key={user.name} className="flex items-center gap-2">
                        <span className="text-xs flex-1 truncate" style={{ color: '#e8e0d8' }}>
                          {user.name}
                        </span>
                        <span className="text-xs" style={{ color: '#8a8078' }}>
                          {user.work}w
                        </span>
                        {user.travel > 0 && (
                          <span className="text-xs" style={{ color: '#6a6058' }}>
                            {user.travel}t
                          </span>
                        )}
                        <span className="text-xs font-medium w-12 text-right" style={{ color: '#C9A84C' }}>
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
              style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}
            >
              <h2 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: '#e8e0d8' }}>
                <FileText size={14} style={{ color: '#C9A84C' }} />
                Documents
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                {[
                  { label: 'Proposals/COs', items: detail.docSummary.customerOrders, type: 'revenue' },
                  { label: 'Invoices', items: detail.docSummary.customerInvoices, type: 'revenue' },
                  { label: 'Vendor Bills', items: detail.docSummary.vendorBills, type: 'cost' },
                  { label: 'Purchase Orders', items: detail.docSummary.vendorOrders, type: 'cost' },
                ].map((cat) => (
                  <div key={cat.label} className="p-2 rounded" style={{ background: '#0d0d0d' }}>
                    <p className="text-xs mb-1" style={{ color: '#8a8078' }}>{cat.label}</p>
                    <p className="text-lg font-bold" style={{ color: '#e8e0d8' }}>{cat.items.length}</p>
                    <p className="text-xs" style={{ color: '#8a8078' }}>
                      ${fmt(cat.items.reduce((s, d) => s + (cat.type === 'cost' ? d.cost : d.price), 0))}
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
          <h1 className="text-2xl font-bold" style={{ color: '#C9A84C', fontFamily: 'Georgia, serif' }}>
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
          style={{ border: '1px solid rgba(205,162,116,0.15)', color: '#8a8078' }}
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
              <div className="rounded-lg p-3" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}>
                <p className="text-xs" style={{ color: '#8a8078' }}>Active Jobs</p>
                <p className="text-2xl font-bold" style={{ color: '#e8e0d8' }}>{totals.jobCount}</p>
              </div>
              <div className="rounded-lg p-3" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}>
                <p className="text-xs" style={{ color: '#8a8078' }}>Total Budget</p>
                <p className="text-2xl font-bold" style={{ color: '#e8e0d8' }}>${fmt(totals.totalEstimatedCost)}</p>
              </div>
              <div className="rounded-lg p-3" style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.1)' }}>
                <p className="text-xs" style={{ color: '#8a8078' }}>Total Actual</p>
                <p className="text-2xl font-bold" style={{ color: totals.totalActualCost > totals.totalEstimatedCost ? '#ef4444' : '#e8e0d8' }}>
                  ${fmt(totals.totalActualCost)}
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
                  background: '#1a1a1a',
                  border: '1px solid rgba(205,162,116,0.15)',
                  color: '#e8e0d8',
                }}
              />
            </div>
            <select
              value={filterHealth}
              onChange={(e) => setFilterHealth(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm"
              style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', color: '#e8e0d8' }}
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
              style={{ background: '#1a1a1a', border: '1px solid rgba(205,162,116,0.15)', color: '#e8e0d8' }}
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
                const budgetPct = job.estimatedCost > 0 ? Math.min((job.actualCost / job.estimatedCost) * 100, 120) : 0;

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
                          <span className="text-sm font-bold truncate" style={{ color: '#e8e0d8' }}>
                            {job.jobName}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: '#222', color: '#8a8078' }}>
                            #{job.jobNumber}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs" style={{ color: '#8a8078' }}>
                          {job.clientName && <span>{job.clientName}</span>}
                          {job.customStatus && (
                            <span className="px-1.5 py-0.5 rounded" style={{ background: 'rgba(205,162,116,0.08)' }}>
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
                          <p className="text-xs" style={{ color: '#8a8078' }}>Budget / Actual</p>
                          <p className="text-sm font-medium" style={{ color: '#e8e0d8' }}>
                            ${fmt(job.estimatedCost)} / ${fmt(job.actualCost)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs" style={{ color: '#8a8078' }}>Margin</p>
                          <p
                            className="text-sm font-medium"
                            style={{
                              color: job.estimatedMarginPct > 15 ? '#22c55e' : job.estimatedMarginPct > 5 ? '#eab308' : '#ef4444',
                            }}
                          >
                            {fmtPct(job.estimatedMarginPct)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs" style={{ color: '#8a8078' }}>Hours</p>
                          <p className="text-sm font-medium" style={{ color: '#e8e0d8' }}>
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

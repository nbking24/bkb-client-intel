'use client';

import { useState, useEffect } from 'react';
import {
  DollarSign, AlertTriangle, Clock, CheckCircle2,
  RefreshCw, Loader2, FileText, TrendingUp,
  Calendar, AlertCircle, ChevronDown, ChevronRight,
} from 'lucide-react';

// ============================================================
// Types (mirror the API response)
// ============================================================

type InvoicingHealth = 'healthy' | 'warning' | 'overdue' | 'critical';

interface InvoicingSummaryStats {
  totalOpenJobs: number;
  contractJobs: number;
  costPlusJobs: number;
  totalAlerts: number;
  totalUnbilledAmount: number;
  overallHealth: InvoicingHealth;
}

interface MilestoneInfo {
  taskId: string;
  taskName: string;
  endDate: string | null;
  daysUntilDue: number | null;
  isOverdue: boolean;
  linkedInvoiceId: string | null;
  amount: number | null;
}

interface DraftInvoiceInfo {
  documentId: string;
  documentName: string;
  amount: number;
  createdAt: string;
  isLinkedToTask: boolean;
}

interface ContractJobHealth {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  priceType: string;
  totalContractValue: number;
  invoicedToDate: number;
  invoicedPercent: number;
  scheduleProgress: number;
  nextMilestone: MilestoneInfo | null;
  overdueMilestones: MilestoneInfo[];
  draftInvoices: DraftInvoiceInfo[];
  health: InvoicingHealth;
  alerts: string[];
}

interface CostPlusJobHealth {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  lastInvoiceDate: string | null;
  daysSinceLastInvoice: number | null;
  unbilledCosts: number;
  unbilledHours: number;
  unbilledAmount: number;
  invoiceCount: number;
  totalInvoiced: number;
  health: InvoicingHealth;
  alerts: string[];
}

interface BillableItem {
  costItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  costGroupName: string;
  onDocument: boolean;
  documentName: string | null;
}

interface BillableHourEntry {
  timeEntryId: string;
  userName: string;
  hours: number;
  date: string;
  notes: string | null;
  costItemName: string | null;
}

interface BillableItemsSummary {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  priceType: string;
  uninvoicedItems: BillableItem[];
  uninvoicedHours: BillableHourEntry[];
  totalUninvoicedAmount: number;
  totalUninvoicedHours: number;
}

interface InvoicingReport {
  generatedAt: string;
  summary: InvoicingSummaryStats;
  contractJobs: ContractJobHealth[];
  costPlusJobs: CostPlusJobHealth[];
  billableItems: BillableItemsSummary[];
  alerts: string[];
  _cached?: boolean;
  _cachedAt?: string;
  _analysisTimeMs?: number;
  // Agent analysis (from cached agent report)
  agentSummary?: string;
  agentRecommendations?: Array<{ action: string; description: string; priority: string }>;
}

// ============================================================
// Style Constants
// ============================================================

const HEALTH_COLORS: Record<InvoicingHealth, { bg: string; text: string; dot: string; label: string }> = {
  healthy: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e', dot: '#22c55e', label: 'Healthy' },
  warning: { bg: 'rgba(234,179,8,0.15)', text: '#eab308', dot: '#eab308', label: 'Warning' },
  overdue: { bg: 'rgba(249,115,22,0.15)', text: '#f97316', dot: '#f97316', label: 'Overdue' },
  critical: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444', dot: '#ef4444', label: 'Critical' },
};

const CARD_STYLE = {
  background: '#242424',
  border: '1px solid rgba(205,162,116,0.08)',
  borderRadius: '12px',
};

// ============================================================
// Helper Components
// ============================================================

function HealthBadge({ health }: { health: InvoicingHealth }) {
  const cfg = HEALTH_COLORS[health];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ background: cfg.bg, color: cfg.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  color,
}: {
  icon: any;
  label: string;
  value: string | number;
  subtext?: string;
  color: string;
}) {
  return (
    <div className="p-4 rounded-xl" style={CARD_STYLE}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} style={{ color }} />
        <span className="text-xs font-medium" style={{ color: '#8a8078' }}>
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      {subtext && (
        <div className="text-xs mt-1" style={{ color: '#8a8078' }}>{subtext}</div>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  count,
  icon: Icon,
  expanded,
  onToggle,
}: {
  title: string;
  count: number;
  icon: any;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 py-3 px-1 text-left hover:opacity-80 transition-opacity"
    >
      <Icon size={18} style={{ color: '#CDA274' }} />
      <span className="text-base font-semibold" style={{ color: '#e8e0d8' }}>
        {title}
      </span>
      <span
        className="px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ background: 'rgba(205,162,116,0.1)', color: '#CDA274' }}
      >
        {count}
      </span>
      <span className="ml-auto">
        {expanded ? (
          <ChevronDown size={16} style={{ color: '#8a8078' }} />
        ) : (
          <ChevronRight size={16} style={{ color: '#8a8078' }} />
        )}
      </span>
    </button>
  );
}

function formatDate(d: string | null) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(amount);
}

// ============================================================
// Contract Jobs Section
// ============================================================

function ContractJobCard({ job }: { job: ContractJobHealth }) {
  return (
    <div className="p-4 rounded-xl" style={CARD_STYLE}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate" style={{ color: '#e8e0d8' }}>
              {job.jobName}
            </span>
            <HealthBadge health={job.health} />
          </div>
          <span className="text-xs" style={{ color: '#8a8078' }}>
            {job.clientName} • #{job.jobNumber}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1" style={{ color: '#8a8078' }}>
          <span>Schedule Progress</span>
          <span>{Math.round(job.scheduleProgress * 100)}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1a1a1a' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.round(job.scheduleProgress * 100)}%`,
              background: 'linear-gradient(90deg, #CDA274, #C9A84C)',
            }}
          />
        </div>
      </div>

      {/* Invoice stats */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="text-xs">
          <span style={{ color: '#8a8078' }}>Approved Invoices</span>
          <div className="text-sm font-medium" style={{ color: '#e8e0d8' }}>{job.invoicedToDate}</div>
        </div>
        <div className="text-xs">
          <span style={{ color: '#8a8078' }}>Draft Invoices</span>
          <div className="text-sm font-medium" style={{ color: job.draftInvoices.length > 0 ? '#eab308' : '#e8e0d8' }}>
            {job.draftInvoices.length}
          </div>
        </div>
      </div>

      {/* Next milestone */}
      {job.nextMilestone && (
        <div className="p-2 rounded-lg text-xs" style={{ background: '#1a1a1a' }}>
          <span style={{ color: '#8a8078' }}>Next Milestone:</span>{' '}
          <span style={{ color: '#e8e0d8' }}>{job.nextMilestone.taskName}</span>
          {job.nextMilestone.endDate && (
            <span style={{ color: '#8a8078' }}> — {formatDate(job.nextMilestone.endDate)}</span>
          )}
        </div>
      )}

      {/* Overdue milestones */}
      {job.overdueMilestones.length > 0 && (
        <div className="mt-2 p-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.08)' }}>
          <div className="flex items-center gap-1 mb-1" style={{ color: '#ef4444' }}>
            <AlertTriangle size={12} />
            <span className="font-medium">Overdue Milestones</span>
          </div>
          {job.overdueMilestones.map((m) => (
            <div key={m.taskId} style={{ color: '#ef4444' }}>
              {m.taskName} — {Math.abs(m.daysUntilDue ?? 0)}d overdue
            </div>
          ))}
        </div>
      )}

      {/* Alerts */}
      {job.alerts.length > 0 && (
        <div className="mt-2 space-y-1">
          {job.alerts.map((alert, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs" style={{ color: '#f97316' }}>
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{alert}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Cost Plus Jobs Section
// ============================================================

function CostPlusJobCard({ job }: { job: CostPlusJobHealth }) {
  return (
    <div className="p-4 rounded-xl" style={CARD_STYLE}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate" style={{ color: '#e8e0d8' }}>
              {job.jobName}
            </span>
            <HealthBadge health={job.health} />
          </div>
          <span className="text-xs" style={{ color: '#8a8078' }}>
            {job.clientName} • #{job.jobNumber}
          </span>
        </div>
      </div>

      {/* Billing cadence indicator */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1" style={{ color: '#8a8078' }}>
          <span>Days Since Last Invoice</span>
          <span style={{ color: (job.daysSinceLastInvoice ?? 0) > 14 ? '#ef4444' : (job.daysSinceLastInvoice ?? 0) > 10 ? '#eab308' : '#22c55e' }}>
            {job.daysSinceLastInvoice !== null ? `${job.daysSinceLastInvoice}d` : 'Never'}
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1a1a1a' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, ((job.daysSinceLastInvoice ?? 0) / 28) * 100)}%`,
              background:
                (job.daysSinceLastInvoice ?? 0) > 14
                  ? '#ef4444'
                  : (job.daysSinceLastInvoice ?? 0) > 10
                  ? '#eab308'
                  : '#22c55e',
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] mt-0.5" style={{ color: '#666' }}>
          <span>0d</span>
          <span>14d cadence</span>
          <span>28d</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center p-2 rounded-lg" style={{ background: '#1a1a1a' }}>
          <div className="text-xs" style={{ color: '#8a8078' }}>Unbilled $</div>
          <div className="text-sm font-bold" style={{ color: job.unbilledAmount > 0 ? '#eab308' : '#e8e0d8' }}>
            {formatCurrency(job.unbilledAmount)}
          </div>
        </div>
        <div className="text-center p-2 rounded-lg" style={{ background: '#1a1a1a' }}>
          <div className="text-xs" style={{ color: '#8a8078' }}>Unbilled Hrs</div>
          <div className="text-sm font-bold" style={{ color: job.unbilledHours > 0 ? '#eab308' : '#e8e0d8' }}>
            {job.unbilledHours}h
          </div>
        </div>
        <div className="text-center p-2 rounded-lg" style={{ background: '#1a1a1a' }}>
          <div className="text-xs" style={{ color: '#8a8078' }}>Invoices</div>
          <div className="text-sm font-bold" style={{ color: '#e8e0d8' }}>
            {job.invoiceCount}
          </div>
        </div>
      </div>

      {/* Last invoice date */}
      {job.lastInvoiceDate && (
        <div className="text-xs" style={{ color: '#8a8078' }}>
          Last invoice: {formatDate(job.lastInvoiceDate)}
        </div>
      )}

      {/* Alerts */}
      {job.alerts.length > 0 && (
        <div className="mt-2 space-y-1">
          {job.alerts.map((alert, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs" style={{ color: '#f97316' }}>
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{alert}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Billable Items Section
// ============================================================

function BillableItemsCard({ summary }: { summary: BillableItemsSummary }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="p-4 rounded-xl" style={CARD_STYLE}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start justify-between text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate" style={{ color: '#e8e0d8' }}>
              {summary.jobName}
            </span>
            <span
              className="px-2 py-0.5 rounded-full text-xs"
              style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308' }}
            >
              {formatCurrency(summary.totalUninvoicedAmount)}
            </span>
          </div>
          <span className="text-xs" style={{ color: '#8a8078' }}>
            {summary.clientName} • #{summary.jobNumber} • {summary.uninvoicedItems.length} items, {summary.totalUninvoicedHours.toFixed(1)}h
          </span>
        </div>
        {expanded ? <ChevronDown size={16} style={{ color: '#8a8078' }} /> : <ChevronRight size={16} style={{ color: '#8a8078' }} />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {summary.uninvoicedItems.length > 0 && (
            <div>
              <div className="text-xs font-medium mb-1" style={{ color: '#CDA274' }}>Uninvoiced Items</div>
              {summary.uninvoicedItems.map((item) => (
                <div key={item.costItemId} className="flex justify-between text-xs py-1" style={{ borderBottom: '1px solid rgba(205,162,116,0.06)' }}>
                  <span style={{ color: '#e8e0d8' }}>{item.name}</span>
                  <span style={{ color: '#eab308' }}>{formatCurrency(item.totalPrice)}</span>
                </div>
              ))}
            </div>
          )}
          {summary.uninvoicedHours.length > 0 && (
            <div>
              <div className="text-xs font-medium mb-1" style={{ color: '#CDA274' }}>Uninvoiced Hours</div>
              {summary.uninvoicedHours.map((entry) => (
                <div key={entry.timeEntryId} className="flex justify-between text-xs py-1" style={{ borderBottom: '1px solid rgba(205,162,116,0.06)' }}>
                  <span style={{ color: '#e8e0d8' }}>{entry.userName} — {entry.hours}h</span>
                  <span style={{ color: '#8a8078' }}>{entry.date}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Agent Recommendations Section
// ============================================================

function AgentSection({ report }: { report: InvoicingReport }) {
  if (!report.agentSummary && (!report.agentRecommendations || report.agentRecommendations.length === 0)) {
    return null;
  }

  return (
    <div className="space-y-3">
      {report.agentSummary && (
        <div className="p-4 rounded-xl" style={{ ...CARD_STYLE, border: '1px solid rgba(201,168,76,0.2)' }}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} style={{ color: '#C9A84C' }} />
            <span className="text-sm font-semibold" style={{ color: '#C9A84C' }}>Agent Summary</span>
          </div>
          <p className="text-sm" style={{ color: '#e8e0d8', lineHeight: 1.6 }}>
            {report.agentSummary}
          </p>
        </div>
      )}

      {report.agentRecommendations && report.agentRecommendations.length > 0 && (
        <div className="space-y-2">
          {report.agentRecommendations.map((rec, i) => (
            <div key={i} className="p-3 rounded-xl" style={CARD_STYLE}>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold"
                  style={{
                    background: rec.priority === 'high' ? 'rgba(239,68,68,0.2)' : rec.priority === 'medium' ? 'rgba(234,179,8,0.2)' : 'rgba(34,197,94,0.2)',
                    color: rec.priority === 'high' ? '#ef4444' : rec.priority === 'medium' ? '#eab308' : '#22c55e',
                  }}
                >
                  {i + 1}
                </span>
                <span className="text-sm font-medium" style={{ color: '#e8e0d8' }}>{rec.action}</span>
              </div>
              <p className="text-xs ml-7" style={{ color: '#8a8078' }}>{rec.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Page Component
// ============================================================

export default function InvoicingDashboard() {
  const [report, setReport] = useState<InvoicingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Sections expand/collapse
  const [contractExpanded, setContractExpanded] = useState(true);
  const [costPlusExpanded, setCostPlusExpanded] = useState(true);
  const [billableExpanded, setBillableExpanded] = useState(true);

  async function fetchReport(refresh = false) {
    try {
      if (refresh) setRefreshing(true);
      else setLoading(true);

      const url = refresh
        ? '/api/dashboard/invoicing?refresh=true'
        : '/api/dashboard/invoicing?cached=true';

      const res = await fetch(url);
      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json();
      setReport(data);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load invoicing data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchReport();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3" style={{ color: '#8a8078' }}>
          <Loader2 size={24} className="animate-spin" />
          <span>Loading invoicing health data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle size={32} style={{ color: '#ef4444' }} className="mx-auto mb-2" />
          <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
          <button
            onClick={() => fetchReport()}
            className="mt-3 px-4 py-2 rounded-lg text-sm"
            style={{ background: 'rgba(205,162,116,0.1)', color: '#CDA274' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!report) return null;

  const { summary } = report;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: '#e8e0d8' }}>
            Invoicing Health
          </h1>
          <p className="text-xs mt-1" style={{ color: '#8a8078' }}>
            {report._cached
              ? `Cached ${formatDate(report._cachedAt || report.generatedAt)}`
              : `Updated ${formatDate(report.generatedAt)}`
            }
          </p>
        </div>
        <button
          onClick={() => fetchReport(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-white/5"
          style={{ border: '1px solid rgba(205,162,116,0.2)', color: '#CDA274' }}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={FileText}
          label="Open Jobs"
          value={summary.totalOpenJobs}
          subtext={`${summary.contractJobs} contract, ${summary.costPlusJobs} cost-plus`}
          color="#CDA274"
        />
        <StatCard
          icon={AlertTriangle}
          label="Alerts"
          value={summary.totalAlerts}
          color={summary.totalAlerts > 0 ? '#ef4444' : '#22c55e'}
        />
        <StatCard
          icon={DollarSign}
          label="Unbilled Total"
          value={formatCurrency(summary.totalUnbilledAmount)}
          color={summary.totalUnbilledAmount > 0 ? '#eab308' : '#22c55e'}
        />
        <StatCard
          icon={CheckCircle2}
          label="Overall Health"
          value={HEALTH_COLORS[summary.overallHealth].label}
          color={HEALTH_COLORS[summary.overallHealth].text}
        />
      </div>

      {/* Global Alerts */}
      {report.alerts.length > 0 && (
        <div className="p-4 rounded-xl" style={{ ...CARD_STYLE, border: '1px solid rgba(239,68,68,0.2)' }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} style={{ color: '#ef4444' }} />
            <span className="text-sm font-semibold" style={{ color: '#ef4444' }}>
              Active Alerts ({report.alerts.length})
            </span>
          </div>
          <div className="space-y-1">
            {report.alerts.slice(0, 10).map((alert, i) => (
              <div key={i} className="text-xs" style={{ color: '#f97316' }}>
                {alert}
              </div>
            ))}
            {report.alerts.length > 10 && (
              <div className="text-xs" style={{ color: '#8a8078' }}>
                +{report.alerts.length - 10} more alerts
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agent Recommendations */}
      <AgentSection report={report} />

      {/* Contract Jobs */}
      {report.contractJobs.length > 0 && (
        <div>
          <SectionHeader
            title="Contract (Fixed-Price) Jobs"
            count={report.contractJobs.length}
            icon={FileText}
            expanded={contractExpanded}
            onToggle={() => setContractExpanded(!contractExpanded)}
          />
          {contractExpanded && (
            <div className="grid gap-3 md:grid-cols-2">
              {report.contractJobs.map((job) => (
                <ContractJobCard key={job.jobId} job={job} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cost Plus Jobs */}
      {report.costPlusJobs.length > 0 && (
        <div>
          <SectionHeader
            title="Cost Plus Jobs"
            count={report.costPlusJobs.length}
            icon={Clock}
            expanded={costPlusExpanded}
            onToggle={() => setCostPlusExpanded(!costPlusExpanded)}
          />
          {costPlusExpanded && (
            <div className="grid gap-3 md:grid-cols-2">
              {report.costPlusJobs.map((job) => (
                <CostPlusJobCard key={job.jobId} job={job} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Billable Items */}
      {report.billableItems.length > 0 && (
        <div>
          <SectionHeader
            title="Billable Items Pending"
            count={report.billableItems.length}
            icon={DollarSign}
            expanded={billableExpanded}
            onToggle={() => setBillableExpanded(!billableExpanded)}
          />
          {billableExpanded && (
            <div className="space-y-3">
              {report.billableItems.map((summary) => (
                <BillableItemsCard key={summary.jobId} summary={summary} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {report.contractJobs.length === 0 && report.costPlusJobs.length === 0 && report.billableItems.length === 0 && (
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <CheckCircle2 size={32} style={{ color: '#22c55e' }} className="mx-auto mb-2" />
            <p className="text-sm" style={{ color: '#8a8078' }}>All invoicing is up to date</p>
          </div>
        </div>
      )}
    </div>
  );
}

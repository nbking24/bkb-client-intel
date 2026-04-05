'use client';

import { useState, useEffect } from 'react';
import {
  DollarSign, AlertTriangle, Clock, CheckCircle2,
  RefreshCw, Loader2, FileText, TrendingUp,
  Calendar, AlertCircle, ChevronDown, ChevronRight,
  Search, X, Plus, Check, Send, PauseCircle, PlayCircle,
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
  totalUnbilledHours: number;
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
  documentSubject: string | null;
  amount: number;
  createdAt: string;
  isLinkedToTask: boolean;
}

interface PendingInvoiceInfo {
  documentId: string;
  documentSubject: string | null;
  documentNumber: string;
  amount: number;
  createdAt: string;
  daysPending: number;
}

interface ReleasedInvoiceInfo {
  documentId: string;
  documentName: string;
  documentSubject: string | null;
  documentNumber: string;
  amount: number;
  createdAt: string;
  status: 'paid' | 'open';
}

interface ContractJobHealth {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  customStatus: string | null;
  priceType: string;
  totalContractValue: number;
  invoicedToDate: number;
  invoicedPercent: number;
  scheduleProgress: number;
  nextMilestone: MilestoneInfo | null;
  overdueMilestones: MilestoneInfo[];
  approachingMilestones: MilestoneInfo[];
  unmatchedDraftInvoices: DraftInvoiceInfo[];
  draftInvoices: DraftInvoiceInfo[];
  releasedInvoices: ReleasedInvoiceInfo[];
  pendingInvoices: PendingInvoiceInfo[];
  uninvoicedBillableAmount: number;
  unbilledLaborHours: number;
  // Change Order awareness
  approvedCOValue?: number;
  totalContractAndCOValue?: number;
  unbilledCOAmount?: number;
  appliedCOsCount?: number;
  health: InvoicingHealth;
  alerts: string[];
}

interface CostPlusJobHealth {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  customStatus: string | null;
  lastInvoiceDate: string | null;
  daysSinceLastInvoice: number | null;
  unbilledCosts: number;
  unbilledHours: number;
  unbilledAmount: number;
  invoiceCount: number;
  totalInvoiced: number;
  draftInvoices: DraftInvoiceInfo[];
  releasedInvoices: ReleasedInvoiceInfo[];
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
  customStatus: string | null;
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

// Health priority order for sorting — critical jobs surface first
const HEALTH_PRIORITY: Record<InvoicingHealth, number> = {
  critical: 0,
  overdue: 1,
  warning: 2,
  healthy: 3,
};

function sortByHealthPriority<T extends { health: InvoicingHealth }>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => HEALTH_PRIORITY[a.health] - HEALTH_PRIORITY[b.health]);
}

// Status categories — maps JT custom "Status" values to dashboard groupings (kept for reference)
const STATUS_CATEGORIES = [
  { key: 'in-design', label: 'In-Design', statusValue: '5. Design Phase' },
  { key: 'ready', label: 'Ready', statusValue: '10. Ready' },
  { key: 'in-production', label: 'In-Production', statusValue: '6. In Production' },
  { key: 'final-billing', label: 'Final Billing', statusValue: '7. Final Billing' },
  { key: 'other', label: 'Other', statusValue: null },
] as const;

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

function formatDateTime(d: string | null) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(amount);
}

function formatCurrencyExact(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount);
}

// ============================================================
// Create $ Task Button for Unmatched Draft Invoices
// ============================================================

function CreateTaskRow({ jobId, draft }: { jobId: string; draft: DraftInvoiceInfo }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleCreate = async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/dashboard/invoicing/create-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, documentName: draft.documentName, documentSubject: draft.documentSubject }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setStatus('done');
      setMessage(data.alreadyExists ? 'Already exists' : 'Created');
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || 'Failed');
    }
  };

  return (
    <div className="flex items-center gap-1.5 text-[11px] py-0.5" style={{ color: '#eab308' }}>
      <AlertCircle size={10} className="flex-shrink-0" />
      <span className="truncate">{draft.documentSubject || draft.documentName} — missing $ task</span>
      {status === 'idle' && (
        <button
          onClick={handleCreate}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ml-auto flex-shrink-0 transition-colors"
          style={{ background: '#3b3028', color: '#e8e0d8', border: '1px solid #4a3f35' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#4a3f35'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#3b3028'; }}
        >
          <Plus size={9} /> Create
        </button>
      )}
      {status === 'loading' && (
        <Loader2 size={10} className="ml-auto flex-shrink-0 animate-spin" style={{ color: '#8a8078' }} />
      )}
      {status === 'done' && (
        <span className="flex items-center gap-0.5 ml-auto flex-shrink-0 text-[10px]" style={{ color: '#22c55e' }}>
          <Check size={9} /> {message}
        </span>
      )}
      {status === 'error' && (
        <span className="ml-auto flex-shrink-0 text-[10px]" style={{ color: '#ef4444' }}>
          {message}
        </span>
      )}
    </div>
  );
}

// ============================================================
// Collapsible Draft Invoices List
// ============================================================

function InvoiceDetails({ drafts, released }: { drafts: DraftInvoiceInfo[]; released: ReleasedInvoiceInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasDrafts = drafts && drafts.length > 0;
  const hasReleased = released && released.length > 0;
  if (!hasDrafts && !hasReleased) return null;

  const totalCount = (drafts?.length || 0) + (released?.length || 0);

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[11px] hover:opacity-80 transition-opacity"
        style={{ color: '#CDA274' }}
      >
        {expanded ? <ChevronDown size={10} /> : <Plus size={10} />}
        <FileText size={10} />
        <span>Invoices ({totalCount})</span>
      </button>
      {expanded && (
        <div className="ml-4 mt-1 space-y-0.5">
          {hasDrafts && drafts.map((d) => (
            <div key={d.documentId} className="text-[11px] flex justify-between" style={{ color: '#8a8078' }}>
              <span className="truncate mr-2">
                <span className="inline-block w-[38px] text-[10px] rounded px-1 mr-1" style={{ background: '#3a322b', color: '#CDA274' }}>Draft</span>
                {d.documentSubject || d.documentName}
              </span>
              <span className="flex-shrink-0">{formatCurrency(d.amount)}</span>
            </div>
          ))}
          {hasReleased && released.map((d) => (
            <div key={d.documentId} className="text-[11px] flex justify-between" style={{ color: '#8a8078' }}>
              <span className="truncate mr-2">
                <span
                  className="inline-block w-[38px] text-center text-[10px] rounded px-1 mr-1"
                  style={{ background: d.status === 'paid' ? '#1a2e1a' : '#2e2a1a', color: d.status === 'paid' ? '#4ade80' : '#eab308' }}
                >
                  {d.status === 'paid' ? 'Paid' : 'Open'}
                </span>
                {d.documentSubject || d.documentName}
              </span>
              <span className="flex-shrink-0">{formatCurrency(d.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Contract Jobs Section
// ============================================================

function ContractJobCard({ job, onInvoiceCreated, arHeld, arToggling, onToggleArHold }: { job: ContractJobHealth; onInvoiceCreated?: () => void; arHeld?: boolean; arToggling?: boolean; onToggleArHold?: (jobId: string, jobName: string) => void }) {
  const [creatingBillable, setCreatingBillable] = useState(false);
  const [billableResult, setBillableResult] = useState<{ success: boolean; message: string; documentNumber?: string } | null>(null);

  const hasBillableWork = (job.uninvoicedBillableAmount ?? 0) > 0 || (job.unbilledLaborHours ?? 0) > 0;

  async function handleCreateBillableInvoice() {
    if (creatingBillable) return;
    setCreatingBillable(true);
    setBillableResult(null);
    try {
      const res = await fetch('/api/dashboard/invoicing/create-billable-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.jobId }),
      });
      const data = await res.json();
      if (data.success) {
        setBillableResult({
          success: true,
          message: `Draft invoice ${data.documentNumber} created with ${data.itemCount} items (${formatCurrency(data.totalPrice)})`,
          documentNumber: data.documentNumber,
        });
        setTimeout(() => onInvoiceCreated?.(), 1500);
      } else {
        setBillableResult({ success: false, message: data.error || 'Failed to create invoice' });
      }
    } catch (err: any) {
      setBillableResult({ success: false, message: err.message || 'Network error' });
    } finally {
      setCreatingBillable(false);
    }
  }

  const unpaidTotal = (job.releasedInvoices || [])
    .filter((inv) => inv.status === 'open')
    .reduce((sum, inv) => sum + inv.amount, 0);
  return (
    <div className="px-3 py-2.5 rounded-lg" style={CARD_STYLE}>
      {/* Header row: name + badge + key stats inline */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm font-semibold truncate flex-1 min-w-0" style={{ color: '#e8e0d8' }}>
          {job.jobName}
        </span>
        <HealthBadge health={job.health} />
      </div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px]" style={{ color: '#8a8078' }}>
          {formatCurrencyExact(job.invoicedToDate)} / {formatCurrencyExact(job.totalContractAndCOValue || job.totalContractValue)}
          {unpaidTotal > 0 && (
            <span style={{ color: '#eab308' }}> • {formatCurrency(unpaidTotal)} unpaid</span>
          )}
        </span>
        <span className="text-[11px]" style={{ color: '#8a8078' }}>
          {Math.round(job.invoicedPercent)}% invoiced
        </span>
      </div>

      {/* Compact progress bar — invoiced % of contract */}
      <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: '#1a1a1a' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, Math.round(job.invoicedPercent))}%`,
            background: 'linear-gradient(90deg, #CDA274, #C9A84C)',
          }}
        />
      </div>

      {/* CO breakdown — only show when approved COs exist */}
      {(job.appliedCOsCount ?? 0) > 0 && (
        <div className="text-[11px] mb-1" style={{ color: '#8a8078' }}>
          <span>Contract: </span>
          <span style={{ color: '#e8e0d8' }}>{formatCurrency(job.totalContractValue)}</span>
          <span style={{ margin: '0 4px' }}>+</span>
          <span>Approved COs: </span>
          <span style={{ color: '#22c55e' }}>{formatCurrency(job.approvedCOValue ?? 0)}</span>
          <span style={{ marginLeft: 4 }}>({job.appliedCOsCount} CO{(job.appliedCOsCount ?? 0) > 1 ? 's' : ''})</span>
        </div>
      )}

      {/* Unbilled CO alert */}
      {(job.unbilledCOAmount ?? 0) > 0 && (
        <div className="flex items-center gap-1 text-[11px] py-0.5 mb-1" style={{ color: '#f97316' }}>
          <AlertCircle size={10} className="flex-shrink-0" />
          <span>{formatCurrency(job.unbilledCOAmount ?? 0)} in approved but uninvoiced COs</span>
        </div>
      )}

      {/* Inline stats row */}
      <div className="flex items-center gap-3 text-[11px] mb-1.5">
        <span style={{ color: '#8a8078' }}>
          Billable: <span style={{ color: job.uninvoicedBillableAmount > 200 ? '#f97316' : '#e8e0d8' }}>
            {formatCurrency(job.uninvoicedBillableAmount ?? 0)}
          </span>
        </span>
        <span style={{ color: '#8a8078' }}>
          Labor: <span style={{ color: job.unbilledLaborHours > 1 ? '#f97316' : '#e8e0d8' }}>
            {job.unbilledLaborHours ?? 0}h
          </span>
        </span>
      </div>

      {/* Compact alert rows — only show if there are issues */}
      {job.approachingMilestones && job.approachingMilestones.length > 0 && (
        <div className="flex items-center gap-1 text-[11px] py-0.5" style={{ color: '#eab308' }}>
          <Clock size={10} className="flex-shrink-0" />
          {job.approachingMilestones.map((m) => m.taskName).join(', ')} — approaching
        </div>
      )}

      {job.overdueMilestones.length > 0 && job.overdueMilestones.map((m) => (
        <div key={m.taskId} className="flex items-center gap-1.5 text-[11px] py-0.5" style={{ color: '#ef4444' }}>
          <AlertTriangle size={10} className="flex-shrink-0" />
          <span className="truncate">
            {m.taskName} — due {formatDate(m.endDate)} ({Math.abs(m.daysUntilDue ?? 0)}d overdue)
          </span>
        </div>
      ))}

      {job.unmatchedDraftInvoices && job.unmatchedDraftInvoices.length > 0 && (
        <div className="py-0.5">
          {job.unmatchedDraftInvoices.map((d) => (
            <CreateTaskRow key={d.documentId} jobId={job.jobId} draft={d} />
          ))}
        </div>
      )}

      {job.pendingInvoices && job.pendingInvoices.length > 0 && (
        <>
          {job.pendingInvoices.map((inv) => (
            <div key={inv.documentId} className="flex items-center gap-1.5 text-[11px] py-0.5" style={{ color: '#8a8078' }}>
              <Send size={9} className="flex-shrink-0" />
              <span className="truncate">
                Invoice #{inv.documentNumber}{inv.documentSubject ? ` — ${inv.documentSubject}` : ''}
                {inv.amount > 0 ? ` ($${inv.amount.toLocaleString()})` : ''}
                {' '}— sent {inv.daysPending}d ago, awaiting payment
              </span>
            </div>
          ))}
          {/* AR Hold Toggle — shown when job has pending (unpaid) invoices */}
          {onToggleArHold && (
            <button
              onClick={() => onToggleArHold(job.jobId, job.jobName)}
              disabled={arToggling}
              className="flex items-center gap-1 text-[10px] mt-0.5 py-0.5 px-1.5 rounded transition-colors"
              style={{
                background: arHeld ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.06)',
                color: arHeld ? '#f87171' : '#6a6058',
                border: `1px solid ${arHeld ? 'rgba(239,68,68,0.15)' : 'rgba(205,162,116,0.1)'}`,
                cursor: arToggling ? 'wait' : 'pointer',
                opacity: arToggling ? 0.5 : 1,
              }}
              title={arHeld ? 'Resume automated AR reminders for this job' : 'Pause automated AR reminders for this job'}
            >
              {arToggling ? (
                <Loader2 size={9} className="animate-spin" />
              ) : arHeld ? (
                <PlayCircle size={9} />
              ) : (
                <PauseCircle size={9} />
              )}
              {arHeld ? 'Resume AR Reminders' : 'Pause AR Reminders'}
            </button>
          )}
        </>
      )}

      {job.nextMilestone && (!job.approachingMilestones || !job.approachingMilestones.some(m => m.taskId === job.nextMilestone?.taskId)) && (
        <div className="text-[11px] py-0.5" style={{ color: '#8a8078' }}>
          Next: {job.nextMilestone.taskName}
          {job.nextMilestone.endDate && ` — ${formatDate(job.nextMilestone.endDate)}`}
        </div>
      )}

      {job.alerts.length > 0 && job.alerts.map((alert, i) => (
        <div key={i} className="flex items-center gap-1 text-[11px] py-0.5" style={{ color: '#f97316' }}>
          <AlertCircle size={10} className="flex-shrink-0" />
          {alert}
        </div>
      ))}

      {/* Create Billable Draft Invoice Button — only for jobs with uninvoiced CC23 items or hours */}
      {hasBillableWork && (
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(205,162,116,0.08)' }}>
          {billableResult ? (
            <div
              className="flex items-center gap-2 text-xs py-1.5 px-2 rounded-lg"
              style={{
                background: billableResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: billableResult.success ? '#22c55e' : '#ef4444',
              }}
            >
              {billableResult.success ? <Check size={12} /> : <AlertCircle size={12} />}
              {billableResult.message}
            </div>
          ) : (
            <button
              onClick={handleCreateBillableInvoice}
              disabled={creatingBillable}
              className="flex items-center gap-2 text-xs font-medium py-1.5 px-3 rounded-lg transition-colors w-full justify-center"
              style={{
                background: creatingBillable ? 'rgba(205,162,116,0.08)' : 'rgba(205,162,116,0.15)',
                color: '#CDA274',
                cursor: creatingBillable ? 'wait' : 'pointer',
              }}
              onMouseEnter={(e) => !creatingBillable && (e.currentTarget.style.background = 'rgba(205,162,116,0.25)')}
              onMouseLeave={(e) => !creatingBillable && (e.currentTarget.style.background = 'rgba(205,162,116,0.15)')}
            >
              {creatingBillable ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Creating Billable Invoice...
                </>
              ) : (
                <>
                  <Plus size={12} />
                  Create Billable Invoice
                </>
              )}
            </button>
          )}
        </div>
      )}

      <InvoiceDetails drafts={job.draftInvoices} released={job.releasedInvoices} />
    </div>
  );
}

// ============================================================
// Cost Plus Jobs Section
// ============================================================

function CostPlusJobCard({ job, onInvoiceCreated, arHeld, arToggling, onToggleArHold }: { job: CostPlusJobHealth; onInvoiceCreated?: () => void; arHeld?: boolean; arToggling?: boolean; onToggleArHold?: (jobId: string, jobName: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ success: boolean; message: string; documentNumber?: string } | null>(null);

  const hasUnbilledWork = job.unbilledCosts > 0 || job.unbilledHours > 0;
  const daysColor = !hasUnbilledWork ? '#8a8078' : (job.daysSinceLastInvoice ?? 0) > 14 ? '#ef4444' : (job.daysSinceLastInvoice ?? 0) > 10 ? '#eab308' : '#22c55e';
  const unpaidTotal = (job.releasedInvoices || [])
    .filter((inv) => inv.status === 'open')
    .reduce((sum, inv) => sum + inv.amount, 0);

  async function handleCreateDraftInvoice() {
    if (creating) return;
    setCreating(true);
    setCreateResult(null);
    try {
      // Step 1: Create the invoice via PAVE (instant, no Chrome needed)
      const res = await fetch('/api/dashboard/invoicing/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.jobId }),
      });
      const data = await res.json();
      if (!data.success) {
        setCreateResult({ success: false, message: data.error || 'Failed to create invoice' });
        return;
      }

      // Step 2: Reorganize the invoice into BKB format with AI descriptions
      try {
        await fetch('/api/dashboard/invoicing/reorganize-invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId: data.documentId, jobId: job.jobId }),
        });
      } catch {
        // Reorganization is non-critical — invoice still exists without formatting
      }

      setCreateResult({
        success: true,
        message: `Draft Invoice ${data.documentNumber} created with ${data.itemCount} items`,
        documentNumber: data.documentNumber,
      });
      // Refresh the dashboard data after a short delay
      setTimeout(() => onInvoiceCreated?.(), 1500);
    } catch (err: any) {
      setCreateResult({ success: false, message: err.message || 'Network error' });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="px-3 py-2.5 rounded-lg" style={CARD_STYLE}>
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm font-semibold truncate flex-1 min-w-0" style={{ color: '#e8e0d8' }}>
          {job.jobName}
        </span>
        <HealthBadge health={job.health} />
      </div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px]" style={{ color: '#8a8078' }}>
          {formatCurrency(job.totalInvoiced)} invoiced • {formatCurrency(job.unbilledAmount)} unbilled
          {unpaidTotal > 0 && (
            <span style={{ color: '#eab308' }}> • {formatCurrency(unpaidTotal)} unpaid</span>
          )}
        </span>
        <span className="text-[11px]" style={{ color: daysColor }}>
          {job.daysSinceLastInvoice !== null ? `${job.daysSinceLastInvoice}d since invoice` : 'No invoices'}
        </span>
      </div>

      {/* Compact cadence bar */}
      <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: '#1a1a1a' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, ((job.daysSinceLastInvoice ?? 0) / 28) * 100)}%`,
            background: daysColor,
          }}
        />
      </div>

      {/* Inline stats */}
      <div className="flex items-center gap-3 text-[11px] mb-1">
        <span style={{ color: '#8a8078' }}>
          Unbilled: <span style={{ color: job.unbilledAmount > 0 ? '#eab308' : '#e8e0d8' }}>{formatCurrency(job.unbilledAmount)}</span>
        </span>
        <span style={{ color: '#8a8078' }}>
          Hours: <span style={{ color: job.unbilledHours > 0 ? '#eab308' : '#e8e0d8' }}>{job.unbilledHours}h</span>
        </span>
        <span style={{ color: '#8a8078' }}>
          Billed: <span style={{ color: '#e8e0d8' }}>{formatCurrency(job.totalInvoiced)}</span>
        </span>
      </div>

      {job.alerts.length > 0 && job.alerts.map((alert, i) => (
        <div key={i} className="flex items-center gap-1 text-[11px] py-0.5" style={{ color: '#f97316' }}>
          <AlertCircle size={10} className="flex-shrink-0" />
          {alert}
        </div>
      ))}

      {/* AR Hold Toggle — shown when job has unpaid invoices */}
      {unpaidTotal > 0 && onToggleArHold && (
        <button
          onClick={() => onToggleArHold(job.jobId, job.jobName)}
          disabled={arToggling}
          className="flex items-center gap-1 text-[10px] mt-0.5 py-0.5 px-1.5 rounded transition-colors"
          style={{
            background: arHeld ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.06)',
            color: arHeld ? '#f87171' : '#6a6058',
            border: `1px solid ${arHeld ? 'rgba(239,68,68,0.15)' : 'rgba(205,162,116,0.1)'}`,
            cursor: arToggling ? 'wait' : 'pointer',
            opacity: arToggling ? 0.5 : 1,
          }}
          title={arHeld ? 'Resume automated AR reminders for this job' : 'Pause automated AR reminders for this job'}
        >
          {arToggling ? (
            <Loader2 size={9} className="animate-spin" />
          ) : arHeld ? (
            <PlayCircle size={9} />
          ) : (
            <PauseCircle size={9} />
          )}
          {arHeld ? 'Resume AR Reminders' : 'Pause AR Reminders'}
        </button>
      )}

      {/* Create Draft Invoice Button — only for jobs with unbilled work */}
      {hasUnbilledWork && (
        <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(205,162,116,0.08)' }}>
          {createResult ? (
            <div
              className="flex items-center gap-2 text-xs py-1.5 px-2 rounded-lg"
              style={{
                background: createResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: createResult.success ? '#22c55e' : '#ef4444',
              }}
            >
              {createResult.success ? <Check size={12} /> : <AlertCircle size={12} />}
              {createResult.message}
            </div>
          ) : (
            <button
              onClick={handleCreateDraftInvoice}
              disabled={creating}
              className="flex items-center gap-2 text-xs font-medium py-1.5 px-3 rounded-lg transition-colors w-full justify-center"
              style={{
                background: creating ? 'rgba(205,162,116,0.08)' : 'rgba(205,162,116,0.15)',
                color: '#CDA274',
                cursor: creating ? 'wait' : 'pointer',
              }}
              onMouseEnter={(e) => !creating && (e.currentTarget.style.background = 'rgba(205,162,116,0.25)')}
              onMouseLeave={(e) => !creating && (e.currentTarget.style.background = 'rgba(205,162,116,0.15)')}
            >
              {creating ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Creating Draft Invoice...
                </>
              ) : (
                <>
                  <Plus size={12} />
                  Create Draft Invoice
                </>
              )}
            </button>
          )}
        </div>
      )}

      <InvoiceDetails drafts={job.draftInvoices} released={job.releasedInvoices} />
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

const VISIBLE_ALERTS = 5;

function GlobalAlertsSection({ alerts }: { alerts: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = alerts.length > VISIBLE_ALERTS;
  const visibleAlerts = expanded ? alerts : alerts.slice(0, VISIBLE_ALERTS);

  return (
    <div className="p-4 rounded-xl" style={{ ...CARD_STYLE, border: '1px solid rgba(239,68,68,0.2)' }}>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={16} style={{ color: '#ef4444' }} />
        <span className="text-sm font-semibold" style={{ color: '#ef4444' }}>
          Active Alerts ({alerts.length})
        </span>
      </div>
      <div className="space-y-1">
        {visibleAlerts.map((alert, i) => (
          <div key={i} className="text-xs" style={{ color: '#f97316' }}>
            {alert}
          </div>
        ))}
        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs mt-1"
            style={{ color: '#8a8078', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {expanded ? 'Show less' : `+${alerts.length - VISIBLE_ALERTS} more alerts`}
          </button>
        )}
      </div>
    </div>
  );
}

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
  const [searchQuery, setSearchQuery] = useState('');

  // Sections expand/collapse
  const [contractExpanded, setContractExpanded] = useState(true);
  const [costPlusExpanded, setCostPlusExpanded] = useState(true);
  const [billableExpanded, setBillableExpanded] = useState(true);
  const [openInvoicesExpanded, setOpenInvoicesExpanded] = useState(false);

  // AR Hold state: jobId → isHeld
  const [arHolds, setArHolds] = useState<Record<string, boolean>>({});
  const [arToggling, setArToggling] = useState<string | null>(null);

  // AR Stats for visual summary
  const [arStats, setArStats] = useState<{
    totalRemindersSent: number;
    jobsWithReminders: number;
    jobsOnHold: number;
    activeJobs: number;
    totalJobsTracked: number;
    recentReminders: Array<{ jobId: string; jobName: string; tier: string; date: string; invoiceNumber?: string }>;
    heldJobIds?: string[];
  } | null>(null);

  async function toggleArHold(jobId: string, jobName: string) {
    setArToggling(jobId);
    try {
      const currentlyHeld = arHolds[jobId] || false;
      const action = currentlyHeld ? 'resume' : 'hold';
      const res = await fetch('/api/dashboard/invoicing/ar-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, action }),
      });
      if (!res.ok) throw new Error('Failed to toggle AR hold');
      const data = await res.json();
      setArHolds(prev => ({ ...prev, [jobId]: data.isHeld }));
    } catch (err) {
      console.error('AR hold toggle failed:', err);
    } finally {
      setArToggling(null);
    }
  }

  // Search filter helper
  function matchesSearch<T extends { jobName: string; jobNumber: string; clientName: string }>(job: T): boolean {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      job.jobName.toLowerCase().includes(q) ||
      job.jobNumber.toLowerCase().includes(q) ||
      job.clientName.toLowerCase().includes(q)
    );
  }

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

      // Load AR hold state for jobs with pending invoices
      loadArHoldsForPendingJobs(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load invoicing data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function fetchArStats() {
    try {
      const res = await fetch('/api/dashboard/invoicing/ar-stats');
      if (res.ok) {
        const data = await res.json();
        setArStats(data);
        // Initialize AR hold state from the server data
        if (data.heldJobIds && data.heldJobIds.length > 0) {
          const holds: Record<string, boolean> = {};
          for (const id of data.heldJobIds) {
            holds[id] = true;
          }
          setArHolds(prev => ({ ...prev, ...holds }));
        }
      }
    } catch {
      // non-critical — silently fail
    }
  }

  // After report loads, check AR hold status for jobs with pending invoices
  async function loadArHoldsForPendingJobs(reportData: InvoicingReport) {
    const jobIdsWithPending = new Set<string>();
    for (const job of (reportData.contractJobs || [])) {
      if (job.pendingInvoices && job.pendingInvoices.length > 0) {
        jobIdsWithPending.add(job.jobId);
      }
    }
    for (const job of (reportData.costPlusJobs || [])) {
      const hasOpen = (job.releasedInvoices || []).some((inv) => inv.status === 'open');
      if (hasOpen) jobIdsWithPending.add(job.jobId);
    }

    if (jobIdsWithPending.size === 0) return;

    const holds: Record<string, boolean> = {};
    const ids = Array.from(jobIdsWithPending);
    // Check in parallel, small set (~10 jobs max)
    const results = await Promise.allSettled(
      ids.map(async (jobId) => {
        const res = await fetch(`/api/dashboard/invoicing/ar-hold?jobId=${jobId}`);
        if (res.ok) {
          const data = await res.json();
          return { jobId, isHeld: data.isHeld };
        }
        return { jobId, isHeld: false };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        holds[r.value.jobId] = r.value.isHeld;
      }
    }
    setArHolds(prev => ({ ...prev, ...holds }));
  }

  useEffect(() => {
    fetchReport();
    fetchArStats();
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
              ? `Cached ${formatDateTime(report._cachedAt || report.generatedAt)}`
              : `Fresh ${formatDateTime(report.generatedAt)}`
            }
            {report._analysisTimeMs ? ` (${(report._analysisTimeMs / 1000).toFixed(1)}s)` : ''}
          </p>
        </div>
        <button
          onClick={() => fetchReport(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-white/5"
          style={{ border: '1px solid rgba(205,162,116,0.2)', color: '#CDA274' }}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Running fresh analysis...' : 'Refresh'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
          label="Unbilled Items"
          value={formatCurrency(summary.totalUnbilledAmount)}
          subtext="Cost Code 23 only"
          color={summary.totalUnbilledAmount > 0 ? '#eab308' : '#22c55e'}
        />
        <StatCard
          icon={Clock}
          label="Unbilled Hours"
          value={`${summary.totalUnbilledHours ?? 0}h`}
          color={(summary.totalUnbilledHours ?? 0) > 0 ? '#eab308' : '#22c55e'}
        />
        <StatCard
          icon={CheckCircle2}
          label="Overall Health"
          value={HEALTH_COLORS[summary.overallHealth].label}
          color={HEALTH_COLORS[summary.overallHealth].text}
        />
      </div>

      {/* Open Invoices Awaiting Payment — with AR total & aging */}
      {(() => {
        // Aggregate all pending invoices from contract + cost-plus jobs
        const allPending: Array<{
          documentId: string;
          documentNumber: string;
          documentSubject: string | null;
          amount: number;
          daysPending: number;
          jobId: string;
          jobName: string;
          clientName: string;
        }> = [];

        for (const job of (report.contractJobs || [])) {
          for (const inv of (job.pendingInvoices || [])) {
            allPending.push({
              documentId: inv.documentId,
              documentNumber: inv.documentNumber,
              documentSubject: inv.documentSubject,
              amount: inv.amount,
              daysPending: inv.daysPending,
              jobId: job.jobId,
              jobName: job.jobName,
              clientName: job.clientName,
            });
          }
        }
        for (const job of (report.costPlusJobs || [])) {
          for (const inv of (job.releasedInvoices || [])) {
            if (inv.status === 'open') {
              allPending.push({
                documentId: inv.documentId,
                documentNumber: inv.documentNumber,
                documentSubject: inv.documentSubject,
                amount: inv.amount,
                daysPending: Math.floor((Date.now() - new Date(inv.createdAt || '').getTime()) / 86400000),
                jobId: job.jobId,
                jobName: job.jobName,
                clientName: job.clientName,
              });
            }
          }
        }

        // Sort oldest first
        allPending.sort((a, b) => b.daysPending - a.daysPending);
        const totalOwed = allPending.reduce((s, inv) => s + inv.amount, 0);

        // Aging buckets
        const aging = {
          current: { count: 0, amount: 0 },  // 0-14 days
          aging15: { count: 0, amount: 0 },   // 15-30 days
          aging31: { count: 0, amount: 0 },   // 31-60 days
          aging60: { count: 0, amount: 0 },   // 60+ days
        };
        for (const inv of allPending) {
          if (inv.daysPending <= 14) { aging.current.count++; aging.current.amount += inv.amount; }
          else if (inv.daysPending <= 30) { aging.aging15.count++; aging.aging15.amount += inv.amount; }
          else if (inv.daysPending <= 60) { aging.aging31.count++; aging.aging31.amount += inv.amount; }
          else { aging.aging60.count++; aging.aging60.amount += inv.amount; }
        }

        if (allPending.length === 0) return null;

        return (
          <div
            className="rounded-lg overflow-hidden"
            style={{ background: '#242424', border: '1px solid rgba(234,179,8,0.15)' }}
          >
            {/* Clickable header */}
            <button
              onClick={() => setOpenInvoicesExpanded(!openInvoicesExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.02]"
            >
              <div className="flex items-center gap-2">
                <DollarSign size={16} style={{ color: '#eab308' }} />
                <span className="text-sm font-semibold" style={{ color: '#eab308' }}>
                  Accounts Receivable
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308' }}
                >
                  {allPending.length} invoices
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold" style={{ color: '#e8e0d8' }}>
                  {formatCurrency(totalOwed)}
                </span>
                {openInvoicesExpanded
                  ? <ChevronDown size={16} style={{ color: '#8a8078' }} />
                  : <ChevronRight size={16} style={{ color: '#8a8078' }} />
                }
              </div>
            </button>

            {/* Aging breakdown bar + AR reminders strip */}
            <div className="px-4 pb-2 pt-1" style={{ borderTop: '1px solid rgba(205,162,116,0.06)' }}>
              {/* Aging buckets */}
              <div className="flex items-center gap-3 text-[10px]">
                <div className="flex items-center gap-1">
                  <span style={{ color: '#8a8078' }}>0-14d:</span>
                  <span style={{ color: '#22c55e', fontWeight: 600 }}>{formatCurrency(aging.current.amount)}</span>
                  <span style={{ color: '#5a5550' }}>({aging.current.count})</span>
                </div>
                <div className="flex items-center gap-1">
                  <span style={{ color: '#8a8078' }}>15-30d:</span>
                  <span style={{ color: '#eab308', fontWeight: 600 }}>{formatCurrency(aging.aging15.amount)}</span>
                  <span style={{ color: '#5a5550' }}>({aging.aging15.count})</span>
                </div>
                <div className="flex items-center gap-1">
                  <span style={{ color: '#8a8078' }}>31-60d:</span>
                  <span style={{ color: '#f97316', fontWeight: 600 }}>{formatCurrency(aging.aging31.amount)}</span>
                  <span style={{ color: '#5a5550' }}>({aging.aging31.count})</span>
                </div>
                <div className="flex items-center gap-1">
                  <span style={{ color: '#8a8078' }}>60+d:</span>
                  <span style={{ color: '#ef4444', fontWeight: 600 }}>{formatCurrency(aging.aging60.amount)}</span>
                  <span style={{ color: '#5a5550' }}>({aging.aging60.count})</span>
                </div>
              </div>
              {/* Aging bar visualization */}
              {totalOwed > 0 && (
                <div className="flex h-[4px] rounded-full overflow-hidden mt-1.5 mb-1" style={{ background: '#1a1a1a' }}>
                  {aging.current.amount > 0 && (
                    <div style={{ width: `${(aging.current.amount / totalOwed) * 100}%`, background: '#22c55e' }} />
                  )}
                  {aging.aging15.amount > 0 && (
                    <div style={{ width: `${(aging.aging15.amount / totalOwed) * 100}%`, background: '#eab308' }} />
                  )}
                  {aging.aging31.amount > 0 && (
                    <div style={{ width: `${(aging.aging31.amount / totalOwed) * 100}%`, background: '#f97316' }} />
                  )}
                  {aging.aging60.amount > 0 && (
                    <div style={{ width: `${(aging.aging60.amount / totalOwed) * 100}%`, background: '#ef4444' }} />
                  )}
                </div>
              )}
              {/* AR Reminders — compact strip */}
              {arStats && (
                <div className="flex items-center gap-3 mt-1 text-[10px]">
                  <div className="flex items-center gap-1">
                    <Send size={9} style={{ color: '#4ade80' }} />
                    <span style={{ color: '#4ade80', fontWeight: 500 }}>AR Reminders</span>
                  </div>
                  <span style={{ color: '#8a8078' }}>{arStats.totalRemindersSent} sent</span>
                  <span style={{ color: '#8a8078' }}>{arStats.jobsWithReminders} jobs</span>
                  {arStats.jobsOnHold > 0 && (
                    <span style={{ color: '#f87171' }}>{arStats.jobsOnHold} paused</span>
                  )}
                  {arStats.recentReminders.length > 0 && (
                    <span style={{ color: '#5a5550' }}>
                      Last: {new Date(arStats.recentReminders[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Expanded invoice list */}
            {openInvoicesExpanded && (
              <div className="px-4 pb-3" style={{ borderTop: '1px solid rgba(205,162,116,0.06)' }}>
                {/* Column headers */}
                <div className="flex items-center gap-2 py-2 text-[10px] font-medium" style={{ color: '#6a6058' }}>
                  <span className="w-[60px]">Invoice</span>
                  <span className="flex-1 min-w-0">Job / Client</span>
                  <span className="w-[80px] text-right">Amount</span>
                  <span className="w-[55px] text-right">Age</span>
                  <span className="w-[120px] text-right">AR Reminders</span>
                </div>

                {allPending.map((inv) => {
                  const ageColor = inv.daysPending > 60 ? '#ef4444' : inv.daysPending > 30 ? '#f97316' : inv.daysPending > 14 ? '#eab308' : '#8a8078';
                  const isHeld = arHolds[inv.jobId] || false;
                  const isToggling = arToggling === inv.jobId;

                  return (
                    <div
                      key={inv.documentId}
                      className="flex items-center gap-2 py-1.5"
                      style={{ borderBottom: '1px solid rgba(205,162,116,0.04)' }}
                    >
                      {/* Invoice # */}
                      <span className="w-[60px] text-[11px] font-mono" style={{ color: '#CDA274' }}>
                        #{inv.documentNumber}
                      </span>

                      {/* Job + Client */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] truncate" style={{ color: '#e8e0d8', margin: 0 }}>
                          {inv.jobName}
                        </p>
                        <p className="text-[9px] truncate" style={{ color: '#6a6058', margin: 0 }}>
                          {inv.clientName}{inv.documentSubject ? ` — ${inv.documentSubject}` : ''}
                        </p>
                      </div>

                      {/* Amount */}
                      <span className="w-[80px] text-right text-[12px] font-semibold" style={{ color: '#e8e0d8' }}>
                        {formatCurrency(inv.amount)}
                      </span>

                      {/* Age */}
                      <span className="w-[55px] text-right text-[11px] font-medium" style={{ color: ageColor }}>
                        {inv.daysPending}d
                      </span>

                      {/* AR Hold Toggle */}
                      <div className="w-[120px] flex justify-end">
                        <button
                          onClick={() => toggleArHold(inv.jobId, inv.jobName)}
                          disabled={isToggling}
                          className="flex items-center gap-1 text-[9px] py-0.5 px-2 rounded transition-colors"
                          style={{
                            background: isHeld ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.08)',
                            color: isHeld ? '#f87171' : '#4ade80',
                            border: `1px solid ${isHeld ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.15)'}`,
                            cursor: isToggling ? 'wait' : 'pointer',
                            opacity: isToggling ? 0.5 : 1,
                          }}
                          title={isHeld ? 'Resume automated AR reminders for this job' : 'Pause automated AR reminders for this job'}
                        >
                          {isToggling ? (
                            <Loader2 size={8} className="animate-spin" />
                          ) : isHeld ? (
                            <PlayCircle size={8} />
                          ) : (
                            <PauseCircle size={8} />
                          )}
                          {isHeld ? 'Paused' : 'Active'}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Footer totals */}
                <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: '1px solid rgba(205,162,116,0.08)' }}>
                  <span className="text-[10px]" style={{ color: '#6a6058' }}>
                    {allPending.filter(inv => inv.daysPending > 30).length} invoices over 30 days
                  </span>
                  <span className="text-[10px]" style={{ color: '#6a6058' }}>
                    {Object.values(arHolds).filter(Boolean).length > 0
                      ? `${Object.values(arHolds).filter(Boolean).length} job(s) paused`
                      : 'All reminders active'
                    }
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Search Box */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#8a8078' }} />
        <input
          type="text"
          placeholder="Search jobs by name, number, or client..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-8 py-2 rounded-lg text-sm outline-none"
          style={{
            background: '#1a1a1a',
            border: '1px solid rgba(205,162,116,0.15)',
            color: '#e8e0d8',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-80"
          >
            <X size={14} style={{ color: '#8a8078' }} />
          </button>
        )}
      </div>

      {/* Global Alerts */}
      {report.alerts.length > 0 && (
        <GlobalAlertsSection alerts={report.alerts} />
      )}

      {/* Agent Recommendations */}
      <AgentSection report={report} />

      {/* Contract Jobs — sorted by health priority */}
      {report.contractJobs.length > 0 && (() => {
        const filtered = sortByHealthPriority(report.contractJobs.filter(matchesSearch));
        return filtered.length > 0 ? (
          <div>
            <SectionHeader
              title="Contract (Fixed-Price) Jobs"
              count={filtered.length}
              icon={FileText}
              expanded={contractExpanded}
              onToggle={() => setContractExpanded(!contractExpanded)}
            />
            {contractExpanded && (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3 ml-1">
                {filtered.map((job) => (
                  <ContractJobCard key={job.jobId} job={job} onInvoiceCreated={() => fetchReport(true)} arHeld={arHolds[job.jobId]} arToggling={arToggling === job.jobId} onToggleArHold={toggleArHold} />
                ))}
              </div>
            )}
          </div>
        ) : null;
      })()}

      {/* Cost Plus Jobs — sorted by health priority */}
      {report.costPlusJobs.length > 0 && (() => {
        const filtered = sortByHealthPriority(report.costPlusJobs.filter(matchesSearch));
        return filtered.length > 0 ? (
          <div>
            <SectionHeader
              title="Cost Plus Jobs"
              count={filtered.length}
              icon={Clock}
              expanded={costPlusExpanded}
              onToggle={() => setCostPlusExpanded(!costPlusExpanded)}
            />
            {costPlusExpanded && (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3 ml-1">
                {filtered.map((job) => (
                  <CostPlusJobCard key={job.jobId} job={job} onInvoiceCreated={() => fetchReport(true)} arHeld={arHolds[job.jobId]} arToggling={arToggling === job.jobId} onToggleArHold={toggleArHold} />
                ))}
              </div>
            )}
          </div>
        ) : null;
      })()}

      {/* Billable Items */}
      {report.billableItems.length > 0 && (() => {
        const filtered = report.billableItems.filter(matchesSearch);
        return filtered.length > 0 ? (
          <div>
            <SectionHeader
              title="Billable Items Pending"
              count={filtered.length}
              icon={DollarSign}
              expanded={billableExpanded}
              onToggle={() => setBillableExpanded(!billableExpanded)}
            />
            {billableExpanded && (
              <div className="space-y-2">
                {filtered.map((summary) => (
                  <BillableItemsCard key={summary.jobId} summary={summary} />
                ))}
              </div>
            )}
          </div>
        ) : null;
      })()}

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

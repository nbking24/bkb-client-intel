// ============================================================
// Invoicing Health Agent — Data Gathering & Analysis Layer
//
// Collects data from JobTread to give the AI agent
// full context on invoicing health across all open projects.
//
// Three invoicing profiles:
// 1. Contract (Fixed-Price) — milestone-based, tied to schedule tasks
// 2. Cost Plus — biweekly Friday billing cadence (every 14 days)
// 3. Billable Items — cost code 23 items + billable time entries
// ============================================================

import {
  getActiveJobs,
  getDocumentsForJob,
  getCostItemsForJobLite,
  getTimeEntriesForJob,
  getJobSchedule,
  getDocumentCostItemsById,
  getDocumentCostItemsForJob,
  type JTJob,
  type JTDocument,
  type JTCostItem,
  type JTTimeEntry,
} from './jobtread';
import { getCOTrackingForJob } from './co-tracking';

// ============================================================
// Constants
// ============================================================

/** Cost Code 23 — "23 Billable" (labor hours), "23 Billable Materials", "23 Billable Subs" (costs) */
const BILLABLE_COST_CODE_NUMBER = '23';
/** Name prefix filter — only items whose name starts with "23 Billable" are counted (Cost-Plus jobs) */
const BILLABLE_NAME_PREFIX = '23 Billable';
/** Cost types that qualify as billable on Fixed-Price jobs (costCode 23 + one of these) */
const BILLABLE_COST_TYPE_NAMES = ['Materials', 'Subcontractor'];

/** Cost Plus jobs should be invoiced every 14 days */
const COST_PLUS_BILLING_CADENCE_DAYS = 14;

/** Alert thresholds */
const ALERT_THRESHOLDS = {
  costPlusOverdueDays: 14,       // Days since last invoice before alert
  costPlusWarningDays: 10,       // Days since last invoice before warning
  milestoneOverdueDays: 0,       // Schedule task past due with no invoice
  unbilledAmountThreshold: 100,  // Minimum $ to flag as unbilled (cost-plus)
  // Contract (Fixed-Price) billable thresholds
  contractBillableWarning: 200,  // $ uninvoiced billable items → warning
  contractBillableOverdue: 800,  // $ uninvoiced billable items → overdue
  contractLaborWarning: 1,       // Hours unbilled labor → warning
  contractLaborOverdue: 3,       // Hours unbilled labor → overdue
  contractMilestoneApproachingDays: 2, // $ task due within N days → warning
} as const;

// ============================================================
// Types
// ============================================================

export type InvoicingProfile = 'contract' | 'cost_plus' | 'mixed';
export type InvoicingHealth = 'healthy' | 'warning' | 'overdue' | 'critical';

export interface InvoicingSummaryStats {
  totalOpenJobs: number;
  contractJobs: number;
  costPlusJobs: number;
  totalAlerts: number;
  totalUnbilledAmount: number;   // Only Cost Code 23 billable items (not all cost-plus unbilled)
  totalUnbilledHours: number;    // Sum of unbilled labor hours across all jobs
  overallHealth: InvoicingHealth;
}

export interface ContractJobHealth {
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
  approvedCOValue: number;
  totalContractAndCOValue: number;
  unbilledCOAmount: number;
  appliedCOsCount: number;
  health: InvoicingHealth;
  alerts: string[];
}

export interface MilestoneInfo {
  taskId: string;
  taskName: string;
  endDate: string | null;
  daysUntilDue: number | null;
  isOverdue: boolean;
  linkedInvoiceId: string | null;
  amount: number | null;
}

export interface DraftInvoiceInfo {
  documentId: string;
  documentName: string;
  documentSubject: string | null;
  amount: number;
  createdAt: string;
  isLinkedToTask: boolean;
}

export interface PendingInvoiceInfo {
  documentId: string;
  documentSubject: string | null;
  documentNumber: string;
  amount: number;
  createdAt: string;
  issueDate: string | null;
  daysPending: number;
}

export interface ReleasedInvoiceInfo {
  documentId: string;
  documentName: string;
  documentSubject: string | null;
  documentNumber: string;
  amount: number;
  createdAt: string;
  issueDate: string | null;
  status: 'paid' | 'open';
}

export interface CostPlusJobHealth {
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

export interface BillableItemsSummary {
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

export interface BillableItem {
  costItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  costGroupName: string;
  onDocument: boolean;
  documentName: string | null;
}

export interface BillableHourEntry {
  timeEntryId: string;
  userName: string;
  hours: number;
  date: string;
  notes: string | null;
  costItemName: string | null;
}

export interface InvoicingFullContext {
  generatedAt: string;
  summary: InvoicingSummaryStats;
  contractJobs: ContractJobHealth[];
  costPlusJobs: CostPlusJobHealth[];
  billableItems: BillableItemsSummary[];
  alerts: string[];
}

// ============================================================
// Date Helpers
// ============================================================

function getTodayDateString(): string {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function daysBetweenDates(todayStr: string, targetDateStr: string): number {
  const today = new Date(todayStr + 'T12:00:00Z');
  const target = new Date(targetDateStr.slice(0, 10) + 'T12:00:00Z');
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function daysSinceDate(todayStr: string, pastDateStr: string): number {
  return -daysBetweenDates(todayStr, pastDateStr);
}

// ============================================================
// 1. Extended Job Type (adds resolved priceType label)
// ============================================================

interface ExtendedJob extends JTJob {
  priceType: string; // "Fixed-Price", "Cost-Plus", or the raw PAVE value
}

// ============================================================
// 2. Analyze Contract (Fixed-Price) Job Invoicing Health
// ============================================================

async function analyzeContractJob(
  job: ExtendedJob,
  documents: JTDocument[],
  costItems: JTCostItem[],
  timeEntries: JTTimeEntry[],
  todayStr: string,
): Promise<ContractJobHealth> {
  const alerts: string[] = [];

  // Get schedule for milestone tracking
  const schedule = await getJobSchedule(job.id);

  // Separate invoices
  const customerInvoices = documents.filter((d) => d.type === 'customerInvoice');
  const approvedInvoices = customerInvoices.filter((d) => d.status === 'approved');
  const draftInvoices = customerInvoices.filter((d) => d.status === 'draft');
  const pendingInvoicesDocs = customerInvoices.filter((d) => d.status === 'pending');

  // Build pending invoice info (sent but not yet paid)
  // Use issueDate (when sent to customer) for age tracking; fall back to createdAt
  const today = new Date(todayStr);
  const pendingInvoices: PendingInvoiceInfo[] = pendingInvoicesDocs.map((d) => {
    const referenceDate = new Date(d.issueDate || d.createdAt);
    const daysPending = Math.floor((today.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
    return {
      documentId: d.id,
      documentSubject: d.subject || null,
      documentNumber: d.number,
      amount: d.price || 0,
      createdAt: d.createdAt,
      issueDate: d.issueDate || null,
      daysPending,
    };
  });

  // Get estimates for total contract value
  const estimates = documents.filter(
    (d) => d.type === 'customerOrder' && d.status === 'approved'
  );

  // Find payment-related schedule tasks (tasks with $ prefix)
  const paymentTasks: MilestoneInfo[] = [];
  if (schedule) {
    const allTasks = schedule.phases.flatMap((phase) =>
      (phase.childTasks?.nodes || []).map((t: any) => ({
        ...t,
        phaseName: phase.name,
      }))
    );

    // Also include orphan tasks
    const orphanTasks = schedule.orphanTasks || [];
    const allTasksFlat = [...allTasks, ...orphanTasks];

    for (const task of allTasksFlat) {
      if (task.name?.startsWith('$') || task.name?.toLowerCase().includes('payment') || task.name?.toLowerCase().includes('invoice')) {
        const daysUntilDue = task.endDate
          ? daysBetweenDates(todayStr, task.endDate)
          : null;

        paymentTasks.push({
          taskId: task.id,
          taskName: task.name,
          endDate: task.endDate,
          daysUntilDue,
          isOverdue: daysUntilDue !== null && daysUntilDue < 0 && (task.progress ?? 0) < 1,
          linkedInvoiceId: null,
          amount: null,
        });
      }
    }
  }

  // Find overdue milestones
  const overdueMilestones = paymentTasks.filter((m) => m.isOverdue);

  // Find milestones approaching (due within N days, not overdue, not complete)
  const approachingMilestones = paymentTasks.filter(
    (m) => !m.isOverdue && m.daysUntilDue !== null &&
      m.daysUntilDue >= 0 && m.daysUntilDue <= ALERT_THRESHOLDS.contractMilestoneApproachingDays
  );

  // Find next upcoming milestone
  const upcomingMilestones = paymentTasks
    .filter((m) => !m.isOverdue && m.daysUntilDue !== null && m.daysUntilDue >= 0)
    .sort((a, b) => (a.daysUntilDue ?? 99) - (b.daysUntilDue ?? 99));

  const nextMilestone = upcomingMilestones.length > 0 ? upcomingMilestones[0] : null;

  // Draft invoice tracking — check for unmatched drafts (no matching $ schedule task)
  // Task names follow the format "$ - (Subject)" — extract the label inside parens for matching
  const dollarTaskLabels = paymentTasks
    .filter((t) => t.taskName?.startsWith('$'))
    .map((t) => {
      const raw = t.taskName?.substring(1).trim().toLowerCase() || '';
      // Extract content inside parentheses if present: "- (Some Subject)" → "some subject"
      const parenMatch = raw.match(/\(([^)]+)\)/);
      return parenMatch ? parenMatch[1].trim() : raw;
    });

  const draftInvoiceInfos: DraftInvoiceInfo[] = draftInvoices.map((d) => {
    const subjectLower = (d.subject || d.name || '').trim().toLowerCase();
    const hasMatchingTask = dollarTaskLabels.some((taskLabel) =>
      taskLabel === subjectLower || subjectLower.includes(taskLabel) || taskLabel.includes(subjectLower)
    );
    return {
      documentId: d.id,
      documentName: d.name,
      documentSubject: d.subject || null,
      amount: 0,
      createdAt: d.createdAt,
      isLinkedToTask: hasMatchingTask,
    };
  });

  const unmatchedDraftInvoices = draftInvoiceInfos.filter((d) => !d.isLinkedToTask);

  // Calculate billable items (Cost Code 23) for this contract job
  // Vendor bills with CC23 items = actual costs incurred (materials, subs, labor)
  // Customer invoices with CC23 items = amounts already billed to client
  // Uninvoiced = vendor bill costs - invoiced costs

  // Fetch document-level cost items from vendor bills and non-draft customer invoices
  // (Can't use a single nested query — it causes 413 errors on PAVE)
  const vendorBills = documents.filter((d) => d.type === 'vendorBill' && d.status !== 'denied');
  const customerInvoicesForCC23 = documents.filter(
    (d) => d.type === 'customerInvoice' && d.status !== 'draft'
  );
  const relevantDocs = [...vendorBills, ...customerInvoicesForCC23];

  // Fetch cost items for each relevant document individually (small queries, no 413 risk)
  const docCostItemResults = await Promise.all(
    relevantDocs.map(async (doc) => {
      try {
        const items = await getDocumentCostItemsById(doc.id);
        return items.map((item) => ({ ...item, document: { id: doc.id, name: doc.name || '', type: doc.type } }));
      } catch {
        return [] as JTCostItem[];
      }
    })
  );
  const allDocCostItems = docCostItemResults.flat();

  // Fixed-Price billable filter: Cost Code 23 + costType "Materials" or "Subcontractor"
  // Any CC23 item with a qualifying cost type counts as billable, regardless of item name.
  const allCC23 = allDocCostItems.filter(
    (item) => item.costCode?.number === BILLABLE_COST_CODE_NUMBER
  );

  // Billable costs: CC23 items with Materials or Subcontractor cost type
  const cc23Billable = allCC23.filter(
    (item) => BILLABLE_COST_TYPE_NAMES.includes(item.costType?.name ?? '')
  );
  const cc23BillableOnBills = cc23Billable.filter(
    (item) => item.document?.type === 'vendorBill'
  );
  const cc23BillableOnInvoices = cc23Billable.filter(
    (item) => item.document?.type === 'customerInvoice'
  );
  const cc23BillCosts = cc23BillableOnBills.reduce(
    (sum, item) => sum + (item.cost || 0), 0
  );
  const cc23InvoicedCosts = cc23BillableOnInvoices.reduce(
    (sum, item) => sum + (item.cost || 0), 0
  );
  const uninvoicedBillableAmount = Math.max(0, cc23BillCosts - cc23InvoicedCosts);

  // Calculate unbilled labor hours for contract jobs:
  // 1. Find all time entries tagged to Cost Code 23 (Miscellaneous/Billable) and sum their hours
  // 2. Subtract hours that have been billed on change order invoices
  //    (CC23 Labor cost-type items on customer invoices)
  const billableTimeEntries = timeEntries.filter(
    (entry) => entry.costItem?.costCode?.number === BILLABLE_COST_CODE_NUMBER
  );
  const totalBillableHours = billableTimeEntries.reduce((sum, entry) => {
    if (entry.startedAt && entry.endedAt) {
      const start = new Date(entry.startedAt).getTime();
      const end = new Date(entry.endedAt).getTime();
      return sum + (end - start) / (1000 * 60 * 60);
    }
    return sum;
  }, 0);

  // Only CC23 *Labor* items on customer invoices represent hours already billed.
  // Match by name (contains "labor") rather than costType, because billable labor
  // line items on invoices use costType "Other", not "Labor".
  const cc23LaborOnInvoices = allCC23.filter(
    (item) => item.document?.type === 'customerInvoice' &&
      item.name?.toLowerCase().includes('labor')
  );
  const billedLaborHours = cc23LaborOnInvoices
    .reduce((sum, item) => sum + (item.quantity || 0), 0);

  const unbilledLaborHours = Math.max(0, totalBillableHours - billedLaborHours);

  const roundedLaborHours = Math.round(unbilledLaborHours * 10) / 10;

  // ============================================================
  // Determine health — priority: critical > overdue > warning
  // ============================================================
  let health: InvoicingHealth = 'healthy';

  // CRITICAL: milestone 14+ days past due
  // (Individual overdue milestones shown with name/date in the UI — no summary alert needed)
  if (overdueMilestones.length > 0) {
    const worstOverdue = Math.max(...overdueMilestones.map((m) => Math.abs(m.daysUntilDue ?? 0)));
    if (worstOverdue > 14) {
      health = 'critical';
    } else {
      health = 'overdue';
    }
  }

  // OVERDUE: billable items > $800
  if (uninvoicedBillableAmount > ALERT_THRESHOLDS.contractBillableOverdue) {
    alerts.push(`$${uninvoicedBillableAmount.toLocaleString()} in uninvoiced billable items`);
    if (health !== 'critical' && health !== 'overdue') health = 'overdue';
  }

  // OVERDUE: unbilled labor > 3 hrs
  if (roundedLaborHours > ALERT_THRESHOLDS.contractLaborOverdue) {
    alerts.push(`${roundedLaborHours} unbilled labor hours`);
    if (health !== 'critical' && health !== 'overdue') health = 'overdue';
  }

  // WARNING: milestone approaching (due within 2 days)
  if (approachingMilestones.length > 0 && health === 'healthy') {
    health = 'warning';
    for (const m of approachingMilestones) {
      const dueLabel = m.daysUntilDue === 0 ? 'due today' : `due in ${m.daysUntilDue} day${m.daysUntilDue === 1 ? '' : 's'}`;
      alerts.push(`${m.taskName} — ${dueLabel}`);
    }
  }

  // WARNING: draft invoice with no matching $ schedule task
  // (Individual unmatched invoices shown via CreateTaskRow — no summary alert needed)
  if (unmatchedDraftInvoices.length > 0 && health === 'healthy') {
    health = 'warning';
  }

  // WARNING: billable items > $200 (but not already overdue from > $800)
  if (uninvoicedBillableAmount > ALERT_THRESHOLDS.contractBillableWarning &&
      uninvoicedBillableAmount <= ALERT_THRESHOLDS.contractBillableOverdue) {
    alerts.push(`$${uninvoicedBillableAmount.toLocaleString()} in uninvoiced billable items`);
    if (health === 'healthy') health = 'warning';
  }

  // WARNING: unbilled labor > 1 hr (but not already overdue from > 3 hrs)
  if (roundedLaborHours > ALERT_THRESHOLDS.contractLaborWarning &&
      roundedLaborHours <= ALERT_THRESHOLDS.contractLaborOverdue) {
    alerts.push(`${roundedLaborHours} unbilled labor hours`);
    if (health === 'healthy') health = 'warning';
  }

  // Calculate invoiced amounts from document prices
  // totalContractValue = sum of all approved customer orders (estimates)
  const totalContractValue = estimates.reduce((sum, d) => sum + (d.price || 0), 0);
  // invoicedToDate = sum of approved (paid) + pending (sent/open) customer invoices
  const invoicedToDate = [...approvedInvoices, ...pendingInvoicesDocs]
    .reduce((sum, d) => sum + (d.price || 0), 0);

  // --- Change Order awareness ---
  // Use shared CO tracking to identify approved COs, then calculate their value
  // by matching approved CO group names against approved customerOrder documents.
  let approvedCOValue = 0;
  let appliedCOsCount = 0;
  try {
    const coTracking = await getCOTrackingForJob(job.id);
    const approvedCOs = coTracking.budgetCOs.filter(co => co.isApproved);
    appliedCOsCount = approvedCOs.length;

    if (approvedCOs.length > 0) {
      // Build a set of approved CO names (normalized) for matching against documents
      const approvedCONameSet = new Set(
        approvedCOs.map(co => co.name.toLowerCase().trim())
      );

      // Sum approved customerOrder document prices that correspond to COs
      // CO documents have cost groups whose names match CO budget groups.
      // We need document cost group names — re-fetch docs with cost groups for matching.
      const allApprovedOrders = documents.filter(
        (d) => d.type === 'customerOrder' && d.status === 'approved'
      );

      // The base estimates are the original contract — COs are additional approved orders
      // whose cost groups match Post Pricing CO names.
      // Since we already have `estimates` (all approved customerOrders), we can identify
      // which are COs by checking if any of their cost group names match approved CO names.
      // But we don't have cost group data on documents in this context...
      // Instead, use a simpler heuristic: total approved orders - original estimate = CO value
      const allApprovedOrderValue = allApprovedOrders.reduce((sum, d) => sum + (d.price || 0), 0);
      approvedCOValue = Math.max(0, allApprovedOrderValue - totalContractValue);
    }
  } catch (err: any) {
    console.error(`[Invoicing] CO tracking error for ${job.id}:`, err?.message || err);
  }

  const totalContractAndCOValue = totalContractValue + approvedCOValue;
  const unbilledCOAmount = approvedCOValue > 0
    ? Math.max(0, approvedCOValue - Math.max(0, invoicedToDate - totalContractValue))
    : 0;

  // Released invoices (paid + open) for collapsible detail list
  const releasedInvoiceInfos: ReleasedInvoiceInfo[] = [
    ...approvedInvoices.map((d) => ({
      documentId: d.id,
      documentName: d.name || '',
      documentSubject: d.subject || null,
      documentNumber: d.number || '',
      amount: d.price || 0,
      createdAt: d.createdAt,
      issueDate: d.issueDate || null,
      status: 'paid' as const,
    })),
    ...pendingInvoicesDocs.map((d) => ({
      documentId: d.id,
      documentName: d.name || '',
      documentSubject: d.subject || null,
      documentNumber: d.number || '',
      amount: d.price || 0,
      createdAt: d.createdAt,
      issueDate: d.issueDate || null,
      status: 'open' as const,
    })),
  ];

  return {
    jobId: job.id,
    jobName: job.name,
    jobNumber: job.number,
    clientName: job.clientName || '',
    customStatus: job.customStatus || null,
    priceType: job.priceType,
    totalContractValue,
    invoicedToDate,
    invoicedPercent: totalContractAndCOValue > 0 ? (invoicedToDate / totalContractAndCOValue) * 100 : 0,
    scheduleProgress: schedule?.totalProgress ?? 0,
    nextMilestone,
    overdueMilestones,
    approachingMilestones,
    unmatchedDraftInvoices,
    draftInvoices: draftInvoiceInfos,
    releasedInvoices: releasedInvoiceInfos,
    pendingInvoices,
    uninvoicedBillableAmount,
    unbilledLaborHours: roundedLaborHours,
    approvedCOValue,
    totalContractAndCOValue,
    unbilledCOAmount,
    appliedCOsCount,
    health,
    alerts,
  };
}

// ============================================================
// 4. Analyze Cost Plus Job Invoicing Health
// ============================================================

async function analyzeCostPlusJob(
  job: ExtendedJob,
  documents: JTDocument[],
  timeEntries: JTTimeEntry[],
  costItems: JTCostItem[],
  todayStr: string
): Promise<CostPlusJobHealth> {
  const alerts: string[] = [];

  // Customer invoices
  const customerInvoices = documents.filter((d) => d.type === 'customerInvoice');
  const approvedInvoices = customerInvoices.filter((d) => d.status === 'approved');

  // Find most recent invoice date
  let lastInvoiceDate: string | null = null;
  let daysSinceLastInvoice: number | null = null;

  if (approvedInvoices.length > 0) {
    const sorted = approvedInvoices
      .filter((d) => d.createdAt)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (sorted.length > 0) {
      lastInvoiceDate = sorted[0].createdAt;
      daysSinceLastInvoice = daysSinceDate(todayStr, lastInvoiceDate);
    }
  }

  // ============================================================
  // COST-PLUS UNBILLED CALCULATION — Per-Budget-Item FIFO Deduction
  //
  // JT tracks "Not Invoiced" bills & time in the Bills and Time tab.
  // Multiple vendor bills can share the same budget item (jobCostItemId),
  // so we can't just check presence — we need to deduct invoiced amounts
  // from the oldest bills first (FIFO) per budget item.
  //
  // For time entries, we deduct invoiced HOURS (from invoice quantities)
  // per budget item, oldest entries first.
  // ============================================================

  // Fetch document cost items from vendor bills and non-draft invoices.
  // Uses parallel batches of 5 to balance speed vs PAVE rate limits.
  // (Can't use nested job.documents.costItems — causes 413 on large jobs.
  //  Can't do sequential per-document — causes 504 timeout on 88+ bills.)
  const vendorBills = documents.filter(
    (d) => d.type === 'vendorBill' && d.status !== 'denied'
  );
  const nonDraftInvoices = customerInvoices.filter(
    (d) => d.status !== 'draft'
  );

  const relevantDocs = [...vendorBills, ...nonDraftInvoices];
  const docCostItems: JTCostItem[] = [];
  const BATCH_SIZE = 5;
  for (let i = 0; i < relevantDocs.length; i += BATCH_SIZE) {
    const batch = relevantDocs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (doc) => {
        try {
          const items = await getDocumentCostItemsById(doc.id);
          return items.map((item) => ({
            ...item,
            document: { id: doc.id, name: doc.name || '', type: doc.type, status: doc.status },
          }));
        } catch {
          return [] as JTCostItem[];
        }
      })
    );
    for (const items of batchResults) {
      docCostItems.push(...items);
    }
  }

  // Build vendor bill date lookup for FIFO ordering
  const billDateMap = new Map<string, string>();
  for (const bill of vendorBills) {
    billDateMap.set(bill.id, bill.createdAt || '');
  }

  // Vendor bill cost items (excluding denied/deleted bills)
  const deniedBillIds = new Set(documents.filter(d => d.type === 'vendorBill' && d.status === 'denied').map(d => d.id));
  const vendorBillItems = docCostItems.filter(
    (item) => item.document?.type === 'vendorBill' && !deniedBillIds.has(item.document?.id ?? '')
  );

  // Customer invoice cost items (non-draft only)
  const draftInvoiceIds = new Set(customerInvoices.filter(d => d.status === 'draft').map(d => d.id));
  const invoiceCostItems = docCostItems.filter(
    (item) => item.document?.type === 'customerInvoice' && !draftInvoiceIds.has(item.document?.id ?? '')
  );

  // Collect vendor bill cost items grouped by jobCostItemId (budget item) for FIFO deduction
  type BillCostEntry = { billDocId: string; costItemId: string; cost: number; date: string };
  const billsByBudgetItem = new Map<string, BillCostEntry[]>();

  for (const item of vendorBillItems) {
    const budgetId = (item as any).jobCostItem?.id || item.id;
    if (!billsByBudgetItem.has(budgetId)) billsByBudgetItem.set(budgetId, []);
    billsByBudgetItem.get(budgetId)!.push({
      billDocId: item.document?.id || '',
      costItemId: item.id,
      cost: item.cost || 0,
      date: billDateMap.get(item.document?.id || '') || '',
    });
  }

  // Collect invoiced amounts per budget item from non-draft customer invoices
  const invoicedByBudgetItem = new Map<string, number>();
  const invoicedHoursByBudgetItem = new Map<string, number>();

  for (const item of invoiceCostItems) {
    const budgetId = (item as any).jobCostItem?.id || item.id;
    invoicedByBudgetItem.set(
      budgetId,
      (invoicedByBudgetItem.get(budgetId) || 0) + (item.cost || 0)
    );
    // Track invoiced hours (from quantity) for budget items that have time entries
    invoicedHoursByBudgetItem.set(
      budgetId,
      (invoicedHoursByBudgetItem.get(budgetId) || 0) + (item.quantity || 0)
    );
  }

  // BILLS: Per-budget-item FIFO deduction
  // For each budget item, deduct invoiced amount from oldest bills first.
  // Vendor bill cost that isn't covered by invoiced amounts = uninvoiced.
  let unbilledCosts = 0;
  billsByBudgetItem.forEach((bills, budgetId) => {
    // Sort bills by date (oldest first) for FIFO
    bills.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let remaining = invoicedByBudgetItem.get(budgetId) || 0;

    for (const bill of bills) {
      if (remaining >= bill.cost) {
        // Bill is fully covered by invoiced amount
        remaining -= bill.cost;
      } else {
        // Bill is partially or fully uninvoiced
        unbilledCosts += bill.cost - Math.max(0, remaining);
        remaining = 0;
      }
    }
  });
  const unbilledAmount = unbilledCosts;

  // TIME: Per-budget-item hour deduction (FIFO by date)
  // Group time entries by their budget cost item (costItem.id), then deduct
  // invoiced hours per budget item from the oldest entries first.
  // For cost-plus jobs, ALL hours are billable.
  type TimeEntryInfo = { id: string; hours: number; cost: number; date: string };
  const timeByBudgetItem = new Map<string, TimeEntryInfo[]>();

  for (const te of timeEntries) {
    if (!te.startedAt || !te.endedAt) continue;
    const hours = (new Date(te.endedAt).getTime() - new Date(te.startedAt).getTime()) / (1000 * 60 * 60);
    const budgetId = te.costItem?.id || 'unknown';
    if (!timeByBudgetItem.has(budgetId)) timeByBudgetItem.set(budgetId, []);
    timeByBudgetItem.get(budgetId)!.push({
      id: te.id,
      hours,
      cost: (te as any).cost || 0,
      date: te.startedAt,
    });
  }

  let unbilledHours = 0;
  let unbilledTimeCost = 0;
  timeByBudgetItem.forEach((entries, budgetId) => {
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // How many hours of this budget item were invoiced?
    // Use invoice quantities as hours. But first, subtract any vendor bill costs
    // that consumed invoiced amounts for this budget item.
    const totalInvoiced = invoicedByBudgetItem.get(budgetId) || 0;
    const totalBillCost = (billsByBudgetItem.get(budgetId) || []).reduce((s, b) => s + b.cost, 0);
    // Bills consume invoiced amounts first; remaining goes to time
    const invoicedForBills = Math.min(totalBillCost, totalInvoiced);
    // For time, use the hours from invoice quantities rather than cost amounts
    // (invoice costs use billing rates, time entry costs use internal rates — they differ)
    const invoicedHrs = invoicedHoursByBudgetItem.get(budgetId) || 0;
    // If this budget item has vendor bills, the invoice hours might include bill-related items
    // Only count hours as time coverage when there are NO vendor bills for this budget item
    let remainingHoursCredit = totalBillCost > 0 ? 0 : invoicedHrs;

    for (const entry of entries) {
      if (remainingHoursCredit >= entry.hours) {
        remainingHoursCredit -= entry.hours;
      } else {
        const uninvoicedHrs = entry.hours - Math.max(0, remainingHoursCredit);
        unbilledHours += uninvoicedHrs;
        unbilledTimeCost += entry.cost * (uninvoicedHrs / entry.hours);
        remainingHoursCredit = 0;
      }
    }
  });

  // Round FIFO accumulators to cents / tenths of an hour.
  // Without this, floating-point residues (~1e-13) from subtracting bill costs
  // leave non-zero "unbilled" values that pass `> 0` checks but render as "$0",
  // incorrectly flagging fully-invoiced jobs as critical. Fix: eliminate the
  // noise before the health determination.
  unbilledCosts = Math.round(unbilledCosts * 100) / 100;
  unbilledTimeCost = Math.round(unbilledTimeCost * 100) / 100;
  unbilledHours = Math.round(unbilledHours * 10) / 10;

  // Draft invoices
  const draftInvoices = customerInvoices.filter((d) => d.status === 'draft');
  const draftInvoiceInfos: DraftInvoiceInfo[] = draftInvoices.map((d) => ({
    documentId: d.id,
    documentName: d.name,
    documentSubject: d.subject || null,
    amount: d.price || 0,
    createdAt: d.createdAt,
    isLinkedToTask: false,
  }));

  // Total invoiced (actual dollar amounts from approved + pending invoices)
  const pendingInvoices = customerInvoices.filter((d) => d.status === 'pending');
  const totalInvoiced = [...approvedInvoices, ...pendingInvoices].reduce(
    (sum, d) => sum + (d.price || 0), 0
  );

  // Released invoices (paid + open) for collapsible detail list
  const releasedInvoiceInfos: ReleasedInvoiceInfo[] = [
    ...approvedInvoices.map((d) => ({
      documentId: d.id,
      documentName: d.name || '',
      documentSubject: d.subject || null,
      documentNumber: d.number || '',
      amount: d.price || 0,
      createdAt: d.createdAt,
      issueDate: d.issueDate || null,
      status: 'paid' as const,
    })),
    ...pendingInvoices.map((d) => ({
      documentId: d.id,
      documentName: d.name || '',
      documentSubject: d.subject || null,
      documentNumber: d.number || '',
      amount: d.price || 0,
      createdAt: d.createdAt,
      issueDate: d.issueDate || null,
      status: 'open' as const,
    })),
  ];

  // Determine health
  // If there are no unbilled costs AND no unbilled hours, the project is healthy
  // regardless of how long since the last invoice — there's nothing to bill.
  let health: InvoicingHealth = 'healthy';
  const hasUnbilledWork = unbilledCosts > 0 || unbilledHours > 0;

  // Total unbilled amount includes both vendor bill costs AND uninvoiced time costs
  const totalUnbilledAmount = unbilledCosts + unbilledTimeCost;

  if (hasUnbilledWork && daysSinceLastInvoice !== null) {
    // Has at least one approved invoice — check staleness against last invoice date
    if (daysSinceLastInvoice > COST_PLUS_BILLING_CADENCE_DAYS * 2) {
      health = 'critical';
      alerts.push(`${daysSinceLastInvoice} days since last invoice — over 2x billing cadence`);
    } else if (daysSinceLastInvoice > ALERT_THRESHOLDS.costPlusOverdueDays) {
      health = 'overdue';
      alerts.push(`${daysSinceLastInvoice} days since last invoice — billing overdue`);
    } else if (daysSinceLastInvoice > ALERT_THRESHOLDS.costPlusWarningDays) {
      health = 'warning';
      alerts.push(`${daysSinceLastInvoice} days since last invoice — billing due soon`);
    }
  } else if (hasUnbilledWork && daysSinceLastInvoice === null) {
    // No invoices have ever been created — check staleness against earliest work date
    // (oldest time entry or vendor bill)
    let earliestWorkDate: string | null = null;
    Array.from(timeByBudgetItem.values()).forEach((entries) => {
      for (const entry of entries) {
        if (entry.date && (!earliestWorkDate || entry.date < earliestWorkDate)) {
          earliestWorkDate = entry.date;
        }
      }
    });
    Array.from(billsByBudgetItem.values()).forEach((bills) => {
      for (const bill of bills) {
        if (bill.date && (!earliestWorkDate || bill.date < earliestWorkDate)) {
          earliestWorkDate = bill.date;
        }
      }
    });

    if (earliestWorkDate) {
      const daysSinceFirstWork = daysSinceDate(todayStr, earliestWorkDate);
      if (daysSinceFirstWork !== null && daysSinceFirstWork > COST_PLUS_BILLING_CADENCE_DAYS * 2) {
        health = 'critical';
        alerts.push(`No invoices created — work started ${daysSinceFirstWork} days ago`);
      } else if (daysSinceFirstWork !== null && daysSinceFirstWork > ALERT_THRESHOLDS.costPlusOverdueDays) {
        health = 'overdue';
        alerts.push(`No invoices created — work started ${daysSinceFirstWork} days ago`);
      } else if (daysSinceFirstWork !== null && daysSinceFirstWork > ALERT_THRESHOLDS.costPlusWarningDays) {
        health = 'warning';
        alerts.push(`No invoices created — work started ${daysSinceFirstWork} days ago`);
      } else {
        // Work is recent but still never invoiced — at minimum a warning
        health = 'warning';
        alerts.push('No invoices created yet');
      }
    } else {
      // Has unbilled work but can't determine when — flag as warning
      health = 'warning';
      alerts.push('Unbilled work with no invoices created');
    }
  }

  if (hasUnbilledWork && totalUnbilledAmount > ALERT_THRESHOLDS.unbilledAmountThreshold) {
    alerts.push(`$${totalUnbilledAmount.toLocaleString()} in unbilled costs`);
    if (health === 'healthy') health = 'warning';
  }

  if (unbilledHours > 0) {
    alerts.push(`${unbilledHours.toFixed(1)} unbilled hours`);
    if (health === 'healthy') health = 'warning';
  }

  return {
    jobId: job.id,
    jobName: job.name,
    jobNumber: job.number,
    clientName: job.clientName || '',
    customStatus: job.customStatus || null,
    lastInvoiceDate,
    daysSinceLastInvoice,
    unbilledCosts,
    unbilledHours: Math.round(unbilledHours * 10) / 10,
    unbilledAmount: totalUnbilledAmount,
    invoiceCount: approvedInvoices.length,
    totalInvoiced,
    draftInvoices: draftInvoiceInfos,
    releasedInvoices: releasedInvoiceInfos,
    health,
    alerts,
  };
}

// ============================================================
// 5. Find Billable Items Across All Jobs
// ============================================================

function findBillableItems(
  job: ExtendedJob,
  costItems: JTCostItem[],
  timeEntries: JTTimeEntry[]
): BillableItemsSummary | null {
  // Find cost items with cost code 23 AND name starting with "23 Billable"
  const billableCostItems = costItems.filter(
    (item) => item.costCode?.number === BILLABLE_COST_CODE_NUMBER &&
      item.name?.startsWith(BILLABLE_NAME_PREFIX)
  );

  // Compare CC23 costs on vendor bills vs customer invoices.
  // Unbilled = costs on bills that haven't been invoiced to the customer.
  const cc23OnBills = billableCostItems.filter(
    (item) => item.document?.type === 'vendorBill'
  );
  const cc23OnInvoices = billableCostItems.filter(
    (item) => item.document?.type === 'customerInvoice'
  );
  const cc23BillCosts = cc23OnBills.reduce(
    (sum, item) => sum + (item.cost || 0), 0
  );
  // Only Materials & Subs on invoices reduce billable costs — Labor does not.
  const cc23InvoicedCosts = cc23OnInvoices
    .filter((item) => !item.name?.toLowerCase().includes('labor'))
    .reduce((sum, item) => sum + (item.cost || 0), 0);
  const totalUninvoicedAmount = Math.max(0, cc23BillCosts - cc23InvoicedCosts);

  // Build uninvoiced items list from bills not yet invoiced
  const uninvoicedItems: BillableItem[] = cc23OnBills.map((item) => ({
    costItemId: item.id,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitCost,
    totalPrice: item.cost || 0,
    costGroupName: item.costGroup?.name || 'Ungrouped',
    onDocument: true,
    documentName: item.document?.name || 'Bill',
  }));

  // Find billable time entries (type = "work" with costItem referencing billable code)
  const billableTimeEntries: BillableHourEntry[] = timeEntries
    .filter((entry) => {
      if (entry.costItem) {
        return billableCostItems.some((ci) => ci.id === entry.costItem?.id);
      }
      return false;
    })
    .map((entry) => {
      const hours =
        entry.startedAt && entry.endedAt
          ? (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) /
            (1000 * 60 * 60)
          : 0;
      return {
        timeEntryId: entry.id,
        userName: entry.user?.name || 'Unknown',
        hours: Math.round(hours * 100) / 100,
        date: entry.startedAt?.slice(0, 10) || '',
        notes: entry.notes || null,
        costItemName: entry.costItem?.name || null,
      };
    });

  const totalUninvoicedHours = billableTimeEntries.reduce((sum, entry) => sum + entry.hours, 0);

  if (cc23OnBills.length === 0 && billableTimeEntries.length === 0) {
    return null; // No billable items for this job
  }

  return {
    jobId: job.id,
    jobName: job.name,
    jobNumber: job.number,
    clientName: job.clientName || '',
    customStatus: job.customStatus || null,
    priceType: job.priceType,
    uninvoicedItems,
    uninvoicedHours: billableTimeEntries,
    totalUninvoicedAmount,
    totalUninvoicedHours,
  };
}

// ============================================================
// 6. Build Full Invoicing Health Context (main entry point)
// ============================================================

// Only show jobs with these custom Status values on the dashboard
const DASHBOARD_ALLOWED_STATUSES = [
  '5. Design Phase',
  '6. In Production',
  '7. Final Billing',
  '9. On Hold',
  '10. Ready',
];

export async function buildInvoicingContext(): Promise<InvoicingFullContext> {
  const todayStr = getTodayDateString();

  // 1. Get all active jobs (now includes native priceType field from PAVE API)
  const allJobs = await getActiveJobs(50);

  // 1b. Filter to only jobs with allowed custom Status values
  const rawJobs = allJobs.filter((job) => {
    const status = job.customStatus || '';
    return DASHBOARD_ALLOWED_STATUSES.includes(status);
  });

  console.log(`[InvoicingHealth] Filtered ${allJobs.length} active jobs → ${rawJobs.length} with allowed status`);

  // 2. For each job, fetch documents, cost items, and time entries
  //    Use batched concurrency (5 jobs at a time) to avoid overwhelming the PAVE API
  const BATCH_SIZE = 5;
  const jobContexts: Array<{
    job: JTJob;
    documents: JTDocument[];
    costItems: JTCostItem[];
    timeEntries: JTTimeEntry[];
  }> = [];

  for (let i = 0; i < rawJobs.length; i += BATCH_SIZE) {
    const batch = rawJobs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (job) => {
        try {
          const [documents, costItems, timeEntries] = await Promise.all([
            getDocumentsForJob(job.id),
            getCostItemsForJobLite(job.id, 200),
            getTimeEntriesForJob(job.id),
          ]);

          if (documents.length === 0 && costItems.length === 0 && timeEntries.length === 0) {
            console.warn(`[InvoicingHealth] WARNING: All data empty for job ${job.name} (${job.id}) — possible API issue`);
          }

          return { job, documents, costItems, timeEntries };
        } catch (err: any) {
          console.error(`[InvoicingHealth] FAILED to fetch data for job ${job.name} (${job.id}): ${err?.message || err}`);
          return { job, documents: [] as JTDocument[], costItems: [] as JTCostItem[], timeEntries: [] as JTTimeEntry[] };
        }
      })
    );
    jobContexts.push(...batchResults);
  }

  console.log(`[InvoicingHealth] Fetched data for ${jobContexts.length} jobs — ` +
    `docs: ${jobContexts.reduce((s, j) => s + j.documents.length, 0)}, ` +
    `costItems: ${jobContexts.reduce((s, j) => s + j.costItems.length, 0)}, ` +
    `timeEntries: ${jobContexts.reduce((s, j) => s + j.timeEntries.length, 0)}`);

  // 3. Classify each job by its native priceType field from JobTread

  const extendedJobs: Array<{
    job: ExtendedJob;
    documents: JTDocument[];
    costItems: JTCostItem[];
    timeEntries: JTTimeEntry[];
  }> = jobContexts.map(({ job, documents, costItems, timeEntries }) => {
    // Use the native priceType field from JobTread PAVE API
    // Values: "fixed" = Fixed-Price, "costPlus" = Cost-Plus
    let priceType = 'unknown';

    if (job.priceType === 'fixed') {
      priceType = 'Fixed-Price';
    } else if (job.priceType === 'costPlus') {
      priceType = 'Cost-Plus';
    } else if (job.priceType) {
      // Handle any other future values
      priceType = job.priceType;
    }

    return {
      job: { ...job, priceType } as ExtendedJob,
      documents,
      costItems,
      timeEntries,
    };
  });

  // 4. Process each job by type
  const contractJobs: ContractJobHealth[] = [];
  const costPlusJobs: CostPlusJobHealth[] = [];
  const billableItems: BillableItemsSummary[] = [];
  const globalAlerts: string[] = [];

  for (const { job, documents, costItems, timeEntries } of extendedJobs) {
    // Contract (Fixed-Price) analysis
    if (job.priceType === 'Fixed-Price') {
      const contractHealth = await analyzeContractJob(job, documents, costItems, timeEntries, todayStr);
      contractJobs.push(contractHealth);
      globalAlerts.push(...contractHealth.alerts.map((a) => `[${job.name}] ${a}`));
    }

    // Cost Plus analysis
    if (job.priceType === 'Cost-Plus') {
      try {
        const cpHealth = await analyzeCostPlusJob(job, documents, timeEntries, costItems, todayStr);
        costPlusJobs.push(cpHealth);
        globalAlerts.push(...cpHealth.alerts.map((a) => `[${job.name}] ${a}`));
      } catch (err: any) {
        console.error(`[InvoicingHealth] Cost-Plus analysis FAILED for ${job.name}: ${err?.message || err}`);
      }
    }

    // Billable items — only for non-contract jobs (contract jobs handle CC23 in analyzeContractJob)
    if (job.priceType !== 'Fixed-Price') {
      // Exclude cost items belonging to denied (deleted) vendor bills
      const deniedBillIdsForBillable = new Set(
        documents.filter((d) => d.type === 'vendorBill' && d.status === 'denied').map((d) => d.id)
      );
      const activeCostItems = costItems.filter(
        (item) => !(item.document?.type === 'vendorBill' && deniedBillIdsForBillable.has(item.document?.id ?? ''))
      );
      const billable = findBillableItems(job, activeCostItems, timeEntries);
      if (billable) {
        billableItems.push(billable);
        if (billable.totalUninvoicedAmount > ALERT_THRESHOLDS.unbilledAmountThreshold) {
          globalAlerts.push(
            `[${job.name}] $${billable.totalUninvoicedAmount.toLocaleString()} in uninvoiced billable items`
          );
        }
      }
    }
  }

  // 5. Calculate summary stats
  const totalAlerts = contractJobs.reduce((sum, j) => sum + j.alerts.length, 0) +
    costPlusJobs.reduce((sum, j) => sum + j.alerts.length, 0);

  // Only count Cost Code 23 billable items (contract uninvoiced + billable items pending)
  const totalUnbilledAmount =
    contractJobs.reduce((sum, j) => sum + j.uninvoicedBillableAmount, 0) +
    billableItems.reduce((sum, j) => sum + j.totalUninvoicedAmount, 0);

  // Sum unbilled labor hours from both job types
  const totalUnbilledHours =
    contractJobs.reduce((sum, j) => sum + j.unbilledLaborHours, 0) +
    costPlusJobs.reduce((sum, j) => sum + j.unbilledHours, 0);

  // Overall health: worst of all jobs
  let overallHealth: InvoicingHealth = 'healthy';
  const allHealthStatuses = [
    ...contractJobs.map((j) => j.health),
    ...costPlusJobs.map((j) => j.health),
  ];
  if (allHealthStatuses.includes('critical')) overallHealth = 'critical';
  else if (allHealthStatuses.includes('overdue')) overallHealth = 'overdue';
  else if (allHealthStatuses.includes('warning')) overallHealth = 'warning';

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalOpenJobs: rawJobs.length,
      contractJobs: contractJobs.length,
      costPlusJobs: costPlusJobs.length,
      totalAlerts,
      totalUnbilledAmount,
      totalUnbilledHours: Math.round(totalUnbilledHours * 10) / 10,
      overallHealth,
    },
    contractJobs,
    costPlusJobs,
    billableItems,
    alerts: globalAlerts,
  };
}

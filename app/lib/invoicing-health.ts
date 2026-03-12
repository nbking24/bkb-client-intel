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
  type JTJob,
  type JTDocument,
  type JTCostItem,
  type JTTimeEntry,
} from './jobtread';

// ============================================================
// Constants
// ============================================================

/** Cost Code 23 = "Miscellaneous/Billable Labor" */
const BILLABLE_COST_CODE_NUMBER = '23';

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
  pendingInvoices: PendingInvoiceInfo[];
  uninvoicedBillableAmount: number;
  unbilledLaborHours: number;
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
  daysPending: number;
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
  const today = new Date(todayStr);
  const pendingInvoices: PendingInvoiceInfo[] = pendingInvoicesDocs.map((d) => {
    const created = new Date(d.createdAt);
    const daysPending = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    return {
      documentId: d.id,
      documentSubject: d.subject || null,
      documentNumber: d.number,
      amount: d.price || 0,
      createdAt: d.createdAt,
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
  // Fetch document-level cost items from vendor bills and customer invoices individually
  // (Can't use a single nested query — it causes 413 errors on PAVE)
  const vendorBills = documents.filter((d) => d.type === 'vendorBill');
  const customerInvoicesForCC23 = documents.filter((d) => d.type === 'customerInvoice');
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

  const docCC23 = allDocCostItems.filter(
    (item) => item.costCode?.number === BILLABLE_COST_CODE_NUMBER
  );
  const cc23OnBills = docCC23.filter(
    (item) => item.document?.type === 'vendorBill'
  );
  const cc23OnInvoices = docCC23.filter(
    (item) => item.document?.type === 'customerInvoice'
  );
  const cc23BillCosts = cc23OnBills.reduce(
    (sum, item) => sum + (item.cost || 0), 0
  );
  const cc23InvoicedCosts = cc23OnInvoices.reduce(
    (sum, item) => sum + (item.cost || 0), 0
  );
  const uninvoicedBillableAmount = Math.max(0, cc23BillCosts - cc23InvoicedCosts);

  // Calculate unbilled labor hours for contract jobs:
  // 1. Find all time entries tagged to Cost Code 23 (Miscellaneous/Billable) and sum their hours
  // 2. Subtract hours that have been billed on change order invoices
  //    (CC23 labor items on customer invoices)
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

  // CC23 labor items on customer invoices represent hours already billed
  // (cc23OnInvoices already computed above for billable costs)
  const billedLaborHours = cc23OnInvoices.reduce((sum, item) => {
    return sum + (item.quantity || 0);
  }, 0);

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

  // Calculate invoiced amounts (count-based for MVP, enhance with actual amounts later)
  const invoicedToDate = approvedInvoices.length;
  const totalContractValue = estimates.length; // Placeholder — enhance with actual amounts

  return {
    jobId: job.id,
    jobName: job.name,
    jobNumber: job.number,
    clientName: job.clientName || '',
    customStatus: job.customStatus || null,
    priceType: job.priceType,
    totalContractValue,
    invoicedToDate,
    invoicedPercent: totalContractValue > 0 ? (invoicedToDate / totalContractValue) * 100 : 0,
    scheduleProgress: schedule?.totalProgress ?? 0,
    nextMilestone,
    overdueMilestones,
    approachingMilestones,
    unmatchedDraftInvoices,
    draftInvoices: draftInvoiceInfos,
    pendingInvoices,
    uninvoicedBillableAmount,
    unbilledLaborHours: roundedLaborHours,
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

  // Calculate unbilled costs: actual costs incurred (vendor bills only) vs costs billed on invoices
  // Only vendor bills represent real money spent — unattached budget items are just estimates
  const costItemsOnBills = costItems.filter(
    (item) => item.document?.type === 'vendorBill'
  );
  const totalJobCosts = costItemsOnBills.reduce(
    (sum, item) => sum + (item.cost || 0), 0
  );
  const costItemsOnInvoices = costItems.filter(
    (item) => item.document?.type === 'customerInvoice'
  );
  const totalCostsBilled = costItemsOnInvoices.reduce(
    (sum, item) => sum + (item.cost || 0), 0
  );
  const unbilledCosts = Math.max(0, totalJobCosts - totalCostsBilled);
  const unbilledAmount = unbilledCosts;

  // Calculate unbilled hours: total time entries vs labor hours billed on invoices
  const totalHours = timeEntries.reduce((sum, entry) => {
    if (entry.startedAt && entry.endedAt) {
      const start = new Date(entry.startedAt).getTime();
      const end = new Date(entry.endedAt).getTime();
      return sum + (end - start) / (1000 * 60 * 60);
    }
    return sum;
  }, 0);
  const billedLaborHours = costItemsOnInvoices
    .filter((item) => item.costType?.name?.toLowerCase().includes('labor'))
    .reduce((sum, item) => sum + (item.quantity || 0), 0);
  const unbilledHours = Math.max(0, totalHours - billedLaborHours);

  // Total invoiced (actual dollar amounts from approved + pending invoices)
  const pendingInvoices = customerInvoices.filter((d) => d.status === 'pending');
  const totalInvoiced = [...approvedInvoices, ...pendingInvoices].reduce(
    (sum, d) => sum + (d.price || 0), 0
  );

  // Determine health
  let health: InvoicingHealth = 'healthy';

  if (daysSinceLastInvoice !== null) {
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
  }

  if (unbilledAmount > ALERT_THRESHOLDS.unbilledAmountThreshold) {
    alerts.push(`$${unbilledAmount.toLocaleString()} in unbilled costs`);
    if (health === 'healthy') health = 'warning';
  }

  if (unbilledHours > 0) {
    alerts.push(`${unbilledHours.toFixed(1)} unbilled hours`);
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
    unbilledAmount,
    invoiceCount: approvedInvoices.length,
    totalInvoiced,
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
  // Find cost items with cost code 23 (Billable Labor)
  const billableCostItems = costItems.filter(
    (item) => item.costCode?.number === BILLABLE_COST_CODE_NUMBER
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
  const cc23InvoicedCosts = cc23OnInvoices.reduce(
    (sum, item) => sum + (item.cost || 0), 0
  );
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

export async function buildInvoicingContext(): Promise<InvoicingFullContext> {
  const todayStr = getTodayDateString();

  // 1. Get all active jobs (now includes native priceType field from PAVE API)
  const rawJobs = await getActiveJobs(50);

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
            getTimeEntriesForJob(job.id, 100),
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
      const cpHealth = await analyzeCostPlusJob(job, documents, timeEntries, costItems, todayStr);
      costPlusJobs.push(cpHealth);
      globalAlerts.push(...cpHealth.alerts.map((a) => `[${job.name}] ${a}`));
    }

    // Billable items — check ALL jobs regardless of type
    const billable = findBillableItems(job, costItems, timeEntries);
    if (billable) {
      billableItems.push(billable);
      if (billable.totalUninvoicedAmount > ALERT_THRESHOLDS.unbilledAmountThreshold) {
        globalAlerts.push(
          `[${job.name}] $${billable.totalUninvoicedAmount.toLocaleString()} in uninvoiced billable items`
        );
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

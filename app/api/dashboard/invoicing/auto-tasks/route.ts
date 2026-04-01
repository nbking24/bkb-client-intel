// ============================================================
// Proactive Invoicing Task Creator
//
// GET → Analyzes all active jobs and creates/updates JT tasks
//       assigned to Terri when invoicing action is needed.
//
// Rules:
// - ONE task per job max (named "Invoice: <JobName>")
// - Tasks created under "Admin Tasks" schedule group
// - Assigned to Terri (membership ID from constants)
// - Skips jobs where the task already exists and is incomplete
//
// Trigger criteria:
//   Contract (Fixed-Price):
//     - $ milestone due within 1 day, no matching invoice
//     - $ milestone overdue + not complete
//     - CC23 unbilled billables > $500
//     - CC23 unbilled labor > 2 hours
//   Cost Plus:
//     - >10 days since last invoice, unbilled > $100
//     - Active >7 days with zero invoices sent
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  buildInvoicingContext,
  type ContractJobHealth,
  type CostPlusJobHealth,
} from '@/app/lib/invoicing-health';
import {
  getJobSchedule,
  createPhaseGroup,
  createPhaseTask,
  type JTScheduleTask,
} from '@/app/lib/jobtread';
import { JT_MEMBERS } from '@/app/lib/constants';

export const runtime = 'nodejs';
export const maxDuration = 120;

// ============================================================
// Thresholds
// ============================================================

const THRESHOLDS = {
  // Contract (Fixed-Price)
  milestoneDueDays: 1,          // Create task when milestone due within N days
  unbilledBillableAmount: 500,  // CC23 billable items > $500
  unbilledLaborHours: 2,        // CC23 labor hours > 2

  // Cost Plus
  costPlusCadenceDays: 10,      // Days since last invoice
  costPlusMinUnbilled: 100,     // Minimum unbilled amount to trigger
  costPlusFirstInvoiceDays: 7,  // Days active with zero invoices
} as const;

const ADMIN_TASKS_GROUP = 'Admin Tasks';
const TASK_PREFIX = 'Invoice:';
const TERRI_MEMBERSHIP_ID = JT_MEMBERS.terri; // '22P5SpJkype2'

// ============================================================
// Helpers
// ============================================================

function flattenTasks(tasks: JTScheduleTask[]): JTScheduleTask[] {
  const result: JTScheduleTask[] = [];
  for (const task of tasks) {
    result.push(task);
    if (task.childTasks?.nodes?.length) {
      result.push(...flattenTasks(task.childTasks.nodes));
    }
  }
  return result;
}

/** Build concise task description from trigger reasons */
function buildDescription(reasons: string[]): string {
  return reasons.join(' | ');
}

// ============================================================
// Evaluate triggers for a Contract job
// ============================================================

function evaluateContractJob(job: ContractJobHealth): string[] {
  const reasons: string[] = [];

  // Milestone due within 1 day (and no draft/sent invoice matches it)
  for (const m of job.approachingMilestones) {
    if (m.daysUntilDue !== null && m.daysUntilDue <= THRESHOLDS.milestoneDueDays) {
      const label = m.daysUntilDue === 0 ? 'due today' : 'due tomorrow';
      reasons.push(`Milestone "${m.taskName}" ${label}`);
    }
  }

  // Overdue milestones (past due, not complete)
  for (const m of job.overdueMilestones) {
    const days = Math.abs(m.daysUntilDue ?? 0);
    reasons.push(`Milestone "${m.taskName}" ${days}d overdue`);
  }

  // Unbilled CC23 billables > $500
  if (job.uninvoicedBillableAmount > THRESHOLDS.unbilledBillableAmount) {
    reasons.push(`$${Math.round(job.uninvoicedBillableAmount).toLocaleString()} unbilled billables`);
  }

  // Unbilled CC23 labor > 2 hours
  if (job.unbilledLaborHours > THRESHOLDS.unbilledLaborHours) {
    reasons.push(`${job.unbilledLaborHours}h unbilled labor`);
  }

  return reasons;
}

// ============================================================
// Evaluate triggers for a Cost Plus job
// ============================================================

function evaluateCostPlusJob(job: CostPlusJobHealth): string[] {
  const reasons: string[] = [];

  // Cadence exceeded: >10 days since last invoice + unbilled > $100
  if (
    job.daysSinceLastInvoice !== null &&
    job.daysSinceLastInvoice > THRESHOLDS.costPlusCadenceDays &&
    job.unbilledAmount > THRESHOLDS.costPlusMinUnbilled
  ) {
    reasons.push(
      `${job.daysSinceLastInvoice}d since last invoice, $${Math.round(job.unbilledAmount).toLocaleString()} unbilled`
    );
  }

  // First invoice never sent: active >7 days with zero invoices
  if (
    job.daysSinceLastInvoice === null &&
    job.invoiceCount === 0
  ) {
    // We don't have a direct "days since job created" field on CostPlusJobHealth,
    // but if there's no invoice at all and unbilled > $0, it needs attention.
    // The invoicing-health system only includes jobs with activity, so if it's here
    // with zero invoices, it's been active and worked on.
    if (job.unbilledAmount > 0) {
      reasons.push(`No invoices sent yet, $${Math.round(job.unbilledAmount).toLocaleString()} unbilled`);
    }
  }

  return reasons;
}

// ============================================================
// Create or find task on a job
// ============================================================

async function ensureInvoiceTask(
  jobId: string,
  jobName: string,
  reasons: string[],
): Promise<{ action: 'created' | 'exists' | 'error'; taskName: string; error?: string }> {
  const taskName = `${TASK_PREFIX} ${jobName}`;

  try {
    // 1. Get job schedule to check for existing task
    const schedule = await getJobSchedule(jobId);
    if (!schedule) {
      return { action: 'error', taskName, error: 'Could not load job schedule' };
    }

    const allTasks = flattenTasks([...schedule.phases, ...schedule.orphanTasks]);

    // 2. Check if task already exists (incomplete)
    const existing = allTasks.find(
      (t) =>
        !t.isGroup &&
        t.name?.startsWith(TASK_PREFIX) &&
        (t.progress === null || t.progress === undefined || t.progress < 1)
    );

    if (existing) {
      return { action: 'exists', taskName: existing.name };
    }

    // 3. Find or create "Admin Tasks" group
    let groupId = '';
    const adminGroup = allTasks.find(
      (t) =>
        t.isGroup &&
        t.name
          ?.toLowerCase()
          .replace(/\*/g, '')
          .trim() === ADMIN_TASKS_GROUP.toLowerCase()
    );

    if (adminGroup) {
      groupId = adminGroup.id;
    } else {
      const created = await createPhaseGroup({
        jobId,
        name: ADMIN_TASKS_GROUP,
      });
      groupId = created.id;
    }

    // 4. Create the task
    const description = buildDescription(reasons);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const created = await createPhaseTask({
      jobId,
      parentGroupId: groupId,
      name: taskName,
      description,
      endDate: today,
      assignedMembershipIds: [TERRI_MEMBERSHIP_ID],
    });

    return { action: 'created', taskName: created.name };
  } catch (err: any) {
    return { action: 'error', taskName, error: err.message };
  }
}

// ============================================================
// GET Handler
// ============================================================

export async function GET(req: NextRequest) {
  console.log('[InvoiceAutoTasks] Starting proactive task scan...');
  const startTime = Date.now();

  try {
    // 1. Run invoicing health analysis
    const context = await buildInvoicingContext();

    const results: Array<{
      jobName: string;
      jobType: string;
      reasons: string[];
      action: string;
      error?: string;
    }> = [];

    // 2. Evaluate contract jobs
    for (const job of context.contractJobs) {
      const reasons = evaluateContractJob(job);
      if (reasons.length === 0) continue;

      const result = await ensureInvoiceTask(job.jobId, job.jobName, reasons);
      results.push({
        jobName: job.jobName,
        jobType: 'contract',
        reasons,
        action: result.action,
        error: result.error,
      });
    }

    // 3. Evaluate cost-plus jobs
    for (const job of context.costPlusJobs) {
      const reasons = evaluateCostPlusJob(job);
      if (reasons.length === 0) continue;

      const result = await ensureInvoiceTask(job.jobId, job.jobName, reasons);
      results.push({
        jobName: job.jobName,
        jobType: 'cost_plus',
        reasons,
        action: result.action,
        error: result.error,
      });
    }

    const elapsed = Date.now() - startTime;
    const created = results.filter((r) => r.action === 'created');
    const existing = results.filter((r) => r.action === 'exists');
    const errors = results.filter((r) => r.action === 'error');

    const summary = {
      scannedJobs: context.summary.totalOpenJobs,
      contractJobs: context.summary.contractJobs,
      costPlusJobs: context.summary.costPlusJobs,
      triggered: results.length,
      tasksCreated: created.length,
      tasksAlreadyExist: existing.length,
      errors: errors.length,
      elapsedMs: elapsed,
    };

    console.log(`[InvoiceAutoTasks] Done in ${elapsed}ms`);
    console.log(`  Scanned: ${summary.scannedJobs} jobs`);
    console.log(`  Triggered: ${summary.triggered} jobs need invoicing`);
    console.log(`  Created: ${summary.tasksCreated} new tasks`);
    console.log(`  Already exist: ${summary.tasksAlreadyExist}`);
    if (errors.length > 0) {
      console.log(`  Errors: ${errors.length}`);
      errors.forEach((e) => console.log(`    - ${e.jobName}: ${e.error}`));
    }

    return NextResponse.json({
      success: true,
      summary,
      results,
      thresholds: THRESHOLDS,
    });
  } catch (err: any) {
    console.error('[InvoiceAutoTasks] Failed:', err);
    return NextResponse.json(
      { error: 'Invoice auto-task scan failed', details: err.message },
      { status: 500 },
    );
  }
}

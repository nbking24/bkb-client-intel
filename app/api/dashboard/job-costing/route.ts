// @ts-nocheck
import { NextResponse } from 'next/server';
import {
  getActiveJobs,
  getCostItemsForJobLite,
  getDocumentsForJob,
  getTimeEntriesForJob,
} from '../../../lib/jobtread';

// ============================================================
// Job Costing Summary API
// Returns budget vs actual overview for all active jobs
// ============================================================

function fmt0(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface JobCostSummary {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  priceType: string | null;
  customStatus: string | null;
  isCostPlus: boolean;
  // Budget (estimated)
  estimatedCost: number;
  estimatedPrice: number;
  estimatedMargin: number;
  estimatedMarginPct: number;
  // Actual
  actualCost: number; // from vendor bills + POs + time entry labor costs
  costVariance: number; // estimated - actual (positive = under budget)
  costVariancePct: number;
  // Revenue
  invoicedAmount: number;
  collectedAmount: number;
  // Hours
  estimatedHours: number; // from labor cost items
  actualHours: number; // from time entries
  hoursVariance: number;
  // Health
  health: 'on-track' | 'watch' | 'over-budget';
  alerts: string[];
}

function computeHours(startedAt: string, endedAt: string): number {
  if (!startedAt || !endedAt) return 0;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

export async function POST(req: Request) {
  try {
    // Get all active jobs
    const jobs = await getActiveJobs(50);

    // Filter to jobs with meaningful statuses (skip leads/prospects)
    const activeJobs = jobs.filter(
      (j: any) =>
        j.customStatus &&
        !['Lead', 'Prospect', 'Declined', 'On Hold'].includes(j.customStatus)
    );

    // Fetch data for each job in parallel (batched to avoid overload)
    const BATCH_SIZE = 5;
    const summaries: JobCostSummary[] = [];

    for (let i = 0; i < activeJobs.length; i += BATCH_SIZE) {
      const batch = activeJobs.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (job: any) => {
          try {
            const [costItems, documents, timeEntries] = await Promise.all([
              getCostItemsForJobLite(job.id, 500),
              getDocumentsForJob(job.id),
              getTimeEntriesForJob(job.id),
            ]);

            // ---- Budget totals from ALL job cost items ----
            // job.costItems ARE the budget — don't filter by document.id
            // (items get a document association when placed on customer orders,
            //  but they're still budget items)
            let estimatedCost = 0;
            let estimatedPrice = 0;
            let estimatedHours = 0;

            for (const ci of costItems) {
              estimatedCost += Number(ci.cost) || 0;
              estimatedPrice += Number(ci.price) || 0;
              // Estimate hours from labor cost items
              const costType = ci.costType?.name?.toLowerCase() || '';
              if (costType.includes('labor') || costType.includes('time')) {
                estimatedHours += Number(ci.quantity) || 0;
              }
            }

            // ---- Actual costs from vendor bills/POs + time entry labor ----
            let actualCost = 0;
            let invoicedAmount = 0;
            let collectedAmount = 0;

            for (const doc of documents) {
              const docCost = Number(doc.cost) || 0;
              const docPrice = Number(doc.price) || 0;

              if (doc.type === 'vendorBill' && doc.status === 'approved') {
                actualCost += docCost;
              } else if (doc.type === 'vendorOrder' && doc.status === 'approved') {
                actualCost += docCost;
              } else if (doc.type === 'customerInvoice') {
                if (doc.status === 'approved') {
                  invoicedAmount += docPrice;
                  collectedAmount += docPrice;
                } else if (doc.status === 'pending') {
                  invoicedAmount += docPrice;
                }
              }
            }

            // ---- Time entries: hours AND labor costs ----
            let actualHours = 0;
            for (const te of timeEntries) {
              // Count ALL time entry hours (don't filter by type —
              // PAVE may return type as null, 'work', 'Standard', etc.)
              const hours = computeHours(te.startedAt, te.endedAt);
              actualHours += hours;
              // Add time entry labor cost to actual cost
              actualCost += Number(te.cost) || 0;
            }

            // ---- Determine if cost-plus ----
            const isCostPlus = (job.priceType || '').toLowerCase() === 'costplus'
              || (job.priceType || '').toLowerCase() === 'cost_plus'
              || (job.priceType || '').toLowerCase() === 'cost plus'
              || (estimatedPrice === 0 && estimatedCost > 0);

            // ---- Compute metrics ----
            // For cost-plus jobs: margin = collected - actual cost (profit from billing)
            // For fixed-price jobs: margin = estimated price - estimated cost
            let estimatedMargin: number;
            let estimatedMarginPct: number;

            if (isCostPlus) {
              // Cost-plus: profit = what we've collected minus what we've spent
              estimatedMargin = collectedAmount - actualCost;
              estimatedMarginPct = collectedAmount > 0 ? (estimatedMargin / collectedAmount) * 100 : 0;
            } else {
              estimatedMargin = estimatedPrice - estimatedCost;
              estimatedMarginPct = estimatedPrice > 0 ? (estimatedMargin / estimatedPrice) * 100 : 0;
            }

            const costVariance = estimatedCost - actualCost;
            const costVariancePct = estimatedCost > 0 ? (costVariance / estimatedCost) * 100 : 0;
            const hoursVariance = estimatedHours - actualHours;

            // ---- Health assessment ----
            const alerts: string[] = [];
            let health: 'on-track' | 'watch' | 'over-budget' = 'on-track';

            if (estimatedCost > 0 && actualCost > estimatedCost) {
              health = 'over-budget';
              alerts.push(`Over budget by $${Math.abs(costVariance).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
            } else if (estimatedCost > 0 && actualCost / estimatedCost > 0.85) {
              health = 'watch';
              alerts.push(`${((actualCost / estimatedCost) * 100).toFixed(0)}% of budget used`);
            }

            if (estimatedHours > 0 && actualHours > estimatedHours) {
              alerts.push(`${(actualHours - estimatedHours).toFixed(1)} hrs over labor estimate`);
              if (health === 'on-track') health = 'watch';
            }

            // Cost-plus specific alert: if spending exceeds collections
            if (isCostPlus && actualCost > collectedAmount && collectedAmount > 0) {
              alerts.push(`Costs exceed collections by $${fmt0(actualCost - collectedAmount)}`);
              if (health === 'on-track') health = 'watch';
            }

            return {
              jobId: job.id,
              jobName: job.name,
              jobNumber: job.number || '',
              clientName: job.clientName || '',
              priceType: job.priceType || null,
              customStatus: job.customStatus || null,
              isCostPlus,
              estimatedCost: Math.round(estimatedCost * 100) / 100,
              estimatedPrice: Math.round(estimatedPrice * 100) / 100,
              estimatedMargin: Math.round(estimatedMargin * 100) / 100,
              estimatedMarginPct: Math.round(estimatedMarginPct * 10) / 10,
              actualCost: Math.round(actualCost * 100) / 100,
              costVariance: Math.round(costVariance * 100) / 100,
              costVariancePct: Math.round(costVariancePct * 10) / 10,
              invoicedAmount: Math.round(invoicedAmount * 100) / 100,
              collectedAmount: Math.round(collectedAmount * 100) / 100,
              estimatedHours: Math.round(estimatedHours * 10) / 10,
              actualHours: Math.round(actualHours * 10) / 10,
              hoursVariance: Math.round(hoursVariance * 10) / 10,
              health,
              alerts,
            } as JobCostSummary;
          } catch (err: any) {
            console.error(`Error fetching job ${job.id}:`, err.message);
            return null;
          }
        })
      );

      summaries.push(...batchResults.filter(Boolean));
    }

    // ---- Portfolio totals ----
    const totals = {
      totalEstimatedCost: summaries.reduce((s, j) => s + j.estimatedCost, 0),
      totalActualCost: summaries.reduce((s, j) => s + j.actualCost, 0),
      totalEstimatedPrice: summaries.reduce((s, j) => s + j.estimatedPrice, 0),
      totalInvoiced: summaries.reduce((s, j) => s + j.invoicedAmount, 0),
      totalCollected: summaries.reduce((s, j) => s + j.collectedAmount, 0),
      totalEstimatedHours: summaries.reduce((s, j) => s + j.estimatedHours, 0),
      totalActualHours: summaries.reduce((s, j) => s + j.actualHours, 0),
      jobsOverBudget: summaries.filter((j) => j.health === 'over-budget').length,
      jobsOnWatch: summaries.filter((j) => j.health === 'watch').length,
      jobCount: summaries.length,
    };

    return NextResponse.json({ summaries, totals });
  } catch (err: any) {
    console.error('Job costing summary error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

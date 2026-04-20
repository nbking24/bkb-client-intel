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
  // Contract (from approved customer orders)
  contractPrice: number; // what client pays (price side of approved docs)
  estimatedCost: number; // internal cost budget (cost side of approved docs)
  // Costs
  actualCost: number; // paid costs: approved vendor bills/POs + time entry labor
  pendingCost: number; // pending costs: draft/pending vendor bills/POs
  totalCosts: number; // actualCost + pendingCost (all committed costs)
  // Margin = contractPrice - totalCosts
  margin: number;
  marginPct: number;
  // Revenue
  invoicedAmount: number;
  collectedAmount: number;
  // Hours
  estimatedHours: number;
  actualHours: number;
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

            // ---- Approved budget from customer order documents ----
            // Sum cost/price from approved customer orders (proposals + COs).
            // This represents the committed/approved estimated budget.
            // Skip docs with "Exclude from Budget" toggled on in JT (includeInBudget=false).
            let estimatedCost = 0;
            let estimatedPrice = 0;

            // Build the set of doc IDs that ARE in the budget so we can mirror
            // the filter when walking cost items below.
            const budgetedApprovedOrderIds = new Set<string>();
            for (const doc of documents) {
              if (doc.type === 'customerOrder' && doc.status === 'approved' && doc.includeInBudget !== false) {
                budgetedApprovedOrderIds.add(doc.id);
                estimatedCost += Number(doc.cost) || 0;
                estimatedPrice += Number(doc.price) || 0;
              }
            }

            // Estimated labor hours from APPROVED customer order cost items only
            // (matches how estimatedCost/estimatedPrice are calculated above).
            // Skip items from excluded-from-budget docs.
            let estimatedHours = 0;
            for (const ci of costItems) {
              const costType = ci.costType?.name?.toLowerCase() || '';
              if (costType.includes('labor') || costType.includes('time')) {
                if (ci.document?.id && budgetedApprovedOrderIds.has(ci.document.id)) {
                  estimatedHours += Number(ci.quantity) || 0;
                }
              }
            }

            // ---- Costs from vendor bills/POs + time entry labor ----
            // Actual = paid (approved vendor bills/POs + time costs)
            // Pending = not yet paid (draft/pending vendor bills/POs)
            let actualCost = 0;
            let pendingCost = 0;
            let invoicedAmount = 0;
            let collectedAmount = 0;

            for (const doc of documents) {
              const docCost = Number(doc.cost) || 0;
              const docPrice = Number(doc.price) || 0;

              if (doc.type === 'vendorBill' || doc.type === 'vendorOrder') {
                if (doc.status === 'approved') {
                  actualCost += docCost;
                } else if (doc.status === 'draft' || doc.status === 'pending') {
                  pendingCost += docCost;
                }
              } else if (doc.type === 'customerInvoice') {
                // Skip invoices explicitly excluded from budget.
                if (doc.includeInBudget === false) {
                  // intentional no-op
                } else if (doc.status === 'approved') {
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
              const hours = computeHours(te.startedAt, te.endedAt);
              actualHours += hours;
              actualCost += Number(te.cost) || 0;
            }

            // Total costs = paid + pending (everything committed)
            const totalCosts = actualCost + pendingCost;

            // ---- Determine if cost-plus ----
            const isCostPlus = (job.priceType || '').toLowerCase() === 'costplus'
              || (job.priceType || '').toLowerCase() === 'cost_plus'
              || (job.priceType || '').toLowerCase() === 'cost plus'
              || (estimatedPrice === 0 && estimatedCost > 0);

            // ---- Compute margin ----
            // Margin = Contract Price - Total Costs (paid + pending)
            // This reflects the real margin based on what we'll actually collect
            // vs what we'll actually spend (including pending bills/POs).
            let margin: number;
            let marginPct: number;

            if (isCostPlus) {
              // Cost-plus: profit = collected - total costs
              margin = collectedAmount - totalCosts;
              marginPct = collectedAmount > 0 ? (margin / collectedAmount) * 100 : 0;
            } else {
              // Fixed-price: margin = contract price - total costs (including pending)
              margin = estimatedPrice - totalCosts;
              marginPct = estimatedPrice > 0 ? (margin / estimatedPrice) * 100 : 0;
            }

            const hoursVariance = estimatedHours - actualHours;

            // ---- Health assessment ----
            // Based on totalCosts (paid + pending) vs estimatedCost
            const alerts: string[] = [];
            let health: 'on-track' | 'watch' | 'over-budget' = 'on-track';

            if (estimatedCost > 0 && totalCosts > estimatedCost) {
              health = 'over-budget';
              alerts.push(`Total costs exceed budget by $${fmt0(totalCosts - estimatedCost)}`);
            } else if (estimatedCost > 0 && totalCosts / estimatedCost > 0.85) {
              health = 'watch';
              alerts.push(`${((totalCosts / estimatedCost) * 100).toFixed(0)}% of cost budget committed`);
            }

            if (estimatedHours > 0 && actualHours > estimatedHours) {
              alerts.push(`${(actualHours - estimatedHours).toFixed(1)} hrs over labor estimate`);
              if (health === 'on-track') health = 'watch';
            }

            // Cost-plus specific alert: if spending exceeds collections
            if (isCostPlus && totalCosts > collectedAmount && collectedAmount > 0) {
              alerts.push(`Costs exceed collections by $${fmt0(totalCosts - collectedAmount)}`);
              if (health === 'on-track') health = 'watch';
            }

            // Negative margin alert for fixed-price
            if (!isCostPlus && margin < 0 && estimatedPrice > 0) {
              if (health !== 'over-budget') health = 'over-budget';
              alerts.push(`Negative margin: -$${fmt0(Math.abs(margin))}`);
            }

            return {
              jobId: job.id,
              jobName: job.name,
              jobNumber: job.number || '',
              clientName: job.clientName || '',
              priceType: job.priceType || null,
              customStatus: job.customStatus || null,
              isCostPlus,
              contractPrice: Math.round(estimatedPrice * 100) / 100,
              estimatedCost: Math.round(estimatedCost * 100) / 100,
              actualCost: Math.round(actualCost * 100) / 100,
              pendingCost: Math.round(pendingCost * 100) / 100,
              totalCosts: Math.round(totalCosts * 100) / 100,
              margin: Math.round(margin * 100) / 100,
              marginPct: Math.round(marginPct * 10) / 10,
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
      totalContractPrice: summaries.reduce((s, j) => s + j.contractPrice, 0),
      totalEstimatedCost: summaries.reduce((s, j) => s + j.estimatedCost, 0),
      totalActualCost: summaries.reduce((s, j) => s + j.actualCost, 0),
      totalPendingCost: summaries.reduce((s, j) => s + j.pendingCost, 0),
      totalCosts: summaries.reduce((s, j) => s + j.totalCosts, 0),
      totalMargin: summaries.reduce((s, j) => s + j.margin, 0),
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

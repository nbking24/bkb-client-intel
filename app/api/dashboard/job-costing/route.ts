// @ts-nocheck
import { NextResponse, NextRequest } from 'next/server';
import {
  getActiveJobs,
  getCostItemsForJobLite,
  getDocumentsForJob,
  getTimeEntriesForJob,
} from '../../../lib/jobtread';
import { getSupabase } from '../../lib/supabase';

export const maxDuration = 300;
// Belt-and-suspenders: GET handlers without a Request param can be
// statically optimized by Next.js (cached at build). Force dynamic so
// every GET reads the live Supabase row, not a snapshot from build time.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

/**
 * GET /api/dashboard/job-costing
 *
 * Returns the cached summary payload. Never recomputes on its own —
 * Nathan asked the list page not to auto-refresh, so this just reads
 * the snapshot row written by the last POST. If no cache exists yet
 * (first-ever load on a fresh deploy), it falls back to a fresh
 * compute so the page isn't empty on day one.
 */
export async function GET() {
  try {
    const sb = getSupabase();
    const { data: cached } = await sb
      .from('job_costing_summary_cache')
      .select('payload, computed_at')
      .eq('key', 'summary')
      .maybeSingle();
    if (cached?.payload) {
      // Patch in the latest manual progress so a freshly-saved % shows
      // up immediately on the row without forcing a full refresh.
      const withProgress = await mergeManualProgress(cached.payload);
      return NextResponse.json({ ...withProgress, cachedAt: cached.computed_at });
    }
    // Cold start: compute once so the user has something to look at.
    const fresh = await computeSummaries();
    await writeCache(fresh);
    return NextResponse.json({ ...fresh, cachedAt: new Date().toISOString() });
  } catch (err: any) {
    console.error('Job costing GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/job-costing[?refresh=1]
 *
 * Backwards-compat for the legacy frontend that POSTed to get data;
 * keeps working but the response is now cache-first by default. Pass
 * ?refresh=1 (or body: { force: true }) to actually recompute and
 * persist a new cache snapshot.
 */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get('refresh') === '1';
    if (!force) {
      // No-force POST behaves like GET — read from cache.
      const sb = getSupabase();
      const { data: cached } = await sb
        .from('job_costing_summary_cache')
        .select('payload, computed_at')
        .eq('key', 'summary')
        .maybeSingle();
      if (cached?.payload) {
        const withProgress = await mergeManualProgress(cached.payload);
        return NextResponse.json({ ...withProgress, cachedAt: cached.computed_at });
      }
    }
    const startedAt = Date.now();
    const fresh = await computeSummaries();
    await writeCache(fresh, Date.now() - startedAt);
    return NextResponse.json({ ...fresh, cachedAt: new Date().toISOString() });
  } catch (err: any) {
    console.error('Job costing summary error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function writeCache(payload: any, computeMs?: number) {
  try {
    const sb = getSupabase();
    await sb
      .from('job_costing_summary_cache')
      .upsert({
        key: 'summary',
        payload,
        computed_at: new Date().toISOString(),
        compute_ms: computeMs ?? null,
      }, { onConflict: 'key' });
  } catch (err: any) {
    console.warn('[job-costing summary] cache write failed:', err.message);
  }
}

/**
 * Hydrate each summary row with its latest job_manual_progress value, so
 * editing % complete on the list updates the row without a full recompute.
 *
 * The original version filtered with .in('job_id', jobIds). That returned
 * an empty result set in production even though the rows exist — most
 * likely a URL encoding quirk in the Supabase JS client when the IN list
 * is built into a long querystring. The table is tiny (a handful of
 * rows), so we just fetch them all and map by id locally. Errors are now
 * logged (not swallowed) so future regressions are visible in Vercel
 * logs.
 */
async function mergeManualProgress(payload: any): Promise<any> {
  if (!payload?.summaries || !Array.isArray(payload.summaries)) return payload;
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('job_manual_progress')
      .select('job_id, percent_complete, set_at');
    if (error) {
      console.error('[job-costing summary] mergeManualProgress query error:', error.message);
      return payload;
    }
    const map = new Map<string, { percentComplete: number; setAt: string }>();
    for (const row of data || []) {
      map.set(row.job_id, { percentComplete: row.percent_complete, setAt: row.set_at });
    }
    const summaries = payload.summaries.map((s: any) => {
      const m = map.get(s.jobId);
      return {
        ...s,
        manualPercentComplete: m?.percentComplete ?? null,
        manualPercentSetAt: m?.setAt ?? null,
      };
    });
    return { ...payload, summaries };
  } catch (err: any) {
    console.error('[job-costing summary] mergeManualProgress threw:', err?.message || err);
    return payload;
  }
}

async function computeSummaries() {
  try {
    // Get all active jobs
    const jobs = await getActiveJobs();

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
            // Cost-plus and fixed-price jobs use different signals:
            //   - Fixed-price: totalCosts vs estimatedCost budget. Over budget
            //     means we're losing margin, watch means we're approaching it.
            //   - Cost-plus: there is no budget. Health is driven by whether
            //     collections are keeping pace with costs (a cashflow risk)
            //     and whether profit has gone negative.
            // Pre-fix, cost-plus jobs were being marked "over-budget" against
            // estimatedCost — but estimatedCost on cost-plus is just the cost
            // side of approved COs (or whatever happens to be in the budget
            // view), not a real budget. Beamlander Stonehouse Reno was getting
            // flagged that way even though it's a cost-plus job.
            const alerts: string[] = [];
            let health: 'on-track' | 'watch' | 'over-budget' = 'on-track';

            if (isCostPlus) {
              // Cost-plus health signals.
              if (margin < 0 && collectedAmount > 0) {
                // We've collected money and we're underwater on the job —
                // markup isn't covering costs, treat as over-budget for
                // sorting/filtering purposes.
                health = 'over-budget';
                alerts.push(`Negative profit: -$${fmt0(Math.abs(margin))}`);
              } else if (totalCosts > collectedAmount && collectedAmount > 0) {
                // Costs are running ahead of collections — cashflow risk.
                alerts.push(`Costs exceed collections by $${fmt0(totalCosts - collectedAmount)}`);
                if (health === 'on-track') health = 'watch';
              }
            } else {
              // Fixed-price health signals.
              if (estimatedCost > 0 && totalCosts > estimatedCost) {
                health = 'over-budget';
                alerts.push(`Total costs exceed budget by $${fmt0(totalCosts - estimatedCost)}`);
              } else if (estimatedCost > 0 && totalCosts / estimatedCost > 0.85) {
                health = 'watch';
                alerts.push(`${((totalCosts / estimatedCost) * 100).toFixed(0)}% of cost budget committed`);
              }
              if (margin < 0 && estimatedPrice > 0) {
                if (health !== 'over-budget') health = 'over-budget';
                alerts.push(`Negative margin: -$${fmt0(Math.abs(margin))}`);
              }
            }

            // Hours-over-estimate only matters on fixed-price jobs. On a
            // cost-plus job there is no budget for labor — the client pays
            // for actual hours at the burdened rate plus markup, so going
            // over the original labor estimate doesn't hurt the job.
            if (!isCostPlus && estimatedHours > 0 && actualHours > estimatedHours) {
              alerts.push(`${(actualHours - estimatedHours).toFixed(1)} hrs over labor estimate`);
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

    return { summaries, totals };
  } catch (err: any) {
    console.error('Job costing summary error:', err);
    throw err;
  }
}

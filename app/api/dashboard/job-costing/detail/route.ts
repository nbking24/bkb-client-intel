// @ts-nocheck
import { NextResponse } from 'next/server';
import {
  pave,
  getJob,
  getCostItemsForJobLite,
  getDocumentsForJob,
  getDocumentCostItemsForJob,
  getTimeEntriesForJob,
  getTasksForJob,
} from '../../../../lib/jobtread';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================
// Job Costing Detail API
// Deep-dive analysis for a single job
// ============================================================

function computeHours(startedAt: string, endedAt: string): number {
  if (!startedAt || !endedAt) return 0;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

export async function POST(req: Request) {
  try {
    const { jobId } = await req.json();
    if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

    // Fetch all data in parallel
    const [job, costItems, documents, docCostItems, timeEntries, tasks] = await Promise.all([
      getJob(jobId),
      getCostItemsForJobLite(jobId, 500),
      getDocumentsForJob(jobId),
      getDocumentCostItemsForJob(jobId).catch(() => []),
      getTimeEntriesForJob(jobId),
      getTasksForJob(jobId).catch(() => []),
    ]);

    // ============================================================
    // 1. Budget totals from approved customer order DOCUMENTS
    //    Category breakdown from JOB budget cost items (which have cost codes)
    // ============================================================
    //
    // Summary totals: use approved customer order document-level totals
    // (these are the committed/approved budget numbers).
    let totalEstimatedCost = 0;
    let totalEstimatedPrice = 0;
    for (const doc of documents) {
      if (doc.type === 'customerOrder' && doc.status === 'approved') {
        totalEstimatedCost += Number(doc.cost) || 0;
        totalEstimatedPrice += Number(doc.price) || 0;
      }
    }

    // Category breakdown: use job budget cost items (which HAVE cost codes).
    // These represent the full budget allocation by category.
    const budgetByCostCode: Record<string, {
      costCodeName: string;
      costCodeNumber: string;
      estimatedCost: number;
      estimatedPrice: number;
      itemCount: number;
      items: { name: string; cost: number; price: number; quantity: number }[];
    }> = {};

    let budgetBreakdownTotal = 0;
    let estimatedLaborHours = 0;

    for (const ci of costItems) {
      const ccName = ci.costCode?.name || 'Uncoded';
      const ccNum = ci.costCode?.number || '00';
      const key = ccNum + '-' + ccName;
      const cost = Number(ci.cost) || 0;
      const price = Number(ci.price) || 0;

      if (!budgetByCostCode[key]) {
        budgetByCostCode[key] = {
          costCodeName: ccName,
          costCodeNumber: ccNum,
          estimatedCost: 0,
          estimatedPrice: 0,
          itemCount: 0,
          items: [],
        };
      }

      budgetByCostCode[key].estimatedCost += cost;
      budgetByCostCode[key].estimatedPrice += price;
      budgetByCostCode[key].itemCount++;
      budgetByCostCode[key].items.push({
        name: ci.name,
        cost,
        price,
        quantity: Number(ci.quantity) || 0,
      });

      budgetBreakdownTotal += cost;

      // Labor hours from cost type — only from approved customer orders
      // (matches how totalEstimatedCost/Price are calculated from approved docs)
      const costType = ci.costType?.name?.toLowerCase() || '';
      if (costType.includes('labor') || costType.includes('time')) {
        if (ci.document?.type === 'customerOrder' && ci.document?.status === 'approved') {
          estimatedLaborHours += Number(ci.quantity) || 0;
        }
      }
    }

    // ============================================================
    // 2. Actual costs + Pending costs from vendor bills/POs
    //    Actual = approved vendor bills/POs
    //    Pending = draft/pending vendor bills/POs (expected but not yet approved)
    // ============================================================
    const actualByCostCode: Record<string, number> = {};
    const pendingByCostCode: Record<string, number> = {};
    let totalActualCost = 0;
    let totalPendingCost = 0;

    // From document cost items (line items on vendor bills/POs)
    if (docCostItems.length > 0) {
      for (const dci of docCostItems) {
        const docType = dci.document?.type || '';
        const docStatus = dci.document?.status || '';
        if (docType !== 'vendorBill' && docType !== 'vendorOrder') continue;

        const cost = Number(dci.cost) || 0;
        const ccName = dci.costCode?.name || dci.jobCostItem?.costCode?.name || 'Uncoded';
        const ccNum = dci.costCode?.number || dci.jobCostItem?.costCode?.number || '00';
        const key = ccNum + '-' + ccName;

        if (docStatus === 'approved') {
          actualByCostCode[key] = (actualByCostCode[key] || 0) + cost;
          totalActualCost += cost;
        } else if (docStatus === 'draft' || docStatus === 'pending') {
          pendingByCostCode[key] = (pendingByCostCode[key] || 0) + cost;
          totalPendingCost += cost;
        }
      }
    } else {
      // Fallback: document-level totals (no cost code breakdown)
      for (const doc of documents) {
        if (doc.type === 'vendorBill' || doc.type === 'vendorOrder') {
          const cost = Number(doc.cost) || 0;
          if (doc.status === 'approved') {
            totalActualCost += cost;
          } else if (doc.status === 'draft' || doc.status === 'pending') {
            totalPendingCost += cost;
          }
        }
      }
    }

    // ============================================================
    // 3. Time analysis — includes ALL time entries (no type filter)
    //    Also adds time entry labor costs to actual cost totals
    // ============================================================
    const timeByUser: Record<string, { name: string; work: number; travel: number; break_: number }> = {};
    const timeByCostCode: Record<string, { name: string; hours: number }> = {};
    let totalWorkHours = 0;
    let totalTravelHours = 0;
    let totalBreakHours = 0;

    for (const te of timeEntries) {
      const hours = computeHours(te.startedAt, te.endedAt);
      const userName = te.user?.name || 'Unknown';
      const userId = te.user?.id || 'unknown';

      if (!timeByUser[userId]) {
        timeByUser[userId] = { name: userName, work: 0, travel: 0, break_: 0 };
      }

      // Categorize by type, but default to 'work' if unrecognized
      const entryType = (te.type || '').toLowerCase();
      if (entryType === 'travel') {
        timeByUser[userId].travel += hours;
        totalTravelHours += hours;
      } else if (entryType === 'break') {
        timeByUser[userId].break_ += hours;
        totalBreakHours += hours;
      } else {
        // 'work', 'standard', null, or any other value → count as work
        timeByUser[userId].work += hours;
        totalWorkHours += hours;
      }

      // Add time entry labor cost to actual cost
      const teCost = Number(te.cost) || 0;
      totalActualCost += teCost;

      // Map time to cost code
      const ccName = te.costItem?.costCode?.name || 'General';
      const ccNum = te.costItem?.costCode?.number || '00';
      const timeKey = ccName;
      if (!timeByCostCode[timeKey]) {
        timeByCostCode[timeKey] = { name: ccName, hours: 0 };
      }
      timeByCostCode[timeKey].hours += hours;

      // Also add time costs to the actualByCostCode for cost breakdown
      if (teCost > 0) {
        const costKey = ccNum + '-' + ccName;
        actualByCostCode[costKey] = (actualByCostCode[costKey] || 0) + teCost;
      }
    }

    const timeAnalysis = {
      estimatedHours: Math.round(estimatedLaborHours * 10) / 10,
      actualWorkHours: Math.round(totalWorkHours * 10) / 10,
      actualTravelHours: Math.round(totalTravelHours * 10) / 10,
      actualBreakHours: Math.round(totalBreakHours * 10) / 10,
      totalActualHours: Math.round((totalWorkHours + totalTravelHours + totalBreakHours) * 10) / 10,
      hoursVariance: Math.round((estimatedLaborHours - totalWorkHours) * 10) / 10,
      efficiencyRatio: estimatedLaborHours > 0
        ? Math.round((totalWorkHours / estimatedLaborHours) * 100)
        : 0,
      byUser: Object.values(timeByUser)
        .map((u) => ({
          name: u.name,
          work: Math.round(u.work * 10) / 10,
          travel: Math.round(u.travel * 10) / 10,
          break_: Math.round(u.break_ * 10) / 10,
          total: Math.round((u.work + u.travel + u.break_) * 10) / 10,
        }))
        .sort((a, b) => b.total - a.total),
      byCostCode: Object.values(timeByCostCode)
        .map((c) => ({ name: c.name, hours: Math.round(c.hours * 10) / 10 }))
        .sort((a, b) => b.hours - a.hours),
    };

    // ============================================================
    // 4. Merge into cost code breakdown
    //    Includes: budgeted, actual, pending, remaining, % used
    // ============================================================

    // Collect all cost code keys (from budget, actuals, and pending)
    const allCostCodeKeys = new Set([
      ...Object.keys(budgetByCostCode),
      ...Object.keys(actualByCostCode),
      ...Object.keys(pendingByCostCode),
    ]);

    const costCodeBreakdown = Array.from(allCostCodeKeys)
      .map((key) => {
        const budget = budgetByCostCode[key] || {
          costCodeName: key.split('-').slice(1).join('-') || 'Uncoded',
          costCodeNumber: key.split('-')[0] || '00',
          estimatedCost: 0,
          estimatedPrice: 0,
          itemCount: 0,
          items: [],
        };
        const actual = actualByCostCode[key] || 0;
        const pending = pendingByCostCode[key] || 0;
        const committed = actual + pending; // total committed spend
        const remaining = Math.max(0, budget.estimatedCost - committed);
        const variance = budget.estimatedCost - actual;
        const pctUsed = budget.estimatedCost > 0 ? (actual / budget.estimatedCost) * 100 : (actual > 0 ? 100 : 0);
        const pctCommitted = budget.estimatedCost > 0 ? (committed / budget.estimatedCost) * 100 : (committed > 0 ? 100 : 0);

        let status: 'under' | 'on-track' | 'watch' | 'over' = 'on-track';
        if (committed > budget.estimatedCost && budget.estimatedCost > 0) status = 'over';
        else if (pctCommitted > 85) status = 'watch';
        else if (pctUsed < 50 && budget.estimatedCost > 0) status = 'under';

        return {
          costCodeName: budget.costCodeName,
          costCodeNumber: budget.costCodeNumber,
          estimatedCost: Math.round(budget.estimatedCost * 100) / 100,
          estimatedPrice: Math.round(budget.estimatedPrice * 100) / 100,
          actualCost: Math.round(actual * 100) / 100,
          pendingCost: Math.round(pending * 100) / 100,
          committedCost: Math.round(committed * 100) / 100,
          remaining: Math.round(remaining * 100) / 100,
          variance: Math.round(variance * 100) / 100,
          pctUsed: Math.round(pctUsed),
          pctCommitted: Math.round(pctCommitted),
          status,
          itemCount: budget.itemCount,
          topItems: budget.items.sort((a, b) => b.cost - a.cost).slice(0, 5),
        };
      })
      .sort((a, b) => a.costCodeNumber.localeCompare(b.costCodeNumber));

    // ============================================================
    // 5. Document summary
    // ============================================================
    const docSummary = {
      customerOrders: [] as any[],
      customerInvoices: [] as any[],
      vendorBills: [] as any[],
      vendorOrders: [] as any[],
    };

    let invoicedTotal = 0;
    let contractTotal = 0;

    for (const doc of documents) {
      const entry = {
        id: doc.id,
        name: doc.name,
        number: doc.number,
        status: doc.status,
        price: Number(doc.price) || 0,
        cost: Number(doc.cost) || 0,
        createdAt: doc.createdAt,
      };

      if (doc.type === 'customerOrder') {
        docSummary.customerOrders.push(entry);
        if (doc.status === 'approved') contractTotal += entry.price;
      } else if (doc.type === 'customerInvoice') {
        docSummary.customerInvoices.push(entry);
        invoicedTotal += entry.price;
      } else if (doc.type === 'vendorBill') {
        docSummary.vendorBills.push(entry);
      } else if (doc.type === 'vendorOrder') {
        docSummary.vendorOrders.push(entry);
      }
    }

    // ============================================================
    // 6. Schedule progress
    // ============================================================
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t: any) => t.progress >= 1).length;
    const scheduleProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // ============================================================
    // 7. Financial summary — cost-plus aware, completion-aware
    // ============================================================
    const isCostPlus = (job?.priceType || '').toLowerCase() === 'costplus'
      || (job?.priceType || '').toLowerCase() === 'cost_plus'
      || (job?.priceType || '').toLowerCase() === 'cost plus'
      || (totalEstimatedPrice === 0 && totalEstimatedCost > 0);

    // Detect completed/final-billing projects based on JobTread custom status
    const rawStatus = (job?.customStatus || '').toLowerCase();
    const isCompleted = rawStatus.includes('final billing')
      || rawStatus.includes('closed')
      || rawStatus.includes('completed')
      || !!job?.closedOn;

    // Collected = approved customer invoices
    let collectedAmount = 0;
    for (const doc of documents) {
      if (doc.type === 'customerInvoice' && doc.status === 'approved') {
        collectedAmount += Number(doc.price) || 0;
      }
    }

    let estimatedMargin: number;
    let estimatedMarginPct: number;
    let projectedMargin: number;
    let projectedMarginPct: number;

    if (isCostPlus) {
      // Cost-plus: profit = collected - actual cost
      estimatedMargin = collectedAmount - totalActualCost;
      estimatedMarginPct = collectedAmount > 0 ? (estimatedMargin / collectedAmount) * 100 : 0;
      // Projected = same for cost-plus (we don't know future collections)
      projectedMargin = estimatedMargin;
      projectedMarginPct = estimatedMarginPct;
    } else {
      estimatedMargin = totalEstimatedPrice - totalEstimatedCost;
      estimatedMarginPct = totalEstimatedPrice > 0 ? (estimatedMargin / totalEstimatedPrice) * 100 : 0;
      projectedMargin = totalEstimatedPrice - totalActualCost;
      projectedMarginPct = totalEstimatedPrice > 0 ? (projectedMargin / totalEstimatedPrice) * 100 : 0;
    }

    const totalCommitted = totalActualCost + totalPendingCost;
    const totalRemaining = Math.max(0, totalEstimatedCost - totalCommitted);

    const financialSummary = {
      isCostPlus,
      estimatedCost: Math.round(totalEstimatedCost * 100) / 100,
      estimatedPrice: Math.round(totalEstimatedPrice * 100) / 100,
      estimatedMargin: Math.round(estimatedMargin * 100) / 100,
      estimatedMarginPct: Math.round(estimatedMarginPct * 10) / 10,
      actualCost: Math.round(totalActualCost * 100) / 100,
      pendingCost: Math.round(totalPendingCost * 100) / 100,
      committedCost: Math.round(totalCommitted * 100) / 100,
      remainingBudget: Math.round(totalRemaining * 100) / 100,
      costVariance: Math.round((totalEstimatedCost - totalActualCost) * 100) / 100,
      costVariancePct: totalEstimatedCost > 0
        ? Math.round(((totalEstimatedCost - totalActualCost) / totalEstimatedCost) * 1000) / 10
        : 0,
      projectedMargin: Math.round(projectedMargin * 100) / 100,
      projectedMarginPct: Math.round(projectedMarginPct * 10) / 10,
      contractValue: Math.round(contractTotal * 100) / 100,
      invoicedTotal: Math.round(invoicedTotal * 100) / 100,
      collectedAmount: Math.round(collectedAmount * 100) / 100,
      scheduleProgress,
    };

    // ============================================================
    // 8. AI Analysis
    // ============================================================
    let aiAnalysis = '';
    try {
      const overBudgetCodes = costCodeBreakdown
        .filter((c) => c.status === 'over' || c.status === 'watch')
        .map((c) => `${c.costCodeName}: est $${c.estimatedCost.toLocaleString()}, actual $${c.actualCost.toLocaleString()} (${c.pctUsed}%)`)
        .join('\n');

      const zeroCodes = costCodeBreakdown
        .filter((c) => c.estimatedCost > 500 && c.actualCost === 0)
        .map((c) => `${c.costCodeName}: $${c.estimatedCost.toLocaleString()} budgeted, $0 actual`)
        .join('\n');

      const totalActualHrs = totalWorkHours + totalTravelHours + totalBreakHours;

      const costPlusNote = isCostPlus
        ? `\nNOTE: This is a COST-PLUS job. There is no fixed contract price. The client is billed for actual costs plus a markup/fee. Margin = Collected - Actual Costs. Focus on whether collections are keeping pace with spending, not on estimated price (which is $0 for cost-plus).`
        : '';

      const completedNote = isCompleted
        ? `\nIMPORTANT: This project is SUBSTANTIALLY COMPLETE (status: "${job?.customStatus || 'Closed'}"). The construction work is done. Any remaining costs are final billing items (retention, punch-list, final invoices from subs/vendors). Treat all numbers as FINAL figures, not projections. Use "final margin" instead of "projected margin." Flag any pending bills/POs that still need to be closed out. Evaluate the overall job profitability as a completed project — what went well, what lessons can be applied to future jobs.`
        : '';

      const prompt = `You are a construction job costing analyst for Brett King Builder, a high-end residential renovation company in the Philadelphia area.

Analyze this job's financial health and provide a concise executive summary.

JOB: ${job?.name || 'Unknown'} (${job?.clientName || ''})
TYPE: ${isCostPlus ? 'Cost-Plus' : 'Fixed Price'}${costPlusNote}${completedNote}
STATUS: ${isCompleted ? 'PROJECT COMPLETE' : 'In Progress'} (JobTread status: ${job?.customStatus || 'N/A'})

FINANCIAL OVERVIEW:
- Estimated Cost: $${totalEstimatedCost.toLocaleString()}
- Actual Cost to Date: $${totalActualCost.toLocaleString()}
- Pending Costs (expected): $${totalPendingCost.toLocaleString()}
- Total Committed (actual + pending): $${totalCommitted.toLocaleString()}
- Remaining Budget: $${totalRemaining.toLocaleString()}
- Cost Variance: $${(totalEstimatedCost - totalActualCost).toLocaleString()} (${totalActualCost > totalEstimatedCost ? 'OVER' : 'under'} budget)
${isCostPlus ? `- Collected from Client: $${collectedAmount.toLocaleString()}` : `- Estimated Revenue: $${totalEstimatedPrice.toLocaleString()}`}
- ${isCostPlus ? 'Current Profit (Collected - Costs)' : 'Projected Margin'}: $${projectedMargin.toLocaleString()} (${projectedMarginPct.toFixed(1)}%)
- Contract Value: $${contractTotal.toLocaleString()}
- Invoiced: $${invoicedTotal.toLocaleString()}

LABOR:
- Estimated Hours: ${estimatedLaborHours}
- Actual Hours: ${totalActualHrs.toFixed(1)} (work: ${totalWorkHours.toFixed(1)}, travel: ${totalTravelHours.toFixed(1)})

SCHEDULE: ${scheduleProgress}% complete (${completedTasks}/${totalTasks} tasks)

${overBudgetCodes ? `COST CODES OVER/NEAR BUDGET:\n${overBudgetCodes}` : 'All cost codes within budget.'}

${zeroCodes ? `UPCOMING COSTS (budgeted but no spend yet):\n${zeroCodes}` : ''}

Provide:
${isCompleted ? `1. A 2-3 sentence final assessment of the job's profitability and performance
2. Top 2-3 specific wins or lessons learned (with dollar amounts)
3. One actionable item — either a closeout task (pending bills to resolve, final invoicing) or a lesson for future jobs
4. If there are pending/draft vendor bills or POs, flag them as items needing resolution before the job can be fully closed out` :
`1. A 2-3 sentence executive summary of the job's financial health
2. Top 2-3 specific areas of concern or strength (with dollar amounts)
3. One actionable recommendation`}

Keep it direct and practical — this is for a construction project manager. Use plain language, no jargon. No markdown formatting — use plain text only. Total response under 200 words.`;

      const client = new Anthropic();
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      });

      aiAnalysis = response.content[0]?.type === 'text' ? response.content[0].text : '';
    } catch (err: any) {
      console.error('AI analysis error:', err.message);
      aiAnalysis = 'AI analysis unavailable.';
    }

    return NextResponse.json({
      job: {
        id: job?.id || jobId,
        name: job?.name || '',
        number: job?.number || '',
        clientName: job?.clientName || '',
        priceType: job?.priceType || null,
        customStatus: job?.customStatus || null,
        isCostPlus,
        isCompleted,
      },
      financialSummary,
      costCodeBreakdown,
      docSummary,
      timeAnalysis,
      aiAnalysis,
    });
  } catch (err: any) {
    console.error('Job costing detail error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

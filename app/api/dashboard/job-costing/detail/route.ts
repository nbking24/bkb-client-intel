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
    // Skip docs with "Exclude from Budget" toggled on in JT (includeInBudget=false).
    let totalEstimatedCost = 0;
    let totalEstimatedPrice = 0;
    const budgetedApprovedOrderIds = new Set<string>();
    for (const doc of documents) {
      if (doc.type === 'customerOrder' && doc.status === 'approved' && doc.includeInBudget !== false) {
        budgetedApprovedOrderIds.add(doc.id);
        totalEstimatedCost += Number(doc.cost) || 0;
        totalEstimatedPrice += Number(doc.price) || 0;
      }
    }

    // Category breakdown: pull line items directly from APPROVED customer
    // order documents (i.e. the docs that contributed to budgetedApproved-
    // OrderIds). The job-level cost items returned by getCostItemsForJobLite
    // rarely carry document.id back to the approving CO in BKB's setup, so
    // the previous filter (`ci.document?.id in budgetedApprovedOrderIds`)
    // dropped most items and the rollup came back $0 across the board.
    //
    // Doc-level CO line items ARE the approved budget — every item on an
    // approved customer order has been priced and committed.
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
    let budgetSourceUsed: 'approved_co_lines' | 'job_budget_items_fallback' = 'approved_co_lines';

    for (const dci of docCostItems) {
      const docType = dci.document?.type || '';
      const docId = dci.document?.id || '';
      if (docType !== 'customerOrder') continue;
      // Only items on approved customer orders count. The set was built
      // from the documents loop above and already excludes "Exclude from
      // Budget" docs, so this single check is enough.
      if (!budgetedApprovedOrderIds.has(docId)) continue;

      // Cost code lookup mirrors the actuals loop (line cost code first,
      // then linked budget item's cost code, then "00 / Uncoded").
      const ccName = dci.costCode?.name || dci.jobCostItem?.costCode?.name || 'Uncoded';
      const ccNum = dci.costCode?.number || dci.jobCostItem?.costCode?.number || '00';
      const key = ccNum + '-' + ccName;
      const cost = Number(dci.cost) || 0;
      const price = Number(dci.price) || 0;

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
        name: dci.name || ccName,
        cost,
        price,
        quantity: Number(dci.quantity) || 0,
      });

      budgetBreakdownTotal += cost;

      const costType = dci.costType?.name?.toLowerCase() || '';
      if (costType.includes('labor') || costType.includes('time')) {
        estimatedLaborHours += Number(dci.quantity) || 0;
      }
    }

    // Fallback: if docCostItems came back empty (e.g. JT API failure earlier
    // in the request) but the job has approved customer orders, fall back to
    // the legacy job-level cost item path so the rollup degrades gracefully
    // instead of going $0.
    if (budgetBreakdownTotal === 0 && budgetedApprovedOrderIds.size > 0) {
      budgetSourceUsed = 'job_budget_items_fallback';
      for (const ci of costItems) {
        const isApprovedBudget = !!ci.document?.id && budgetedApprovedOrderIds.has(ci.document.id);
        if (!isApprovedBudget) continue;
        const ccName = ci.costCode?.name || 'Uncoded';
        const ccNum = ci.costCode?.number || '00';
        const key = ccNum + '-' + ccName;
        const cost = Number(ci.cost) || 0;
        const price = Number(ci.price) || 0;
        if (!budgetByCostCode[key]) {
          budgetByCostCode[key] = {
            costCodeName: ccName, costCodeNumber: ccNum,
            estimatedCost: 0, estimatedPrice: 0, itemCount: 0, items: [],
          };
        }
        budgetByCostCode[key].estimatedCost += cost;
        budgetByCostCode[key].estimatedPrice += price;
        budgetByCostCode[key].itemCount++;
        budgetByCostCode[key].items.push({
          name: ci.name, cost, price, quantity: Number(ci.quantity) || 0,
        });
        budgetBreakdownTotal += cost;
        const costType = ci.costType?.name?.toLowerCase() || '';
        if (costType.includes('labor') || costType.includes('time')) {
          estimatedLaborHours += Number(ci.quantity) || 0;
        }
      }
    }

    // ============================================================
    // 2. Actual costs + Pending costs from vendor bills/POs
    //    Actual = approved vendor bills/POs
    //    Pending = draft/pending vendor bills/POs (expected but not yet approved)
    // ============================================================
    // Per-cost-code totals plus the individual lines that rolled up into
    // them, so the dashboard can show vendor / doc# / cost when the user
    // expands a row in the cost-code breakdown table.
    type CostLine = {
      label: string;       // vendor name (bills/POs) or worker name (labor)
      docNumber?: string;  // bill/PO number when known
      itemName?: string;   // cost item name (e.g. "Plumbing rough-in materials")
      cost: number;
      date?: string | null;
      kind: 'bill' | 'po' | 'labor';
      // For labor: total hours this worker logged against this cost code.
      // The labor section of the drawer is rolled up per-employee, so each
      // labor line represents many time entries collapsed into one row.
      hours?: number;
    };
    const actualByCostCode: Record<string, { total: number; lines: CostLine[] }> = {};
    const pendingByCostCode: Record<string, { total: number; lines: CostLine[] }> = {};
    let totalActualCost = 0;
    let totalPendingCost = 0;

    function pushLine(
      bucket: Record<string, { total: number; lines: CostLine[] }>,
      key: string,
      cost: number,
      line: CostLine
    ) {
      if (!bucket[key]) bucket[key] = { total: 0, lines: [] };
      bucket[key].total += cost;
      bucket[key].lines.push(line);
    }

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

        const docMeta: any = dci.document || {};
        const line: CostLine = {
          label: docMeta.accountName || dci.name || 'Vendor',
          docNumber: docMeta.number ? String(docMeta.number) : undefined,
          itemName: dci.name || undefined,
          cost,
          date: docMeta.issueDate || null,
          kind: docType === 'vendorOrder' ? 'po' : 'bill',
        };

        if (docStatus === 'approved') {
          pushLine(actualByCostCode, key, cost, line);
          totalActualCost += cost;
        } else if (docStatus === 'draft' || docStatus === 'pending') {
          pushLine(pendingByCostCode, key, cost, line);
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

    // Per-cost-code, per-employee labor aggregation. Time entries can run
    // hundreds-deep on big jobs, which made the cost-code drawer unreadable
    // when each entry was its own row. We collapse to one row per
    // (cost code, employee) with totals — bills/POs are still listed
    // individually since each one represents a discrete vendor commitment.
    const laborByKey: Record<string, Record<string, { name: string; hours: number; cost: number }>> = {};

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

      // Aggregate labor cost & hours per (cost code, employee) — the actual
      // pushLine into actualByCostCode happens after the loop, once per
      // employee, so the drawer shows a single summary row per worker per
      // cost code instead of one row per time entry.
      if (teCost > 0 || hours > 0) {
        const costKey = ccNum + '-' + ccName;
        if (!laborByKey[costKey]) laborByKey[costKey] = {};
        if (!laborByKey[costKey][userId]) {
          laborByKey[costKey][userId] = { name: userName, hours: 0, cost: 0 };
        }
        laborByKey[costKey][userId].hours += hours;
        laborByKey[costKey][userId].cost += teCost;
      }
    }

    // Emit the rolled-up labor lines into actualByCostCode now that all
    // time entries have been summed.
    for (const [costKey, perUser] of Object.entries(laborByKey)) {
      for (const u of Object.values(perUser)) {
        if (u.cost <= 0) continue; // skip zero-cost rollups (e.g. all break time)
        pushLine(actualByCostCode, costKey, u.cost, {
          label: u.name,
          cost: u.cost,
          hours: Math.round(u.hours * 100) / 100,
          kind: 'labor',
        });
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
        const actualBucket = actualByCostCode[key] || { total: 0, lines: [] };
        const pendingBucket = pendingByCostCode[key] || { total: 0, lines: [] };
        const actual = actualBucket.total;
        const pending = pendingBucket.total;
        const committed = actual + pending; // total committed spend
        const remaining = Math.max(0, budget.estimatedCost - committed);
        const variance = budget.estimatedCost - actual;
        const pctUsed = budget.estimatedCost > 0 ? (actual / budget.estimatedCost) * 100 : (actual > 0 ? 100 : 0);
        const pctCommitted = budget.estimatedCost > 0 ? (committed / budget.estimatedCost) * 100 : (committed > 0 ? 100 : 0);

        let status: 'under' | 'on-track' | 'watch' | 'over' = 'on-track';
        if (committed > budget.estimatedCost && budget.estimatedCost > 0) status = 'over';
        else if (pctCommitted > 85) status = 'watch';
        else if (pctUsed < 50 && budget.estimatedCost > 0) status = 'under';

        // Sort lines by cost desc; round each line's cost. Shape kept compact
        // so the response stays small even for high-volume cost codes.
        const sortLines = (lines: CostLine[]) =>
          lines
            .slice()
            .sort((a, b) => b.cost - a.cost)
            .map((l) => ({
              label: l.label,
              docNumber: l.docNumber || null,
              itemName: l.itemName || null,
              cost: Math.round(l.cost * 100) / 100,
              date: l.date || null,
              kind: l.kind,
              hours: l.hours != null ? Math.round(l.hours * 100) / 100 : null,
            }));

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
          actualLines: sortLines(actualBucket.lines),
          pendingLines: sortLines(pendingBucket.lines),
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

    let invoicedTotal = 0;     // Only non-draft invoices (sent to client)
    let draftInvoiceTotal = 0; // Draft invoices (prepared but not sent)
    let contractTotal = 0;

    for (const doc of documents) {
      const inBudget = doc.includeInBudget !== false;
      const entry = {
        id: doc.id,
        name: doc.name,
        number: doc.number,
        status: doc.status,
        price: Number(doc.price) || 0,
        cost: Number(doc.cost) || 0,
        createdAt: doc.createdAt,
        // false = "Exclude from Budget" toggled on in JT. UI surfaces the
        // entry but totals skip it.
        includeInBudget: inBudget,
      };

      if (doc.type === 'customerOrder') {
        docSummary.customerOrders.push(entry);
        if (doc.status === 'approved' && inBudget) contractTotal += entry.price;
      } else if (doc.type === 'customerInvoice') {
        docSummary.customerInvoices.push(entry);
        // Draft invoices haven't been sent to the client — they should NOT
        // count as "invoiced" for remaining-to-bill calculations.
        // Also skip invoices excluded from budget.
        if (doc.status === 'draft') {
          if (inBudget) draftInvoiceTotal += entry.price;
        } else {
          if (inBudget) invoicedTotal += entry.price;
        }
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

    // Total committed = paid + pending (all costs, including time entry labor)
    const totalCommitted = totalActualCost + totalPendingCost;

    // Margin = Contract Price - Total Costs (paid + pending)
    // This is the real margin: what we'll collect vs what we'll actually spend.
    // There is no "unused budget" — everything approved will be billed/spent.
    let margin: number;
    let marginPct: number;

    if (isCostPlus) {
      // Cost-plus: profit = collected - total costs
      margin = collectedAmount - totalCommitted;
      marginPct = collectedAmount > 0 ? (margin / collectedAmount) * 100 : 0;
    } else {
      // Fixed-price: margin = contract price - total costs (including pending)
      margin = totalEstimatedPrice - totalCommitted;
      marginPct = totalEstimatedPrice > 0 ? (margin / totalEstimatedPrice) * 100 : 0;
    }

    const financialSummary = {
      isCostPlus,
      // Contract price = what the client pays (price side of approved customer orders)
      contractPrice: Math.round(totalEstimatedPrice * 100) / 100,
      // Internal cost budget (cost side of approved customer orders) — for reference
      estimatedCost: Math.round(totalEstimatedCost * 100) / 100,
      // Keep estimatedPrice for backward compat
      estimatedPrice: Math.round(totalEstimatedPrice * 100) / 100,
      // Costs: paid, pending, and total
      actualCost: Math.round(totalActualCost * 100) / 100,
      pendingCost: Math.round(totalPendingCost * 100) / 100,
      totalCosts: Math.round(totalCommitted * 100) / 100,
      // Margin = contractPrice - totalCosts
      margin: Math.round(margin * 100) / 100,
      marginPct: Math.round(marginPct * 10) / 10,
      // Keep old field names for backward compat
      projectedMargin: Math.round(margin * 100) / 100,
      projectedMarginPct: Math.round(marginPct * 10) / 10,
      committedCost: Math.round(totalCommitted * 100) / 100,
      remainingBudget: Math.round(Math.max(0, totalEstimatedCost - totalCommitted) * 100) / 100,
      costVariance: Math.round((totalEstimatedCost - totalCommitted) * 100) / 100,
      costVariancePct: totalEstimatedCost > 0
        ? Math.round(((totalEstimatedCost - totalCommitted) / totalEstimatedCost) * 1000) / 10
        : 0,
      contractValue: Math.round(contractTotal * 100) / 100,
      invoicedTotal: Math.round(invoicedTotal * 100) / 100,
      draftInvoiceTotal: Math.round(draftInvoiceTotal * 100) / 100,
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
- Contract Price (what client pays): $${totalEstimatedPrice.toLocaleString()}
- Internal Cost Budget: $${totalEstimatedCost.toLocaleString()}
- Paid Costs (approved bills/POs + labor): $${totalActualCost.toLocaleString()}
- Pending Costs (draft/pending bills/POs): $${totalPendingCost.toLocaleString()}
- Total Costs (paid + pending): $${totalCommitted.toLocaleString()}
${isCostPlus ? `- Collected from Client: $${collectedAmount.toLocaleString()}` : `- Contract Value: $${contractTotal.toLocaleString()}`}
- ${isCostPlus ? 'Profit (Collected - Total Costs)' : 'Margin (Contract - Total Costs)'}: $${margin.toLocaleString()} (${marginPct.toFixed(1)}%)
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

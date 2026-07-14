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
import { getSupabase } from '@/app/api/lib/supabase';

// ============================================================
// Job Costing Detail API
// Deep-dive analysis for a single job
// ============================================================

// Cache lifetime for the computed payload. Nathan asked the detail page
// to NEVER auto-refresh — it should always show the last computed snapshot
// until he explicitly clicks Refresh. So the TTL is effectively infinite;
// only `?refresh=1` will bypass the cache and recompute.
const CACHE_TTL_MS = Number.POSITIVE_INFINITY;

function computeHours(startedAt: string, endedAt: string): number {
  if (!startedAt || !endedAt) return 0;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get('refresh') === '1';
    const { jobId } = await req.json();
    if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

    const sb = getSupabase();

    // ── Cache check ──
    // Returns cached payload when fresh (< CACHE_TTL_MS old) and the
    // client didn't ask for a force-refresh. The cached payload is
    // augmented with `cachedAt` + `cacheAgeMs` so the UI can render
    // "as of X ago" and offer a refresh control.
    if (!forceRefresh) {
      try {
        const { data: cached } = await sb
          .from('job_costing_cache')
          .select('payload, computed_at, compute_ms')
          .eq('job_id', jobId)
          .maybeSingle();
        if (cached?.payload && cached?.computed_at) {
          const ageMs = Date.now() - new Date(cached.computed_at).getTime();
          if (ageMs < CACHE_TTL_MS) {
            return NextResponse.json({
              ...cached.payload,
              cachedAt: cached.computed_at,
              cacheAgeMs: ageMs,
              cacheHit: true,
              cacheComputeMs: cached.compute_ms,
            });
          }
        }
      } catch (err: any) {
        // Cache lookup failures are non-fatal — fall through and compute.
        console.warn('[job-costing/detail] cache read failed:', err?.message || err);
      }
    }

    const computeStartedAt = Date.now();

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

    // Per-cost-code budgeted labor hours. Sums the `quantity` field on
    // every labor- or time-type budget item, grouped by cost code key
    // (ccNum-ccName, same key the budgetByCostCode map uses). Feeds the
    // "Labor Hours by Category" card on the per-job dashboard so Nathan
    // can compare budgeted vs actual work hours per category at a glance.
    const budgetedLaborHoursByCode: Record<string, { ccNum: string; ccName: string; hours: number }> = {};
    const trackBudgetedLabor = (key: string, ccNum: string, ccName: string, qty: number) => {
      if (!budgetedLaborHoursByCode[key]) {
        budgetedLaborHoursByCode[key] = { ccNum, ccName, hours: 0 };
      }
      budgetedLaborHoursByCode[key].hours += qty;
    };

    // An option on an approved contract is only part of the budget if the
    // client actually selected it. JT marks the un-chosen options with
    // isSelected=false at the item level, or buries them under a
    // costGroup / parentCostGroup whose isSelected=false. Without this
    // filter, both Cardene flooring options on Wooley Airbnb got counted
    // even though only Cardene Alpine was chosen.
    const isUnselectedItem = (ci: any): boolean => {
      if (ci?.isSelected === false) return true;
      if (ci?.costGroup?.isSelected === false) return true;
      if (ci?.costGroup?.parentCostGroup?.isSelected === false) return true;
      return false;
    };

    for (const dci of docCostItems) {
      const docType = dci.document?.type || '';
      const docId = dci.document?.id || '';
      if (docType !== 'customerOrder') continue;
      // Only items on approved customer orders count. The set was built
      // from the documents loop above and already excludes "Exclude from
      // Budget" docs, so this single check is enough.
      if (!budgetedApprovedOrderIds.has(docId)) continue;
      // Skip unselected options (see comment on isUnselectedItem above).
      if (isUnselectedItem(dci)) continue;

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
        const qty = Number(dci.quantity) || 0;
        estimatedLaborHours += qty;
        trackBudgetedLabor(key, ccNum, ccName, qty);
      }
    }

    // ── Supplement: job-level standalone budget items ────────────────────
    // Some budget items live at the job level in JT WITHOUT being on any
    // customer-order document (e.g. items added directly to the Budget view,
    // or items whose originating CO was denied but Nathan kept them in the
    // budget). The doc-level pull above misses these. We supplement by
    // walking job-level costItems and including any with no document link
    // AND a positive cost. Items that ARE on an approved CO are already
    // captured above and we dedupe on item id.
    const seenJobCostItemIds = new Set<string>();
    for (const dci of docCostItems) {
      if (dci.document?.type === 'customerOrder' &&
          budgetedApprovedOrderIds.has(dci.document?.id || '')) {
        // Track both the doc-level item id and the linked job-level id so
        // we don't double-count if a standalone shows up with either id.
        if (dci.id) seenJobCostItemIds.add(dci.id);
        const jcid = (dci as any).jobCostItem?.id;
        if (jcid) seenJobCostItemIds.add(jcid);
      }
    }
    for (const ci of costItems) {
      if (seenJobCostItemIds.has(ci.id)) continue;
      // Skip items that ARE linked to a document — those are on some doc
      // (likely denied/draft/pending). The doc-level loop would have
      // included them if the doc was approved; since it didn't, the doc is
      // explicitly NOT approved and we should respect that.
      if (ci.document?.id) continue;
      // Respect JT's selection state — same logic as the doc-level loop.
      if (isUnselectedItem(ci)) continue;
      const cost = Number(ci.cost) || 0;
      const price = Number(ci.price) || 0;
      // Skip zero-cost placeholders (often drafts / Nathan exploring).
      if (cost <= 0 && price <= 0) continue;

      const ccName = ci.costCode?.name || 'Uncoded';
      const ccNum = ci.costCode?.number || '00';
      const key = ccNum + '-' + ccName;
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
        const qty = Number(ci.quantity) || 0;
        estimatedLaborHours += qty;
        trackBudgetedLabor(key, ccNum, ccName, qty);
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
        if (isUnselectedItem(ci)) continue;
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
          const qty = Number(ci.quantity) || 0;
          estimatedLaborHours += qty;
          trackBudgetedLabor(key, ccNum, ccName, qty);
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

    // Per-cost-code WORK hours (excludes travel + break). Pairs with the
    // budgetedLaborHoursByCode map above to build the "Labor Hours by
    // Category" card: budgeted hours come from labor-type budget items
    // on approved COs, actual hours come from work-type time entries.
    // Travel and break time are intentionally NOT included here because
    // Nathan's labor budget represents productive work time.
    const workHoursByCode: Record<string, { ccNum: string; ccName: string; hours: number }> = {};

    // Project Management hours: time entries logged against cc01
    // "Planning, Admin". BKB tracks PM as a percent-of-project-cost
    // metric. The detail response below exposes projected vs actual so
    // the per-job dashboard can show how PM time is tracking.
    let pmActualHours = 0;
    let pmActualCost = 0;
    const pmByUser: Record<string, { name: string; hours: number; cost: number }> = {};

    for (const te of timeEntries) {
      const hours = computeHours(te.startedAt, te.endedAt);
      const userName = te.user?.name || 'Unknown';
      const userId = te.user?.id || 'unknown';

      if (!timeByUser[userId]) {
        timeByUser[userId] = { name: userName, work: 0, travel: 0, break_: 0 };
      }

      // Categorize by type, but default to 'work' if unrecognized
      const entryType = (te.type || '').toLowerCase();
      let isWork = false;
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
        isWork = true;
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

      // Work-only per-cost-code accumulator for the Labor Hours by
      // Category card. Keyed on ccNum-ccName to align with
      // budgetedLaborHoursByCode (which uses the same key shape).
      if (isWork) {
        const workKey = ccNum + '-' + ccName;
        if (!workHoursByCode[workKey]) {
          workHoursByCode[workKey] = { ccNum, ccName, hours: 0 };
        }
        workHoursByCode[workKey].hours += hours;
      }

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

      // PM-specific tracking: cc01 "Planning, Admin" is BKB's project
      // management bucket. Sum the hours + per-employee breakdown so
      // we can compute actual-vs-projected PM further down. Match the
      // cost code by number, not name, so re-labels in JT don't break
      // the metric.
      if (ccNum === '01') {
        pmActualHours += hours;
        pmActualCost += teCost;
        if (!pmByUser[userId]) {
          pmByUser[userId] = { name: userName, hours: 0, cost: 0 };
        }
        pmByUser[userId].hours += hours;
        pmByUser[userId].cost += teCost;
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

    // Labor Hours by Category — budgeted vs actual work vs remaining,
    // grouped by cost code. Built from the budgetedLaborHoursByCode +
    // workHoursByCode maps accumulated above. Union of keys covers
    // categories that had budget but no actual (under-tracking) and
    // categories that had actual but no budget (off-budget labor).
    type CategoryHoursRow = {
      costCodeNumber: string;
      costCodeName: string;
      budgetedHours: number;
      actualHours: number;
      remainingHours: number;
      // True when the category has at least one budgeted hour. UI
      // uses this to show "no budget" sub-text instead of misleading
      // negative-remaining numbers when actual exists without budget.
      hasBudget: boolean;
    };
    const laborHoursByCategoryMap: Record<string, CategoryHoursRow> = {};
    const seedRow = (ccNum: string, ccName: string): CategoryHoursRow => ({
      costCodeNumber: ccNum,
      costCodeName: ccName,
      budgetedHours: 0,
      actualHours: 0,
      remainingHours: 0,
      hasBudget: false,
    });
    for (const [key, b] of Object.entries(budgetedLaborHoursByCode)) {
      if (!laborHoursByCategoryMap[key]) {
        laborHoursByCategoryMap[key] = seedRow(b.ccNum, b.ccName);
      }
      laborHoursByCategoryMap[key].budgetedHours += b.hours;
      if (b.hours > 0) laborHoursByCategoryMap[key].hasBudget = true;
    }
    for (const [key, w] of Object.entries(workHoursByCode)) {
      if (!laborHoursByCategoryMap[key]) {
        laborHoursByCategoryMap[key] = seedRow(w.ccNum, w.ccName);
      }
      laborHoursByCategoryMap[key].actualHours += w.hours;
    }
    const laborHoursByCategory = Object.values(laborHoursByCategoryMap)
      .map((r) => ({
        ...r,
        budgetedHours: Math.round(r.budgetedHours * 10) / 10,
        actualHours: Math.round(r.actualHours * 10) / 10,
        remainingHours: Math.round((r.budgetedHours - r.actualHours) * 10) / 10,
      }))
      // Sort by budgeted desc, then actual desc — the categories with
      // real labor activity surface to the top.
      .sort((a, b) => b.budgetedHours - a.budgetedHours || b.actualHours - a.actualHours);

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
          // Return all budget line items sorted by cost desc. The client
          // renders the first 5 by default and exposes a "Show all" toggle
          // to reveal the rest, so users can drill into a code with many
          // small items without flooding the page on initial render.
          topItems: budget.items.sort((a, b) => b.cost - a.cost),
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
        // Status semantics on customerInvoice docs:
        //   - approved → sent to the client (counts as invoiced)
        //   - pending  → sent to the client awaiting their action (counts as invoiced)
        //   - draft    → prepared but not sent yet (tracked separately so the UI
        //               can show "ready to bill" without inflating invoiced)
        //   - denied   → rejected / superseded — must NOT count. Pre-fix this
        //               fell into the catch-all else and was rolled into
        //               invoicedTotal, which is how Kremser #115 reported
        //               $734K invoiced ($371K approved + $362K denied) when
        //               the real number was $371K. The exclude-from-budget
        //               toggle is a separate filter applied below.
        if (!inBudget) {
          // intentional no-op: doc is excluded from budget rollups
        } else if (doc.status === 'draft') {
          draftInvoiceTotal += entry.price;
        } else if (doc.status === 'approved' || doc.status === 'pending') {
          invoicedTotal += entry.price;
        }
        // status === 'denied' deliberately ignored.
      } else if (doc.type === 'vendorBill') {
        docSummary.vendorBills.push(entry);
      } else if (doc.type === 'vendorOrder') {
        docSummary.vendorOrders.push(entry);
      }
    }

    // ============================================================
    // 6. Schedule progress (with manual override fallback)
    // ============================================================
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t: any) => t.progress >= 1).length;
    const scheduleProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // BKB schedules are often out of date — Nathan can override the schedule-
    // derived % with a manual value (stored in job_manual_progress). When
    // present, the manual value is what the AI cost analysis reasons about
    // and the UI display uses. The schedule value stays in the response so
    // the UI can show both ("Manual 65%, schedule says 48%") if useful.
    let manualProgress: number | null = null;
    let manualSetBy: string | null = null;
    let manualSetAt: string | null = null;
    let manualNotes: string | null = null;
    try {
      const { getSupabase } = await import('../../../lib/supabase');
      const supabase = getSupabase();
      const { data: overrideRow } = await supabase
        .from('job_manual_progress')
        .select('percent_complete, set_by, set_at, notes')
        .eq('job_id', jobId)
        .maybeSingle();
      if (overrideRow) {
        manualProgress = overrideRow.percent_complete;
        manualSetBy = overrideRow.set_by || null;
        manualSetAt = overrideRow.set_at || null;
        manualNotes = overrideRow.notes || null;
      }
    } catch (e: any) {
      console.warn('[job-costing/detail] manual progress lookup failed:', e?.message || e);
    }
    // Progress on a job is now a manual-only field (Nathan's call: BKB
    // schedules don't track actual progress accurately enough to use, even
    // as a fallback). effectiveProgress is null until a manual value is
    // set; the AI prompt omits the PROGRESS line entirely when that's the
    // case so it doesn't get a misleading 0% / schedule-derived signal.
    const effectiveProgress: number | null = manualProgress;
    const progressSource: 'manual' | 'none' = manualProgress != null ? 'manual' : 'none';


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

    // ---- Estimated Cost at Completion (EAC) ----
    // BUG FIX (2026-07-14): margin was `contractPrice - totalCommitted`, i.e.
    // contract minus costs booked SO FAR. That is not the final margin on an
    // in-progress fixed-price job — it ignores the cost still to come and so
    // overstates margin in proportion to how incomplete the job is.
    // See app/api/dashboard/job-costing/route.ts for the Puglia worked example.
    const budgetCostAtCompletion = Number(job?.projectedCost) > 0
      ? Number(job?.projectedCost)
      : totalEstimatedCost;
    const estimatedCostAtCompletion = job?.closedOn
      ? totalCommitted
      : Math.max(totalCommitted, budgetCostAtCompletion);
    const costToComplete = Math.max(0, estimatedCostAtCompletion - totalCommitted);

    // margin/marginPct = PROJECTED FINAL margin (contract - cost at completion)
    // marginToDate     = old costs-booked-so-far view, kept for transparency
    let margin: number;
    let marginPct: number;
    let marginToDate: number;
    let marginToDatePct: number;

    if (isCostPlus) {
      // Cost-plus: profit to date = collected - costs committed. Runs one
      // billing cycle behind (costs committed now, fee invoiced later).
      margin = collectedAmount - totalCommitted;
      marginPct = collectedAmount > 0 ? (margin / collectedAmount) * 100 : 0;
      marginToDate = margin;
      marginToDatePct = marginPct;
    } else {
      // Fixed-price: margin = contract price - estimated cost AT COMPLETION
      margin = totalEstimatedPrice - estimatedCostAtCompletion;
      marginPct = totalEstimatedPrice > 0 ? (margin / totalEstimatedPrice) * 100 : 0;
      marginToDate = totalEstimatedPrice - totalCommitted;
      marginToDatePct = totalEstimatedPrice > 0 ? (marginToDate / totalEstimatedPrice) * 100 : 0;
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
      // Cost at completion (EAC): committed cost plus the cost still to come.
      budgetCostAtCompletion: Math.round(budgetCostAtCompletion * 100) / 100,
      estimatedCostAtCompletion: Math.round(estimatedCostAtCompletion * 100) / 100,
      costToComplete: Math.round(costToComplete * 100) / 100,
      // PROJECTED FINAL margin = contractPrice - estimatedCostAtCompletion
      margin: Math.round(margin * 100) / 100,
      marginPct: Math.round(marginPct * 10) / 10,
      // Margin on costs booked so far (the old, overstated "final margin").
      marginToDate: Math.round(marginToDate * 100) / 100,
      marginToDatePct: Math.round(marginToDatePct * 10) / 10,
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
      // Manual % override state (null when no override is set).
      progressSource,
      effectiveProgress,
      manualProgress,
      manualSetBy,
      manualSetAt,
      manualNotes,
    };

    // ============================================================
    // 7b. Project Management hours analysis
    // ============================================================
    // BKB's rule of thumb: PM cost = 6% of the project's total cost,
    // divided by the PM hourly rate ($85) gives projected PM hours.
    //   projectedHours = (totalCost * 0.06) / 85
    //
    // The basis cost depends on contract type:
    //   - Fixed-price: use the internal cost budget (estimatedCost)
    //     when it's set — that's the closest thing to "total cost"
    //     before the job is done. Fall back to totalCommitted (paid +
    //     pending) when budget is missing.
    //   - Cost-plus: there is no budget, so total cost is whatever
    //     we've committed so far (totalCommitted). The metric drifts
    //     as the job grows — that's expected.
    //
    // Actual PM hours come from time entries logged on cc01
    // "Planning, Admin" (computed in the time-entry loop above).
    const PM_PCT_OF_COST = 0.06;
    const PM_HOURLY_RATE = 85;
    const pmBasisCost = !isCostPlus && totalEstimatedCost > 0
      ? totalEstimatedCost
      : totalCommitted;
    const pmBasisLabel = !isCostPlus && totalEstimatedCost > 0
      ? 'Internal Cost Budget'
      : 'Total Costs (paid + pending)';
    const pmProjectedHours = pmBasisCost > 0
      ? (pmBasisCost * PM_PCT_OF_COST) / PM_HOURLY_RATE
      : 0;
    const pmPctUsed = pmProjectedHours > 0
      ? (pmActualHours / pmProjectedHours) * 100
      : 0;
    // Budgeted PM percent-of-cost on this job. Reads from the
    // approved-CO budget breakdown we already built earlier in the
    // route: every cc01 budget line item's estimated cost summed up,
    // divided by the total internal cost budget. Tells Nathan what
    // percent of the project's total cost was planned for PM up-front.
    // Compared to the actualPctOfCost number, this surfaces whether
    // PM is tracking ahead of, behind, or right on what was budgeted.
    let pmBudgetedCost = 0;
    let pmBudgetedHours = 0;
    for (const v of Object.values(budgetByCostCode)) {
      if (v.costCodeNumber === '01') {
        pmBudgetedCost += v.estimatedCost;
        // Approximate budgeted PM hours from the budgeted PM cost using
        // the formula's $85 rate. Useful for the UI to show projected vs
        // budgeted side-by-side without mixing reference frames.
        pmBudgetedHours += v.estimatedCost / PM_HOURLY_RATE;
      }
    }
    const pmBudgetedPctOfCost = totalEstimatedCost > 0
      ? (pmBudgetedCost / totalEstimatedCost) * 100
      : 0;

    // Actual PM percent-of-cost on this job. This is the answer to
    // "what percent would I plug into the formula on future projects
    // to project the same PM hours this project actually used?"
    // Derived by solving the BKB formula for pct:
    //     projected_hours = (total_cost × pct) / hourly_rate
    //  →  pct = (actual_hours × hourly_rate) / total_cost
    //
    // Important: the numerator is actual_hours × $85, NOT the sum of
    // burdened time-entry costs (pmActualCost). The formula uses a
    // single fixed PM rate ($85), but team members log time at their
    // OWN burdened rate (te.cost = hours × employee rate). Using
    // pmActualCost would give "PM dollar share of project costs", a
    // different concept; using hours × $85 gives the calibration
    // number that inverts the formula cleanly.
    //
    // Denominator is ALWAYS total committed costs (paid + pending),
    // not the budget — this is a historical signal, not a forecast.
    const pmActualPctBasis = totalCommitted;
    const pmFormulaEquivalentCost = pmActualHours * PM_HOURLY_RATE;
    const pmActualPctOfCost = pmActualPctBasis > 0
      ? (pmFormulaEquivalentCost / pmActualPctBasis) * 100
      : 0;

    const pmAnalysis = {
      basisCost: Math.round(pmBasisCost * 100) / 100,
      basisLabel: pmBasisLabel,
      pctOfCost: PM_PCT_OF_COST * 100,
      hourlyRate: PM_HOURLY_RATE,
      projectedHours: Math.round(pmProjectedHours * 10) / 10,
      actualHours: Math.round(pmActualHours * 10) / 10,
      actualCost: Math.round(pmActualCost * 100) / 100,
      // Where this job is actually running on the percent-of-cost axis,
      // independent of the projected-hours framing. The basis used for
      // this number is always total committed costs (paid + pending) —
      // see comment above. Surfaced alongside the percent so the UI can
      // show "X% of $Y total costs".
      actualPctOfCost: Math.round(pmActualPctOfCost * 100) / 100,
      actualPctBasis: Math.round(pmActualPctBasis * 100) / 100,
      // What was budgeted for PM as a % of the project's internal
      // cost budget. Null when there's no cost budget (cost-plus jobs,
      // or pre-budget fixed-price jobs) — UI shows "—" in that case.
      budgetedPctOfCost: totalEstimatedCost > 0
        ? Math.round(pmBudgetedPctOfCost * 100) / 100
        : null,
      budgetedCost: Math.round(pmBudgetedCost * 100) / 100,
      budgetedHours: Math.round(pmBudgetedHours * 10) / 10,
      budgetedPctBasis: Math.round(totalEstimatedCost * 100) / 100,
      pctUsed: Math.round(pmPctUsed * 10) / 10,
      remainingHours: Math.round((pmProjectedHours - pmActualHours) * 10) / 10,
      // Per-employee breakdown so the UI can drill into who's spending
      // the PM hours. Sorted by hours desc.
      byUser: Object.values(pmByUser)
        .map((u) => ({
          name: u.name,
          hours: Math.round(u.hours * 10) / 10,
          cost: Math.round(u.cost * 100) / 100,
        }))
        .sort((a, b) => b.hours - a.hours),
    };

    // ============================================================
    // 8. AI Analysis — now ON-DEMAND
    // ============================================================
    // Previously the AI analysis ran on every detail load. That was costly
    // and slow, and it re-fired after every per-cost-code % save (which
    // re-fetches the detail). The AI is now triggered explicitly via the
    // separate POST /api/dashboard/job-costing/ai-analysis endpoint, which
    // takes the detail object the client already has and returns just the
    // analysis text. The detail response returns an empty string here so
    // the UI knows to show the "Run AI Analysis" placeholder card.
    const aiAnalysis = '';

    const computeMs = Date.now() - computeStartedAt;

    const payload = {
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
      laborHoursByCategory,
      pmAnalysis,
      aiAnalysis,
    };

    // Write to cache for the next request. Fire-and-forget — if it
    // fails we still return the computed payload, the caller doesn't
    // care that we couldn't memoize. UPSERT on job_id so re-computes
    // overwrite the prior row cleanly.
    const computedAtIso = new Date().toISOString();
    try {
      await sb
        .from('job_costing_cache')
        .upsert({
          job_id: jobId,
          payload,
          computed_at: computedAtIso,
          compute_ms: computeMs,
        }, { onConflict: 'job_id' });
    } catch (err: any) {
      console.warn('[job-costing/detail] cache write failed:', err?.message || err);
    }

    return NextResponse.json({
      ...payload,
      cachedAt: computedAtIso,
      cacheAgeMs: 0,
      cacheHit: false,
      cacheComputeMs: computeMs,
    });
  } catch (err: any) {
    console.error('Job costing detail error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

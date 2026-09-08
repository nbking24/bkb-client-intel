// @ts-nocheck
/**
 * GET /api/dashboard/precon/selections
 *
 * Cross-project selections overview for the Pre-Con dashboard. One row per
 * active job (In Design + Ready + In Production — Final Billing and leads
 * excluded), each carrying its 📜 Selections register lines grouped by the
 * cost-item "Status" custom field.
 *
 * Register-aware since 2026-09-08, per claude/BKB-Selections-System-Spec.md
 * (JobTread Assistant project) — the same conventions the selections-build /
 * selection-updates skills and the Client Selections Sheet follow:
 *
 *   - The register is the `📜 Selections` cost-group subtree. A line INSIDE
 *     it, or carrying the boolean `Selection` custom field (22PBByMRR2XS),
 *     is a selection. The old tracker included any item with a Status set;
 *     those legacy rows still show, flagged as outside the register.
 *   - Status `0. Not Started` is a first-class bucket (the spec says Status
 *     is never blank; blank rows are surfaced under Not Started with a
 *     `blankStatus` flag so they get fixed rather than hidden).
 *   - Per-job register-health flags: hasRegister, registerName variant,
 *     strays (selection-marked lines outside the register — invisible to
 *     the Design Board), missing markers, blank statuses.
 *   - Jobs with NO register (or an empty one) are returned in `needsSetup`
 *     so it's obvious at a glance which projects have no selections
 *     tracking yet.
 *   - Each register job carries `sheetPath` — the tokened public Client
 *     Selections Sheet link (/s/…), so the sheet is one click from the
 *     tracker (the standalone Selections Sheet tab folded in here).
 *
 * Status option strings (exact, as authored in JT):
 *   0. Not Started · 1. Client Selection Needed · 2. Internal Selection
 *   Needed · 3. Pricing Pending · 4. Selected/Needs Order ·
 *   5. Ordered/Finalized
 */
import { NextResponse } from 'next/server';
import { getActiveJobs, pave } from '@/app/lib/jobtread';
import { makeSheetToken } from '@/app/api/lib/selections-sheet';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Custom field IDs (both target costItem, BKB org 22P5SRwhLaYe).
const STATUS_CF_ID = '22P5WiHgkzx9';
const SELECTION_CF_ID = '22PBByMRR2XS';
const INTERNAL_NOTES_CF_ID = '22P5WiMpe6AM';

const REGISTER_NAME = '📜 Selections';

const SELECTION_STATUSES = [
  '0. Not Started',
  '1. Client Selection Needed',
  '2. Internal Selection Needed',
  '3. Pricing Pending',
  '4. Selected/Needs Order',
  '5. Ordered/Finalized',
] as const;

type SelectionStatus = (typeof SELECTION_STATUSES)[number];

const STATUS_KEY: Record<SelectionStatus, string> = {
  '0. Not Started': 'notStarted',
  '1. Client Selection Needed': 'clientSelectionNeeded',
  '2. Internal Selection Needed': 'internalSelectionNeeded',
  '3. Pricing Pending': 'pricingPending',
  '4. Selected/Needs Order': 'selectedNeedsOrder',
  '5. Ordered/Finalized': 'orderedFinalized',
};

const EMPTY_COUNTS = () => ({
  notStarted: 0,
  clientSelectionNeeded: 0,
  internalSelectionNeeded: 0,
  pricingPending: 0,
  selectedNeedsOrder: 0,
  orderedFinalized: 0,
});

// ------------------------------------------------------------
// JT fetch helpers
// ------------------------------------------------------------

/** All cost groups on a job (id, name, parent) — paginated at PAVE's 100 cap. */
async function fetchCostGroups(jobId: string): Promise<any[]> {
  const out: any[] = [];
  let nextPage: string | null = null;
  for (let i = 0; i < 10; i++) {
    const params: any = {
      $: { size: 100 },
      nextPage: {},
      nodes: { id: {}, name: {}, parentCostGroup: { id: {} } },
    };
    if (nextPage) params.$.page = nextPage;
    const data = await pave({ job: { $: { id: jobId }, costGroups: params } });
    const pageData = (data as any)?.job?.costGroups;
    out.push(...(pageData?.nodes || []));
    nextPage = pageData?.nextPage || null;
    if (!nextPage) break;
  }
  return out;
}

/** Cost items with status/selection custom fields. Small pages — the nested
 *  customFieldValues collection gets expensive and JT 413s past ~25. */
async function fetchCostItemsWithStatus(jobId: string): Promise<any[]> {
  const PAGE_SIZE = 25;
  const MAX_PAGES = 100;
  const out: any[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            cost: {},
            unitPrice: {},
            quantity: {},
            isSpecification: {},
            unit: { name: {} },
            costCode: { id: {}, number: {}, name: {} },
            costType: { id: {}, name: {} },
            costGroup: { id: {}, name: {}, parentCostGroup: { id: {}, name: {} } },
            document: { id: {} },
            customFieldValues: {
              $: { size: 10 },
              nodes: { value: {}, customField: { id: {} } },
            },
          },
        },
      },
    });

    const ciPage = (data as any)?.job?.costItems;
    const nodes = ciPage?.nodes || [];
    out.push(...nodes);
    nextPage = ciPage?.nextPage || null;
    if (!nextPage || nodes.length < PAGE_SIZE) break;
  }

  return out;
}

// ------------------------------------------------------------
// Register detection
// ------------------------------------------------------------

/** Identify the register root group(s) on a job. Exact `📜 Selections` is
 *  canonical; any other 📜-prefixed group whose name contains "Selection"
 *  is a legacy variant (flagged so it can be renamed). `📜 Project
 *  Specifications` / `📜 Specifications` are NOT registers. */
function findRegisterRoots(groups: any[]): { ids: Set<string>; name: string | null; isVariant: boolean } {
  const exact = groups.filter((g) => (g.name || '').trim() === REGISTER_NAME);
  if (exact.length > 0) {
    return { ids: new Set(exact.map((g) => g.id)), name: REGISTER_NAME, isVariant: false };
  }
  const variants = groups.filter((g) => {
    const n = (g.name || '').trim();
    return n.includes('📜') && /selection/i.test(n) && !/specification/i.test(n);
  });
  if (variants.length > 0) {
    return { ids: new Set(variants.map((g) => g.id)), name: variants[0].name, isVariant: true };
  }
  return { ids: new Set(), name: null, isVariant: false };
}

/** True when the item's group chain passes through a register root. */
function isInRegister(item: any, groupById: Record<string, any>, registerIds: Set<string>): boolean {
  if (registerIds.size === 0) return false;
  let gid = item.costGroup?.id || null;
  let guard = 0;
  while (gid && guard++ < 15) {
    if (registerIds.has(gid)) return true;
    gid = groupById[gid]?.parentCostGroup?.id || null;
  }
  return false;
}

function cfValue(item: any, cfId: string): any {
  const node = (item.customFieldValues?.nodes || []).find(
    (n: any) => n.customField?.id === cfId,
  );
  return node?.value;
}

// ------------------------------------------------------------
// Route
// ------------------------------------------------------------

export async function GET() {
  try {
    const jobs = await getActiveJobs(500);
    const targetJobs = jobs.filter((j: any) => {
      const cat = j.statusCategory;
      return cat === 'IN_DESIGN' || cat === 'READY' || cat === 'IN_PRODUCTION';
    });

    const BATCH = 4;
    const jobResults: any[] = [];
    for (let i = 0; i < targetJobs.length; i += BATCH) {
      const slice = targetJobs.slice(i, i + BATCH);
      const batch = await Promise.all(
        slice.map(async (job: any) => {
          try {
            const [items, groups] = await Promise.all([
              fetchCostItemsWithStatus(job.id),
              fetchCostGroups(job.id),
            ]);

            const groupById: Record<string, any> = {};
            for (const g of groups) groupById[g.id] = g;
            const register = findRegisterRoots(groups);
            const hasRegister = register.ids.size > 0;

            // Shape every line that belongs on the tracker:
            //   - inside the 📜 Selections register subtree, OR
            //   - carrying the Selection custom field, OR
            //   - legacy: any job-level item with a Status set (kept so
            //     nothing Nathan/Allison already track disappears; flagged
            //     as outside the register).
            const statusedItems: any[] = [];
            let strayCount = 0;
            let missingMarkerCount = 0;
            let blankStatusCount = 0;

            for (const it of items) {
              if (it.document && it.document.id) continue; // doc lines carry money, not decisions

              const selectionMarked = String(cfValue(it, SELECTION_CF_ID)) === 'true';
              const inRegister = isInRegister(it, groupById, register.ids);
              const rawStatus = cfValue(it, STATUS_CF_ID);
              const statusSet = !!(rawStatus && String(rawStatus).trim());
              if (!inRegister && !selectionMarked && !statusSet) continue;

              const blankStatus = !statusSet;
              // Spec: Status is never blank. Surface blanks under Not
              // Started (flagged) instead of hiding them like the old
              // tracker did.
              const status = statusSet ? String(rawStatus).trim() : '0. Not Started';
              const stray = !inRegister && (selectionMarked || statusSet);
              const missingMarker = inRegister && !selectionMarked;
              if (stray) strayCount++;
              if (missingMarker) missingMarkerCount++;
              if (blankStatus) blankStatusCount++;

              const notesCfv = cfValue(it, INTERNAL_NOTES_CF_ID);
              statusedItems.push({
                id: it.id,
                name: it.name || '',
                description: it.description || '',
                quantity: it.quantity ?? null,
                unitName: it.unit?.name || '',
                unitPrice: it.unitPrice ?? null,
                cost: Number(it.cost) || 0,
                costCodeNumber: it.costCode?.number || '',
                costCodeName: it.costCode?.name || '',
                costGroupId: it.costGroup?.id || null,
                costGroupName: it.costGroup?.name || '',
                parentGroupName: it.costGroup?.parentCostGroup?.name || '',
                status,
                internalNotes: notesCfv ? String(notesCfv).trim() : '',
                // Register-health flags (spec audit vocabulary).
                inRegister,
                stray,
                missingMarker,
                blankStatus,
                // Support lines (Shipping, Templating, allowance credits…)
                // are register lines but not client-facing decisions.
                supportLine: it.isSpecification === false && (inRegister || selectionMarked),
              });
            }

            const counts = EMPTY_COUNTS();
            for (const it of statusedItems) {
              const k = STATUS_KEY[it.status as SelectionStatus];
              if (k) counts[k] += 1;
            }

            return {
              jobId: job.id,
              jobName: job.name,
              jobNumber: job.number || '',
              clientName: job.clientName || '',
              customStatus: job.customStatus || null,
              statusCategory: job.statusCategory || null,
              counts,
              // Actionable = still needs shepherding (everything except
              // Ordered/Finalized). Not Started counts — an unstarted
              // decision is exactly the thing this page exists to surface.
              actionableCount:
                counts.notStarted +
                counts.clientSelectionNeeded +
                counts.internalSelectionNeeded +
                counts.pricingPending +
                counts.selectedNeedsOrder,
              items: statusedItems,
              // Register health.
              hasRegister,
              registerName: register.name,
              registerNameVariant: register.isVariant,
              strayCount,
              missingMarkerCount,
              blankStatusCount,
              // Client Selections Sheet (tokened public link) — the sheet
              // renders the register, so only offered when one exists.
              sheetPath: hasRegister ? '/s/' + makeSheetToken(job.id) : null,
            };
          } catch (err: any) {
            console.error(`[precon/selections] job ${job.id} failed:`, err?.message || err);
            return null;
          }
        }),
      );
      jobResults.push(...batch.filter(Boolean));
    }

    // Jobs with lines to show.
    const visible = jobResults.filter((j) => j.items.length > 0);

    // Jobs with nothing tracked: no register at all, or a register with no
    // lines. Surfaced separately so "which projects have no selections
    // tracking yet" is answerable at a glance.
    const needsSetup = jobResults
      .filter((j) => j.items.length === 0)
      .map((j) => ({
        jobId: j.jobId,
        jobName: j.jobName,
        jobNumber: j.jobNumber,
        clientName: j.clientName,
        statusCategory: j.statusCategory,
        customStatus: j.customStatus,
        reason: j.hasRegister ? 'empty-register' : 'no-register',
      }))
      .sort((a, b) => (a.clientName || a.jobName).localeCompare(b.clientName || b.jobName));

    visible.sort((a, b) => {
      if (a.actionableCount !== b.actionableCount) return b.actionableCount - a.actionableCount;
      return (a.clientName || a.jobName).localeCompare(b.clientName || b.jobName);
    });

    const totals = visible.reduce(
      (acc, j) => {
        acc.notStarted += j.counts.notStarted;
        acc.clientSelectionNeeded += j.counts.clientSelectionNeeded;
        acc.internalSelectionNeeded += j.counts.internalSelectionNeeded;
        acc.pricingPending += j.counts.pricingPending;
        acc.selectedNeedsOrder += j.counts.selectedNeedsOrder;
        acc.orderedFinalized += j.counts.orderedFinalized;
        acc.actionable += j.actionableCount;
        acc.strays += j.strayCount;
        acc.blankStatuses += j.blankStatusCount;
        return acc;
      },
      {
        jobCount: visible.length,
        actionable: 0,
        ...EMPTY_COUNTS(),
        strays: 0,
        blankStatuses: 0,
        needsSetupCount: needsSetup.length,
      },
    );

    return NextResponse.json({
      computedAt: new Date().toISOString(),
      totals,
      jobs: visible,
      needsSetup,
      statusOptions: SELECTION_STATUSES,
    });
  } catch (err: any) {
    console.error('[precon/selections] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to load selections' }, { status: 500 });
  }
}

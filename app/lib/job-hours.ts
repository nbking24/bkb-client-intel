// @ts-nocheck
/**
 * Labor and admin hours for one job: budgeted against used.
 *
 * Same rules as the Job Costing detail page (app/api/dashboard/job-costing/detail/route.ts),
 * so the Production Meeting and Job Costing show the same hours:
 *   Budgeted  quantity on every Labor or Time cost-type line on an approved customer
 *             order (not "Exclude from Budget"), plus job-level budget lines that are on
 *             no document; unselected options are skipped.
 *   Used      work time entries (travel and break are not counted).
 *   Admin     cost code 01 "Planning, Admin". Labor is every other cost code.
 * If the rules change on the Job Costing page, change them here too.
 *
 * Reads only the Labor lines in one paginated query (the Job Costing page reads every
 * document line by line, which takes minutes on jobs with 150+ documents).
 */
import { pave, getTimeEntriesForJob } from '@/app/lib/jobtread';

const ADMIN_CODE = '01';

const isUnselected = (ci: any) =>
  ci?.isSelected === false || ci?.costGroup?.isSelected === false || ci?.costGroup?.parentCostGroup?.isSelected === false;
const isLaborType = (ci: any) => {
  const t = String(ci?.costType?.name || '').toLowerCase();
  return t.includes('labor') || t.includes('time');
};
const hoursOf = (te: any) => {
  if (!te?.startedAt || !te?.endedAt) return 0;
  return Math.max(0, (new Date(te.endedAt).getTime() - new Date(te.startedAt).getTime()) / 3600000);
};
const r1 = (n: number) => Math.round(n * 10) / 10;

export type JobHours = {
  labor: { budget: number; used: number };
  admin: { budget: number; used: number };
  computedAt: string;
};

/** Every Labor cost item on the job, budget lines and document lines alike. */
async function fetchLaborItems(jobId: string): Promise<any[]> {
  const out: any[] = [];
  let page: string | null = null;
  for (let i = 0; i < 20; i++) {
    const args: any = { size: 100, where: [['costType', 'name'], '=', 'Labor'] };
    if (page) args.page = page;
    const data: any = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: args,
          nextPage: {},
          nodes: {
            id: {}, quantity: {}, cost: {}, price: {}, isSelected: {},
            costType: { name: {} },
            costCode: { number: {} },
            document: { id: {}, type: {}, status: {}, includeInBudget: {} },
            jobCostItem: { id: {} },
            costGroup: { isSelected: {}, parentCostGroup: { isSelected: {} } },
          },
        },
      },
    });
    const conn = data?.job?.costItems;
    out.push(...(conn?.nodes || []));
    page = conn?.nextPage || null;
    if (!page) break;
  }
  return out;
}

export async function computeJobHours(jobId: string): Promise<JobHours> {
  const [items, timeEntries] = await Promise.all([fetchLaborItems(jobId), getTimeEntriesForJob(jobId)]);

  let laborBudget = 0, adminBudget = 0;
  const add = (ci: any) => {
    if (!isLaborType(ci)) return;
    const q = Number(ci.quantity) || 0;
    if ((ci.costCode?.number || '00') === ADMIN_CODE) adminBudget += q; else laborBudget += q;
  };
  // lines on approved customer orders (not "Exclude from Budget")
  const onApproved = (ci: any) => ci.document?.type === 'customerOrder' && ci.document?.status === 'approved' && ci.document?.includeInBudget !== false;
  const seen = new Set<string>();
  for (const ci of items) {
    if (!onApproved(ci)) continue;
    seen.add(ci.id);
    if (ci.jobCostItem?.id) seen.add(ci.jobCostItem.id);
    if (!isUnselected(ci)) add(ci);
  }
  // plus budget lines on no document that no approved order covers
  for (const ci of items) {
    if (ci.document?.id || seen.has(ci.id) || isUnselected(ci)) continue;
    if ((Number(ci.cost) || 0) <= 0 && (Number(ci.price) || 0) <= 0) continue;
    add(ci);
  }

  let laborUsed = 0, adminUsed = 0;
  for (const te of timeEntries || []) {
    const type = String(te.type || '').toLowerCase();
    if (type === 'travel' || type === 'break') continue;
    const h = hoursOf(te);
    if ((te.costItem?.costCode?.number || '00') === ADMIN_CODE) adminUsed += h; else laborUsed += h;
  }

  return {
    labor: { budget: r1(laborBudget), used: r1(laborUsed) },
    admin: { budget: r1(adminBudget), used: r1(adminUsed) },
    computedAt: new Date().toISOString(),
  };
}

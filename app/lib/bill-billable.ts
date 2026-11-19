// @ts-nocheck
/**
 * Billable bills: find a job's "Billable Items" budget lines, creating the
 * group when the job does not have one.
 *
 * BKB keeps a "Billable Items" group in every budget (sometimes named with a
 * flag emoji in front, "🚩 Billable Items") holding three cost code 23 lines
 * built from the organization catalog:
 *   23 Billable Labor      (2301, cost type Labor)
 *   23 Billable Subs       (2302, cost type Subcontractor)
 *   23 Billable Materials  (2303, cost type Materials)
 * A bill that is billable to the client but is not on an approved budget item
 * is linked to 2302 or 2303 so it can be invoiced later.
 *
 * Style note: no em or en dashes in this file.
 */
import { pave } from '@/app/lib/jobtread';

export type BillableKind = 'subs' | 'materials';

/** Catalog items the Billable Items lines are made from (organization cost items). */
const CATALOG = {
  labor: '22P5ghRPEcra', // 23 Billable Labor
  materials: '22P5hmeuUXjW', // 23 Billable Materials
  subs: '22P5hmeJjqkj', // 23 Billable Subs
} as const;

const COST_TYPE_FOR: Record<'labor' | 'subs' | 'materials', RegExp> = {
  labor: /^labor$/i,
  subs: /^sub/i,
  materials: /^material/i,
};

const GROUP_RE = /billable items/i;

/**
 * Which billable line a bill line belongs on, from its name. Bill lines are
 * named like "02-Demo, Grading, Sitework:0202 - Sub" or "08-Roofing:0803 -
 * Materials": a 4 digit code ending 03, or the word Materials, means 2303;
 * anything else (subcontractor, labor, unknown) means 2302.
 */
export function guessBillableKind(lineName: string | null | undefined, lineCostCode?: string | null): BillableKind {
  const name = String(lineName || '');
  const code = (name.match(/\b\d{2}(0[1-3])\b/) || [])[1] || String(lineCostCode || '').slice(2, 4);
  if (code === '03' || /\bmaterials?\b/i.test(name)) return 'materials';
  return 'subs';
}

type BudgetLine = { id: string; name: string; costCodeId: string | null; costTypeName: string | null; groupId: string | null; groupName: string | null };

/** Job level cost code 23 lines that sit in a Billable Items group. */
async function loadBillableLines(jobId: string): Promise<BudgetLine[]> {
  const out: BudgetLine[] = [];
  let page: string | undefined;
  for (let i = 0; i < 10; i++) {
    const data: any = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: { size: 50, where: [['costCode', 'number'], '23'], ...(page ? { page } : {}) },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            document: { id: {} },
            costCode: { id: {} },
            costType: { name: {} },
            costGroup: { id: {}, name: {} },
          },
        },
      },
    });
    const conn = data?.job?.costItems;
    for (const n of conn?.nodes || []) {
      if (n.document?.id) continue; // bill and order lines, not the budget
      if (!GROUP_RE.test(n.costGroup?.name || '')) continue;
      out.push({
        id: n.id,
        name: n.name,
        costCodeId: n.costCode?.id || null,
        costTypeName: n.costType?.name || null,
        groupId: n.costGroup?.id || null,
        groupName: n.costGroup?.name || null,
      });
    }
    page = conn?.nextPage || undefined;
    if (!page) break;
  }
  return out;
}

/** The catalog item's fields, read fresh so the new line matches the catalog. */
async function catalogLine(which: keyof typeof CATALOG) {
  const data: any = await pave({
    costItem: {
      $: { id: CATALOG[which] },
      name: {},
      description: {},
      quantity: {},
      unitCost: {},
      unitPrice: {},
      isTaxable: {},
      costCode: { id: {} },
      costType: { id: {} },
      unit: { id: {} },
    },
  });
  const c = data?.costItem;
  if (!c?.name) throw new Error('Could not read the "' + which + '" billable catalog item from JobTread');
  return {
    name: c.name,
    description: c.description ?? null,
    organizationCostItemId: CATALOG[which],
    costCodeId: c.costCode?.id || null,
    costTypeId: c.costType?.id || null,
    unitId: c.unit?.id || null,
    quantity: c.quantity ?? null,
    unitCost: c.unitCost ?? null,
    unitPrice: c.unitPrice ?? null,
    isTaxable: c.isTaxable === true,
  };
}

/**
 * The job's billable line for `kind`. Creates what is missing:
 *   - no Billable Items group: the group with all three lines
 *   - group without that line: just that line, inside the group
 * Returns the line plus what was created, for the UI message.
 */
export async function getOrCreateBillableLine(jobId: string, kind: BillableKind) {
  let lines = await loadBillableLines(jobId);
  let created: 'group' | 'line' | null = null;
  const find = () => lines.find((l) => COST_TYPE_FOR[kind].test(l.costTypeName || ''));

  if (!lines.length) {
    // The group first, then each catalog line inside it.
    const items = await Promise.all((['labor', 'subs', 'materials'] as const).map(catalogLine));
    const g: any = await pave({
      createCostGroup: { $: { jobId, name: 'Billable Items' }, createdCostGroup: { id: {} } },
    });
    const groupId = g?.createCostGroup?.createdCostGroup?.id;
    if (!groupId) throw new Error('JobTread did not return the new Billable Items group');
    for (const it of items) {
      await pave({ createCostItem: { $: { jobId, costGroupId: groupId, ...it }, createdCostItem: { id: {} } } });
    }
    created = 'group';
    lines = await loadBillableLines(jobId);
  } else if (!find()) {
    const it = await catalogLine(kind);
    await pave({
      createCostItem: {
        $: { jobId, costGroupId: lines[0].groupId, ...it },
        createdCostItem: { id: {} },
      },
    });
    created = 'line';
    lines = await loadBillableLines(jobId);
  }

  const line = find();
  if (!line) throw new Error('The job has no ' + (kind === 'subs' ? '23 Billable Subs' : '23 Billable Materials') + ' line in its Billable Items group, and it could not be created.');
  return { line, created };
}

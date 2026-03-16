// @ts-nocheck
// ============================================================
// POST /api/estimating/create — Create Budget in JobTread
// Takes an approved budget proposal and creates groups + items
// in the actual JobTread job via PAVE API
// Uses correct PAVE mutation syntax (same as MCP tools)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../../lib/auth';
import type { ProposedBudget, BudgetLineItem } from '@/app/lib/estimating-agent';

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';

async function pave(query: Record<string, unknown>) {
  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { $: { grantKey: JT_KEY() }, ...query } }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`JT PAVE error ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error('JT PAVE: ' + json.errors.map((e: any) => e.message || JSON.stringify(e)).join('; '));
  }
  return json;
}

// -- Create a cost group using correct PAVE mutation syntax --
async function createCostGroup(
  jobId: string,
  name: string,
  description: string,
  parentCostGroupId?: string
): Promise<string> {
  const result = await pave({
    createCostGroup: {
      $: {
        jobId,
        name,
        ...(description ? { description } : {}),
        ...(parentCostGroupId ? { parentCostGroupId } : {}),
      },
      createdCostGroup: { id: {}, name: {} },
    },
  });

  const groupId = result?.createCostGroup?.createdCostGroup?.id;
  if (!groupId) throw new Error(`Failed to create cost group: ${name} — ${JSON.stringify(result)}`);
  return groupId;
}

// -- Create a cost item using correct PAVE mutation syntax --
async function createCostItem(
  jobId: string,
  costGroupId: string,
  item: BudgetLineItem
): Promise<string> {
  const result = await pave({
    createCostItem: {
      $: {
        jobId,
        costGroupId,
        name: item.name,
        ...(item.description ? { description: item.description } : {}),
        quantity: item.quantity,
        unitCost: item.unitCost,
        unitPrice: item.unitPrice,
        ...(item.costCodeId ? { costCodeId: item.costCodeId } : {}),
        ...(item.costTypeId ? { costTypeId: item.costTypeId } : {}),
        ...(item.unitId ? { unitId: item.unitId } : {}),
        ...(item.organizationCostItemId ? { organizationCostItemId: item.organizationCostItemId } : {}),
      },
      createdCostItem: { id: {}, name: {} },
    },
  });

  const itemId = result?.createCostItem?.createdCostItem?.id;
  if (!itemId) throw new Error(`Failed to create cost item: ${item.name} — ${JSON.stringify(result)}`);
  return itemId;
}

// -- Find or create a group by path (handles nesting like "Demo > Labor") --
async function ensureGroupPath(
  jobId: string,
  groupPath: string,
  groupDescription: string,
  groupCache: Map<string, string>,
  existingGroups: Map<string, string>
): Promise<string> {
  // Check cache first
  if (groupCache.has(groupPath)) return groupCache.get(groupPath)!;

  // Check existing groups
  if (existingGroups.has(groupPath)) {
    groupCache.set(groupPath, existingGroups.get(groupPath)!);
    return existingGroups.get(groupPath)!;
  }

  const parts = groupPath.split(' > ');
  let parentId: string | undefined;

  // Walk the path, creating groups as needed
  for (let i = 0; i < parts.length; i++) {
    const subPath = parts.slice(0, i + 1).join(' > ');

    if (groupCache.has(subPath)) {
      parentId = groupCache.get(subPath);
      continue;
    }

    if (existingGroups.has(subPath)) {
      parentId = existingGroups.get(subPath)!;
      groupCache.set(subPath, parentId);
      continue;
    }

    // Create this segment — only the leaf gets the description
    const isLeaf = i === parts.length - 1;
    const desc = isLeaf ? groupDescription : '';
    const groupId = await createCostGroup(jobId, parts[i], desc, parentId);
    groupCache.set(subPath, groupId);
    parentId = groupId;
  }

  return parentId!;
}

// -- Fetch existing groups for the job (paginated, max 100 per page) --
async function getExistingGroups(jobId: string): Promise<Map<string, string>> {
  const PAGE_SIZE = 100;
  let allGroups: any[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 10; page++) {
    const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
    if (nextPage) pageParams.page = nextPage;

    const result = await pave({
      job: {
        $: { id: jobId },
        costGroups: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            parentCostGroup: {
              id: {},
              name: {},
              parentCostGroup: {
                id: {},
                name: {},
                parentCostGroup: {
                  id: {},
                  name: {},
                  parentCostGroup: {
                    id: {},
                    name: {},
                  },
                },
              },
            },
          },
        },
      },
    });

    const nodes = result?.job?.costGroups?.nodes || [];
    allGroups = allGroups.concat(nodes);

    nextPage = result?.job?.costGroups?.nextPage || null;
    if (!nextPage || nodes.length < PAGE_SIZE) break;
  }

  const groups = allGroups;
  const idToPath = new Map<string, string>();
  const pathToId = new Map<string, string>();

  // Build path from ancestry
  function buildPath(group: any): string {
    if (idToPath.has(group.id)) return idToPath.get(group.id)!;

    let path = group.name;
    if (group.parentCostGroup) {
      const parentPath = buildPath(group.parentCostGroup);
      path = `${parentPath} > ${group.name}`;
    }
    idToPath.set(group.id, path);
    return path;
  }

  for (const g of groups) {
    const path = buildPath(g);
    pathToId.set(path, g.id);
  }

  return pathToId;
}

// -- Main handler --

export async function POST(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { jobId, budget } = body as { jobId: string; budget: ProposedBudget };

    if (!jobId || !budget || !budget.lineItems?.length) {
      return NextResponse.json({ error: 'Missing jobId or budget data' }, { status: 400 });
    }

    // Fetch existing groups to avoid duplicates
    const existingGroups = await getExistingGroups(jobId);
    const groupCache = new Map<string, string>();
    const created: string[] = [];
    const errors: string[] = [];

    // Create items grouped by their groupName path
    for (const item of budget.lineItems) {
      try {
        // Ensure the group hierarchy exists
        const groupId = await ensureGroupPath(
          jobId,
          item.groupName,
          item.groupDescription,
          groupCache,
          existingGroups
        );

        // Create the cost item in the group
        const itemId = await createCostItem(jobId, groupId, item);
        created.push(itemId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to create "${item.name}": ${msg}`);
        console.error(`Error creating budget item "${item.name}":`, err);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      createdCount: created.length,
      totalItems: budget.lineItems.length,
      errors,
      groupsCreated: groupCache.size,
    });
  } catch (err) {
    console.error('Budget creation error:', err);
    const errorMsg = err instanceof Error ? err.message : 'Budget creation failed';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

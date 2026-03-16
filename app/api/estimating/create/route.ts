// @ts-nocheck
// ============================================================
// POST /api/estimating/create — Create Budget in JobTread
// Takes an approved budget proposal and creates groups + items
// in the actual JobTread job via PAVE API
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

// -- Create a cost group in a job --
async function createCostGroup(
  jobId: string,
  name: string,
  description: string,
  parentGroupId?: string
): Promise<string> {
  const input: Record<string, unknown> = {
    jobId,
    name,
    description: description || undefined,
  };
  if (parentGroupId) {
    input.parentCostGroupId = parentGroupId;
  }

  const result = await pave({
    createCostGroup: {
      $: { input },
      id: {},
      name: {},
    },
  });

  const groupId = result?.createCostGroup?.id;
  if (!groupId) throw new Error(`Failed to create cost group: ${name}`);
  return groupId;
}

// -- Create a cost item in a job (within a group) --
async function createCostItem(
  jobId: string,
  costGroupId: string,
  item: BudgetLineItem
): Promise<string> {
  const input: Record<string, unknown> = {
    jobId,
    costGroupId,
    name: item.name,
    description: item.description || undefined,
    quantity: item.quantity,
    unitCost: item.unitCost,
    unitPrice: item.unitPrice,
  };

  if (item.costCodeId) input.costCodeId = item.costCodeId;
  if (item.costTypeId) input.costTypeId = item.costTypeId;
  if (item.unitId) input.unitId = item.unitId;
  if (item.organizationCostItemId) input.organizationCostItemId = item.organizationCostItemId;

  const result = await pave({
    createCostItem: {
      $: { input },
      id: {},
      name: {},
    },
  });

  const itemId = result?.createCostItem?.id;
  if (!itemId) throw new Error(`Failed to create cost item: ${item.name}`);
  return itemId;
}

// -- Find or create a group by path (handles nesting) --
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

    // Create this segment
    const isLeaf = i === parts.length - 1;
    const desc = isLeaf ? groupDescription : '';
    const groupId = await createCostGroup(jobId, parts[i], desc, parentId);
    groupCache.set(subPath, groupId);
    parentId = groupId;
  }

  return parentId!;
}

// -- Fetch existing groups for the job --
async function getExistingGroups(jobId: string): Promise<Map<string, string>> {
  const result = await pave({
    job: {
      $: { id: jobId },
      costGroups: {
        $: { size: 500 },
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

  const groups = result?.job?.costGroups?.nodes || [];
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

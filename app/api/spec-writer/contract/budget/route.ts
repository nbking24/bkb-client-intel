import { NextRequest, NextResponse } from 'next/server';
import { getCostItemsForJob, getCostGroupOrder, getJob, JTCostItem } from '../../../../lib/jobtread';

interface BudgetCostItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
}

interface BudgetCostGroup {
  id: string;
  name: string;
  description: string;
  costItems: BudgetCostItem[];
}

interface BudgetSection {
  id: string;
  name: string;
  costGroups: BudgetCostGroup[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    // Fetch job info
    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Fetch all cost items and cost group ordering in parallel
    const [allItems, groupOrder] = await Promise.all([
      getCostItemsForJob(jobId, 500),
      getCostGroupOrder(jobId),
    ]);

    if (!allItems || allItems.length === 0) {
      return NextResponse.json(
        { error: 'No cost items found for this job' },
        { status: 404 }
      );
    }

    // Build sections from cost items, using their group hierarchy.
    // Each cost item has:
    //   costGroup = the group that directly contains it (leaf level, has description)
    //   costGroup.parentCostGroup = the section/area above it
    //
    // IMPORTANT: Jobs can have multiple estimates/proposals in JobTread, each with
    // their own copy of the cost group hierarchy (different IDs but same names).
    // We deduplicate by keying on GROUP NAME + PARENT NAME instead of IDs.
    // This merges items from duplicate groups across estimates into a single entry.

    // Group items by their direct costGroup, keyed by name to deduplicate across estimates
    const groupMap = new Map<string, {
      id: string;
      name: string;
      description: string;
      parentId: string;
      parentName: string;
      items: JTCostItem[];
      seenItemNames: Set<string>;
    }>();

    for (const item of allItems) {
      const groupName = item.costGroup?.name || 'Ungrouped';
      const groupDesc = item.costGroup?.description || '';
      const groupId = item.costGroup?.id || 'ungrouped';
      const parentId = item.costGroup?.parentCostGroup?.id || 'general';
      const parentName = item.costGroup?.parentCostGroup?.name || 'General';

      // Key by parent name + group name to merge duplicates across estimates
      const dedupeKey = `${parentName}|||${groupName}`;

      if (!groupMap.has(dedupeKey)) {
        groupMap.set(dedupeKey, {
          id: groupId,
          name: groupName,
          description: groupDesc,
          parentId,
          parentName,
          items: [],
          seenItemNames: new Set(),
        });
      }

      // Use longest description found (some estimates may have more detail)
      const existing = groupMap.get(dedupeKey)!;
      if (groupDesc.length > existing.description.length) {
        existing.description = groupDesc;
        existing.id = groupId; // prefer the ID with the best description
      }

      // Deduplicate cost items by name within the merged group
      const itemKey = item.name;
      if (!existing.seenItemNames.has(itemKey)) {
        existing.seenItemNames.add(itemKey);
        existing.items.push(item);
      }
    }

    // Group the cost groups by their parent section name (also deduplicated by name)
    const sectionMap = new Map<string, {
      id: string;
      name: string;
      groups: Array<{
        id: string;
        name: string;
        description: string;
        parentId: string;
        parentName: string;
        items: JTCostItem[];
      }>;
    }>();

    const groupList = Array.from(groupMap.values());
    for (const group of groupList) {
      const sectionKey = group.parentName;
      if (!sectionMap.has(sectionKey)) {
        sectionMap.set(sectionKey, {
          id: group.parentId,
          name: group.parentName,
          groups: [],
        });
      }
      sectionMap.get(sectionKey)!.groups.push(group);
    }

    // Build sort-order lookup from the cost group hierarchy
    // Maps group name -> sortOrder, and parent name -> min sortOrder of children
    const groupSortMap = new Map<string, number>();
    const parentSortMap = new Map<string, number>();

    for (const g of groupOrder) {
      const parentName = g.parentName || 'General';
      const sortVal = g.sortOrder ?? 999999;

      // Track the sort order per group name under its parent
      const key = `${parentName}|||${g.name}`;
      if (!groupSortMap.has(key) || sortVal < groupSortMap.get(key)!) {
        groupSortMap.set(key, sortVal);
      }

      // Track parent sort order: use parent's own sortOrder if available,
      // otherwise use the minimum sortOrder among its children
      const parentSort = g.parentSortOrder ?? sortVal;
      if (!parentSortMap.has(parentName) || parentSort < parentSortMap.get(parentName)!) {
        parentSortMap.set(parentName, parentSort);
      }
    }

    // Sort sections by their sort order
    const sectionList = Array.from(sectionMap.values());
    sectionList.sort((a, b) => {
      const aSort = parentSortMap.get(a.name) ?? 999999;
      const bSort = parentSortMap.get(b.name) ?? 999999;
      return aSort - bSort;
    });

    // Convert to BudgetSection format, sorting groups within each section
    const budgetSections: BudgetSection[] = sectionList.map((section) => {
      // Sort groups within this section
      const sortedGroups = [...section.groups].sort((a, b) => {
        const aKey = `${section.name}|||${a.name}`;
        const bKey = `${section.name}|||${b.name}`;
        const aSort = groupSortMap.get(aKey) ?? 999999;
        const bSort = groupSortMap.get(bKey) ?? 999999;
        return aSort - bSort;
      });

      return {
        id: section.id,
        name: section.name,
        costGroups: sortedGroups.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          costItems: g.items.map((ci) => ({
            id: ci.id,
            name: ci.name,
            description: ci.description || '',
            quantity: ci.quantity,
            unitCost: ci.unitCost,
            unitPrice: ci.unitPrice,
          })),
        })),
      };
    });

    return NextResponse.json({
      jobId,
      jobName: job.name || '',
      sections: budgetSections,
      totalCostGroups: budgetSections.reduce((sum, s) => sum + s.costGroups.length, 0),
    });
  } catch (err: any) {
    console.error('Contract budget API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

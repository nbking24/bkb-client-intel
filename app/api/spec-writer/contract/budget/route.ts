import { NextRequest, NextResponse } from 'next/server';
import { getCostItemsForJob, getJob, JTCostItem } from '../../../../lib/jobtread';

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

    // Fetch all cost items with full hierarchy (costGroup + parentCostGroup)
    // This uses the same paginated PAVE query that works for the project-details agent
    const allItems = await getCostItemsForJob(jobId, 500);

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
    // This automatically adapts to any depth because we use the cost item's
    // direct parent group, regardless of how many levels deep it is.
    // The visibility toggle in JobTread controls which level has items —
    // we just follow where the items actually are.

    // Group items by their direct costGroup
    const groupMap = new Map<string, {
      id: string;
      name: string;
      description: string;
      parentId: string;
      parentName: string;
      items: JTCostItem[];
    }>();

    for (const item of allItems) {
      const groupId = item.costGroup?.id || 'ungrouped';
      const groupName = item.costGroup?.name || 'Ungrouped';
      const groupDesc = item.costGroup?.description || '';
      const parentId = item.costGroup?.parentCostGroup?.id || 'general';
      const parentName = item.costGroup?.parentCostGroup?.name || 'General';

      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, {
          id: groupId,
          name: groupName,
          description: groupDesc,
          parentId,
          parentName,
          items: [],
        });
      }
      groupMap.get(groupId)!.items.push(item);
    }

    // Group the cost groups by their parent (section/area)
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
      if (!sectionMap.has(group.parentId)) {
        sectionMap.set(group.parentId, {
          id: group.parentId,
          name: group.parentName,
          groups: [],
        });
      }
      sectionMap.get(group.parentId)!.groups.push(group);
    }

    // Convert to BudgetSection format
    const sectionList = Array.from(sectionMap.values());
    const budgetSections: BudgetSection[] = sectionList.map((section) => ({
      id: section.id,
      name: section.name,
      costGroups: section.groups.map((g) => ({
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
    }));

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

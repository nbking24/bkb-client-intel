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

/**
 * Given the full group hierarchy, build a map from group ID -> full ancestor path.
 * This handles arbitrarily deep nesting (3, 4, 5+ levels).
 *
 * Returns a map: groupId -> [root, child, grandchild, ..., self]
 * Each entry has { id, name, sortOrder }
 */
function buildAncestryMap(groupOrder: Array<{
  id: string;
  name: string;
  sortOrder: number | null;
  parentId: string | null;
  parentName: string | null;
}>) {
  // Build parent lookup: id -> group info
  const byId = new Map<string, { id: string; name: string; sortOrder: number | null; parentId: string | null }>();
  for (const g of groupOrder) {
    byId.set(g.id, g);
  }

  // For each group, walk up to the root to build the full path
  const ancestryCache = new Map<string, Array<{ id: string; name: string; sortOrder: number | null }>>();

  function getAncestry(groupId: string): Array<{ id: string; name: string; sortOrder: number | null }> {
    if (ancestryCache.has(groupId)) return ancestryCache.get(groupId)!;

    const g = byId.get(groupId);
    if (!g) return [];

    if (!g.parentId) {
      // Root group
      const path = [{ id: g.id, name: g.name, sortOrder: g.sortOrder }];
      ancestryCache.set(groupId, path);
      return path;
    }

    // Recurse to parent
    const parentPath = getAncestry(g.parentId);
    const path = [...parentPath, { id: g.id, name: g.name, sortOrder: g.sortOrder }];
    ancestryCache.set(groupId, path);
    return path;
  }

  // Build ancestry for all groups
  for (const g of groupOrder) {
    getAncestry(g.id);
  }

  return ancestryCache;
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

    // Build ancestry map from the full group hierarchy
    // This gives us the complete path from root for every group,
    // handling 3+, 4+, etc. levels of nesting correctly.
    const ancestryMap = buildAncestryMap(groupOrder);

    // Also build a name-based ancestry lookup since cost items from different
    // estimates may have different IDs for the same named group
    const nameToAncestry = new Map<string, Array<{ id: string; name: string; sortOrder: number | null }>>();
    const ancestryEntries = Array.from(ancestryMap.entries());
    for (const [id, path] of ancestryEntries) {
      const g = groupOrder.find(go => go.id === id);
      if (g) {
        // Key by name + parentName so we can look up by the info available on cost items
        const parentName = g.parentId ? (groupOrder.find(go => go.id === g.parentId)?.name || '') : '';
        const key = `${parentName}|||${g.name}`;
        if (!nameToAncestry.has(key)) {
          nameToAncestry.set(key, path);
        }
      }
    }

    // For each cost item, determine its section (top-level ancestor) and
    // its display group (the leaf group that directly contains it).
    //
    // The spec writer UI uses 2 levels: Section > Group
    // For a path like [Scope of Work, Addition & Exterior, 04 Framing, Framing Specifications]:
    //   Section = "Scope of Work" (root)
    //   Group label = full sub-path: "Addition & Exterior > 04 Framing > Framing Specifications"
    //   But that's too verbose. Instead, we use the LAST TWO levels:
    //   Section = parent of leaf = "04 Framing"
    //   Group = leaf = "Framing Specifications"
    //
    // Actually, looking at how the spec writer UI renders this, each cost group
    // shown in the list IS the direct group containing cost items. The "section"
    // is used to organize them into collapsible categories.
    //
    // The best approach: use the SECOND level from root as the section
    // (e.g., "Addition & Exterior"), and the leaf group as the group name.
    // If there are only 1-2 levels, use the root as section.

    // Build grouping for each cost item
    const groupMap = new Map<string, {
      id: string;
      name: string;
      description: string;
      sectionName: string;
      sectionId: string;
      sectionSort: number;
      groupSort: number;
      items: JTCostItem[];
      seenItemNames: Set<string>;
    }>();

    for (const item of allItems) {
      const groupName = item.costGroup?.name || 'Ungrouped';
      const groupDesc = item.costGroup?.description || '';
      const groupId = item.costGroup?.id || 'ungrouped';
      const immediateParentName = item.costGroup?.parentCostGroup?.name || '';

      // Try to find the full ancestry for this group
      let ancestry: Array<{ id: string; name: string; sortOrder: number | null }> = [];

      // First try by ID
      if (groupId && ancestryMap.has(groupId)) {
        ancestry = ancestryMap.get(groupId)!;
      } else {
        // Fall back to name-based lookup
        const nameKey = `${immediateParentName}|||${groupName}`;
        if (nameToAncestry.has(nameKey)) {
          ancestry = nameToAncestry.get(nameKey)!;
        }
      }

      // Determine section and group from ancestry
      let sectionName: string;
      let sectionId: string;
      let sectionSort: number;
      let groupSort: number;

      if (ancestry.length === 0) {
        // No ancestry found, use immediate parent as section
        sectionName = immediateParentName || 'General';
        sectionId = item.costGroup?.parentCostGroup?.id || 'general';
        sectionSort = 999999;
        groupSort = 999999;
      } else if (ancestry.length === 1) {
        // The group itself is a root — use "General" as section
        sectionName = 'General';
        sectionId = 'general';
        sectionSort = 0;
        groupSort = ancestry[0].sortOrder ?? 999999;
      } else if (ancestry.length === 2) {
        // 2 levels: parent > group (standard case)
        sectionName = ancestry[0].name;
        sectionId = ancestry[0].id;
        sectionSort = ancestry[0].sortOrder ?? 999999;
        groupSort = ancestry[1].sortOrder ?? 999999;
      } else {
        // 3+ levels: use the top-level ancestor as section
        // The leaf is the group with cost items
        // All intermediate levels help us sort but we flatten them
        sectionName = ancestry[0].name;
        sectionId = ancestry[0].id;
        sectionSort = ancestry[0].sortOrder ?? 999999;
        // Use the leaf's sortOrder for group sorting
        groupSort = ancestry[ancestry.length - 1].sortOrder ?? 999999;
      }

      // Deduplicate by section + group name (across estimates)
      const dedupeKey = `${sectionName}|||${groupName}`;

      if (!groupMap.has(dedupeKey)) {
        groupMap.set(dedupeKey, {
          id: groupId,
          name: groupName,
          description: groupDesc,
          sectionName,
          sectionId,
          sectionSort,
          groupSort,
          items: [],
          seenItemNames: new Set(),
        });
      }

      const existing = groupMap.get(dedupeKey)!;
      // Use longest description found
      if (groupDesc.length > existing.description.length) {
        existing.description = groupDesc;
        existing.id = groupId;
      }
      // Use lowest sort orders found
      if (sectionSort < existing.sectionSort) {
        existing.sectionSort = sectionSort;
        existing.sectionId = sectionId;
      }
      if (groupSort < existing.groupSort) {
        existing.groupSort = groupSort;
      }

      // Deduplicate cost items by name
      const itemKey = item.name;
      if (!existing.seenItemNames.has(itemKey)) {
        existing.seenItemNames.add(itemKey);
        existing.items.push(item);
      }
    }

    // Group into sections
    const sectionMap = new Map<string, {
      id: string;
      name: string;
      sortOrder: number;
      groups: Array<typeof groupMap extends Map<string, infer V> ? V : never>;
    }>();

    for (const group of Array.from(groupMap.values())) {
      if (!sectionMap.has(group.sectionName)) {
        sectionMap.set(group.sectionName, {
          id: group.sectionId,
          name: group.sectionName,
          sortOrder: group.sectionSort,
          groups: [],
        });
      }
      const section = sectionMap.get(group.sectionName)!;
      if (group.sectionSort < section.sortOrder) {
        section.sortOrder = group.sectionSort;
      }
      section.groups.push(group);
    }

    // Sort sections by their sort order
    const sectionList = Array.from(sectionMap.values());
    sectionList.sort((a, b) => a.sortOrder - b.sortOrder);

    // Convert to BudgetSection format, sorting groups within each section
    const budgetSections: BudgetSection[] = sectionList.map((section) => {
      const sortedGroups = [...section.groups].sort((a, b) => a.groupSort - b.groupSort);

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

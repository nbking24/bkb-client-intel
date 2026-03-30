// @ts-nocheck
// TEMPORARY DEBUG ENDPOINT — remove after CO tracker is working
import { NextRequest, NextResponse } from 'next/server';
import { pave, getDocumentStatusesForJob } from '@/app/lib/jobtread';

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId') || '22P5je8QXjbU'; // Default to Zajick

  try {
    const [groupData, docs] = await Promise.all([
      pave({
        job: {
          $: { id: jobId },
          costGroups: {
            $: { size: 200 },
            nodes: {
              id: {},
              name: {},
              parentCostGroup: { id: {}, name: {} },
            },
          },
        },
      }),
      getDocumentStatusesForJob(jobId),
    ]);

    const groups = (groupData as any)?.job?.costGroups?.nodes || [];

    // Find CO root groups
    const coRootIds = new Set(
      groups
        .filter((g: any) => /change\s*order|🔁|post\s*pricing/i.test(g.name || ''))
        .map((g: any) => g.id)
    );

    // Build parent→children map
    const childrenOf = new Map<string, any[]>();
    for (const g of groups) {
      const pid = g.parentCostGroup?.id;
      if (pid) {
        if (!childrenOf.has(pid)) childrenOf.set(pid, []);
        childrenOf.get(pid)!.push(g);
      }
    }

    // Recursively find CO groups
    const budgetCOs: Array<{ id: string; name: string; path: string }> = [];
    const visited = new Set<string>();

    function findCOGroups(parentId: string, depth: number, path: string) {
      const children = childrenOf.get(parentId) || [];
      for (const child of children) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        const grandChildren = childrenOf.get(child.id) || [];
        const childPath = path + ' > ' + child.name;

        const isStructural = /^(client|owner|bkb)\s+requested$|^🟢\s*approved$|^🔴\s*declined$|^scope\s*of\s*work$/i.test(child.name?.trim() || '');

        if (isStructural && grandChildren.length > 0) {
          findCOGroups(child.id, depth + 1, childPath);
        } else if (grandChildren.length > 0 && depth < 3) {
          budgetCOs.push({ id: child.id, name: child.name, path: childPath });
        } else {
          budgetCOs.push({ id: child.id, name: child.name, path: childPath });
        }
      }
    }

    for (const rootId of coRootIds) {
      const rootName = groups.find((g: any) => g.id === rootId)?.name || 'unknown';
      findCOGroups(rootId, 0, rootName);
    }

    // CO documents
    const coDocuments = docs.filter((d: any) =>
      d.type === 'customerOrder' && /change\s*order|^co\b/i.test(d.name || '')
    );

    return NextResponse.json({
      jobId,
      totalGroups: groups.length,
      coRoots: groups.filter((g: any) => coRootIds.has(g.id)).map((g: any) => ({ id: g.id, name: g.name })),
      budgetCOs,
      coDocuments: coDocuments.map((d: any) => ({ id: d.id, name: d.name, number: d.number, status: d.status })),
      allGroupNames: groups.map((g: any) => ({ id: g.id, name: g.name, parentId: g.parentCostGroup?.id, parentName: g.parentCostGroup?.name })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Unknown error', stack: err?.stack }, { status: 500 });
  }
}

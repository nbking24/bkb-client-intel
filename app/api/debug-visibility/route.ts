import { NextResponse } from 'next/server';

const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';

async function pave(query: any) {
  const res = await fetch('https://api.jobtread.com/pave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { $: { grantKey: JT_KEY() }, ...query } }),
  });
  return res.json();
}

export async function GET() {
  const jobId = '22PEn8bysN7v'; // Wooley job

  // Test what fields exist on costGroups
  // Try more field names + try looking at the actual group structure
  const fieldsToTest = [
    'isIncluded',
    'included',
    'specification',
    'specVisible',
    'status',
    'type',
  ];

  const results: Record<string, any> = {};

  // First get groups with known fields
  const baseData = await pave({
    job: {
      $: { id: jobId },
      costGroups: {
        $: { size: 5 },
        nodes: {
          id: {},
          name: {},
          description: {},
          parentCostGroup: { id: {}, name: {} },
        },
      },
    },
  });
  results.baseGroups = (baseData as any)?.job?.costGroups?.nodes?.slice(0, 3).map((n: any) => ({
    name: n.name,
    parentName: n.parentCostGroup?.name,
  }));

  // Test each field individually
  for (const field of fieldsToTest) {
    try {
      const res = await fetch('https://api.jobtread.com/pave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: {
            $: { grantKey: JT_KEY() },
            job: {
              $: { id: jobId },
              costGroups: {
                $: { size: 3 },
                nodes: {
                  id: {},
                  name: {},
                  [field]: {},
                },
              },
            },
          },
        }),
      });
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        const nodes = data?.job?.costGroups?.nodes || [];
        results[field] = {
          success: true,
          sample: nodes.slice(0, 3).map((n: any) => ({ name: n.name, [field]: n[field] })),
        };
      } catch {
        results[field] = { success: false, rawResponse: text.slice(0, 200) };
      }
    } catch (err: any) {
      results[field] = { success: false, error: err.message };
    }
  }

  // Also: get full hierarchy for the Wooley job to understand levels
  const hierarchyData = await pave({
    job: {
      $: { id: jobId },
      costGroups: {
        $: { size: 50 },
        nodes: {
          id: {},
          name: {},
          description: {},
          parentCostGroup: { id: {}, name: {} },
        },
      },
    },
  });

  const allNodes = (hierarchyData as any)?.job?.costGroups?.nodes || [];

  // Build tree
  const scopeOfWork = allNodes.find((n: any) => n.name?.includes('Scope of Work'));
  const level2 = allNodes.filter((n: any) => n.parentCostGroup?.id === scopeOfWork?.id);
  const hierarchy: any = {};
  for (const l2 of level2) {
    const l3 = allNodes.filter((n: any) => n.parentCostGroup?.id === l2.id);
    hierarchy[l2.name] = l3.map((l3n: any) => ({
      name: l3n.name,
      description: l3n.description?.slice(0, 100) || '(empty)',
      children: allNodes.filter((n: any) => n.parentCostGroup?.id === l3n.id).map((l4: any) => l4.name),
    }));
  }

  results.hierarchy = hierarchy;

  // Check which groups have isSpecification=true items
  // This tells us which level the visibility toggle is set at
  const specData = await pave({
    job: {
      $: { id: jobId },
      costItems: {
        $: { size: 200 },
        nodes: {
          id: {},
          name: {},
          isSpecification: {},
          costGroup: { id: {}, name: {}, parentCostGroup: { id: {}, name: {}, parentCostGroup: { id: {}, name: {} } } },
        },
      },
    },
  });

  const allCostItems2 = (specData as any)?.job?.costItems?.nodes || [];
  const specItems = allCostItems2.filter((n: any) => n.isSpecification === true);
  results.totalCostItems = allCostItems2.length;
  results.sampleItems = allCostItems2.slice(0, 5).map((n: any) => ({
    name: n.name,
    isSpec: n.isSpecification,
    group: n.costGroup?.name,
    parent: n.costGroup?.parentCostGroup?.name,
  }));

  // Group spec items by their cost group name and show hierarchy
  const specGroupMap = new Map<string, { groupName: string; parentName: string; grandparentName: string; count: number }>();
  for (const item of specItems) {
    const gName = item.costGroup?.name || '?';
    const pName = item.costGroup?.parentCostGroup?.name || '?';
    const gpName = item.costGroup?.parentCostGroup?.parentCostGroup?.name || '?';
    const key = gName;
    if (!specGroupMap.has(key)) {
      specGroupMap.set(key, { groupName: gName, parentName: pName, grandparentName: gpName, count: 0 });
    }
    specGroupMap.get(key)!.count++;
  }

  results.specGroups = Array.from(specGroupMap.values()).sort((a, b) => a.parentName.localeCompare(b.parentName));
  results.totalSpecItems = specItems.length;

  return NextResponse.json(results);
}

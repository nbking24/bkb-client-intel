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
  const fieldsToTest = [
    'isSpecification',
    'isVisible',
    'visibility',
    'showOnSpecifications',
    'hidden',
    'specificationVisibility',
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
      const data = await pave({
        job: {
          $: { id: jobId },
          costGroups: {
            $: { size: 5 },
            nodes: {
              id: {},
              name: {},
              [field]: {},
            },
          },
        },
      });
      const nodes = (data as any)?.job?.costGroups?.nodes || [];
      results[field] = {
        success: true,
        sample: nodes.slice(0, 5).map((n: any) => ({ name: n.name, [field]: n[field] })),
      };
    } catch (err: any) {
      results[field] = { success: false, error: err.message };
    }
  }

  return NextResponse.json(results);
}

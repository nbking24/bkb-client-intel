// @ts-nocheck
// Diagnostic: verify Pave API with {query:...} wrapper
import { NextRequest, NextResponse } from 'next/server';

const JT_URL = 'https://api.jobtread.com/pave';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const apiKey = url.searchParams.get('key') || process.env.JOBTREAD_API_KEY || '';
  const jobId = url.searchParams.get('jobId') || '22P5qEW5VPq5'; // Edwards Pool House default
  const diagnostics: Record<string, unknown> = { timestamp: new Date().toISOString() };

  // Get ALL cost items with files, then filter for spec items with files
  let allItems: any[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 5; page++) {
    const pageParams: Record<string, unknown> = { size: 100 };
    if (nextPage) pageParams.page = nextPage;

    const query = {
      $: { grantKey: apiKey },
      job: {
        $: { id: jobId },
        costItems: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            isSpecification: {},
            costGroup: { id: {}, name: {}, parentCostGroup: { id: {}, name: {} } },
            files: { nodes: { id: {}, name: {}, url: {} } },
          },
        },
      },
    };

    try {
      const r = await fetch(JT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await r.json();
      const costItemPage = data?.job?.costItems;
      const nodes = costItemPage?.nodes || [];
      allItems = allItems.concat(nodes);
      nextPage = costItemPage?.nextPage || null;
      if (!nextPage || nodes.length < 100) break;
    } catch (e: any) {
      diagnostics.error = e.message;
      break;
    }
  }

  // Filter: isSpecification=true AND has files
  const specItems = allItems.filter((item: any) => item.isSpecification === true);
  const itemsWithFiles = specItems.filter((item: any) => item.files?.nodes?.length > 0);

  // Also find window-related items
  const windowItems = specItems.filter((item: any) => /window|e-series|door|trim/i.test(item.name));

  diagnostics.summary = {
    totalItems: allItems.length,
    specItems: specItems.length,
    itemsWithFiles: itemsWithFiles.length,
    windowItems: windowItems.length,
  };

  diagnostics.itemsWithFiles = itemsWithFiles.map((item: any) => ({
    name: item.name,
    area: item.costGroup?.parentCostGroup?.name,
    group: item.costGroup?.name,
    files: item.files?.nodes || [],
  }));

  diagnostics.windowItems = windowItems.map((item: any) => ({
    name: item.name,
    area: item.costGroup?.parentCostGroup?.name,
    group: item.costGroup?.name,
    files: item.files?.nodes || [],
  }));

  return NextResponse.json(diagnostics, { headers: { 'Cache-Control': 'no-store' } });
}

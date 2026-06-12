import { NextRequest, NextResponse } from 'next/server';
import {
  getCostGroupOrder,
  getJob,
  JT_COST_ITEM_FIELD_IDS,
  pave,
} from '../../../../lib/jobtread';

export const dynamic = 'force-dynamic';

/**
 * Trade Specs — budget loader.
 *
 * Returns the job's cost group tree plus every Estimating (budget) cost
 * item annotated with:
 *  - approvedPrice: sum of prices on approved customerOrder documents
 *  - documentVerbiage: current value of the Document Verbiage custom field
 *  - isSpecification flag
 *
 * The client uses approvedPrice > 0 && documentVerbiage === '' to decide
 * which items are eligible for a trade-spec rewrite.
 */

const PAGE_SIZE = 8; // tiny pages: nested documentCostItems + customFieldValues are expensive (JT 413s)
const MAX_PAGES = 100; // 8 x 100 = 800 items max

async function fetchCostItems(jobId: string): Promise<any[]> {
  let all: any[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            quantity: {},
            unitPrice: {},
            price: {},
            isSpecification: {},
            unit: { name: {} },
            costCode: { id: {}, name: {} },
            costType: { id: {}, name: {} },
            costGroup: { id: {}, name: {} },
            document: { id: {} },
            customFieldValues: {
              $: { size: 10 },
              nodes: { value: {}, customField: { id: {} } },
            },
            documentCostItems: {
              $: { size: 15 },
              nodes: { price: {}, document: { type: {}, status: {} } },
            },
          },
        },
      },
    });

    const pageData = (data as any)?.job?.costItems;
    const nodes = pageData?.nodes || [];
    all = all.concat(nodes);
    nextPage = pageData?.nextPage || null;
    if (!nextPage || nodes.length < PAGE_SIZE) break;
  }

  return all;
}

export async function POST(request: NextRequest) {
  try {
    const { jobId } = await request.json();
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const [allItems, groupOrder] = await Promise.all([
      fetchCostItems(jobId),
      getCostGroupOrder(jobId),
    ]);

    // Estimating budget items only (document == null). Items attached to
    // proposals/invoices are billing artifacts, not budget lines.
    const budgetItems = allItems.filter((it) => !it.document);

    const items = budgetItems.map((it) => {
      const cfvs = it.customFieldValues?.nodes || [];
      const verbiage = cfvs.find(
        (n: any) => n.customField?.id === JT_COST_ITEM_FIELD_IDS.DOCUMENT_VERBIAGE
      );
      const dcis = it.documentCostItems?.nodes || [];
      const approvedPrice = dcis
        .filter((d: any) => d.document?.type === 'customerOrder' && d.document?.status === 'approved')
        .reduce((sum: number, d: any) => sum + (Number(d.price) || 0), 0);

      return {
        id: it.id,
        name: it.name || '',
        description: it.description || '',
        quantity: it.quantity ?? null,
        unitName: it.unit?.name || '',
        unitPrice: it.unitPrice ?? null,
        costCodeName: it.costCode?.name || '',
        costTypeName: it.costType?.name || '',
        costGroupId: it.costGroup?.id || null,
        isSpecification: !!it.isSpecification,
        approvedPrice,
        documentVerbiage: (verbiage?.value as string) || '',
      };
    });

    return NextResponse.json({
      jobId,
      jobName: (job as any).name || '',
      groups: groupOrder.map((g) => ({
        id: g.id,
        name: g.name,
        parentId: g.parentId,
        sortOrder: g.sortOrder,
      })),
      items,
    });
  } catch (err: any) {
    console.error('Trade specs items API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

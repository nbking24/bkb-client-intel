// @ts-nocheck
/**
 * GET /api/dashboard/job-costing/diag-doc?docId=XXX
 *
 * Returns every cost item on a single JT document with id, name, cost,
 * costCode (number+name), and linked jobCostItem id+name+costCode. Used
 * to trace why a known budget item isn't being picked up by the breakdown
 * pull on the Job Costing detail.
 *
 * Auth: CRON_SECRET via Bearer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pave } from '../../../../lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const docId = req.nextUrl.searchParams.get('docId');
  if (!docId) {
    return NextResponse.json({ error: 'docId required' }, { status: 400 });
  }
  try {
    // PAVE caps page size at 100. Walk pages until exhausted.
    const allItems: any[] = [];
    let docMeta: any = null;
    let nextPage: string | null = null;
    for (let page = 0; page < 50; page++) {
      const params: any = { size: 100 };
      if (nextPage) params.page = nextPage;
      const data = await pave({
        document: {
          $: { id: docId },
          id: {}, name: {}, type: {}, status: {}, number: {},
          cost: {}, price: {},
          costItems: {
            $: params,
            nextPage: {},
            nodes: {
              id: {}, name: {}, cost: {}, price: {}, quantity: {},
              isSelected: {},
              costCode: { id: {}, number: {}, name: {} },
              costType: { id: {}, name: {} },
              jobCostItem: {
                id: {}, name: {},
                costCode: { number: {}, name: {} },
              },
              costGroup: { id: {}, name: {}, isSelected: {}, parentCostGroup: { id: {}, name: {}, isSelected: {} } },
            },
          },
        },
      });
      const doc = (data as any)?.document;
      if (!docMeta) {
        docMeta = { id: doc?.id, name: doc?.name, type: doc?.type, status: doc?.status, number: doc?.number, cost: doc?.cost, price: doc?.price };
      }
      const items = doc?.costItems?.nodes || [];
      allItems.push(...items);
      nextPage = doc?.costItems?.nextPage || null;
      if (!nextPage || items.length < 100) break;
    }
    return NextResponse.json({ document: docMeta, totalItems: allItems.length, items: allItems });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

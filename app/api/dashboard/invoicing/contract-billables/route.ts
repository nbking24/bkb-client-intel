// @ts-nocheck
/**
 * GET /api/dashboard/invoicing/contract-billables?jobId=XXX
 *
 * Returns the CC23 vendor bill line items that contribute to a fixed-
 * price (contract) job's "uninvoiced billable items" total. Powers the
 * detail modal launched from clicking the Billable stat on the
 * contract job card.
 *
 * View-only. The dashboard's contract-side uninvoicedBillableAmount is
 *   sum(CC23 bill line costs) - sum(CC23 invoice line costs)
 * computed job-level (not per-line FIFO). We surface the bill lines on
 * the bill side and the invoice lines on the invoice side so the
 * operator can audit both sides of that subtraction without bouncing
 * into JT.
 *
 * No exclusion concept here yet - the cost-plus "Manage bills" feature
 * lets the operator drop pre-Hub bills from the unbilled total; this
 * endpoint is the contract analogue but read-only for now.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pave } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const BILLABLE_COST_CODE_NUMBER = '23';
const BILLABLE_COST_TYPE_NAMES = ['Materials', 'Subcontractor', 'Other'];

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  try {
    // Pull doc metadata (with vendor name) and cost items in parallel
    // batches. Mirrors getDocumentCostItemsForJob's two-pass shape but
    // pulls only what the modal needs - keeps the response small.
    const DOCS_PAGE_SIZE = 50;
    type DocMeta = {
      id: string;
      type: string;
      status: string;
      number: string | null;
      issueDate: string | null;
      createdAt: string | null;
      accountName: string | null;
    };
    const docs: DocMeta[] = [];
    let nextPage: string | null = null;
    for (let page = 0; page < 20; page++) {
      const pageParams: Record<string, unknown> = { size: DOCS_PAGE_SIZE };
      if (nextPage) pageParams.page = nextPage;
      const data = await pave({
        job: {
          $: { id: jobId },
          documents: {
            $: pageParams,
            nextPage: {},
            nodes: {
              id: {}, type: {}, status: {}, number: {},
              issueDate: {}, createdAt: {},
              account: { name: {} },
            },
          },
        },
      });
      const docsPage = (data as any)?.job?.documents;
      const rawNodes = (docsPage?.nodes || []) as any[];
      for (const n of rawNodes) {
        docs.push({
          id: n.id,
          type: n.type,
          status: n.status,
          number: n.number != null ? String(n.number) : null,
          issueDate: n.issueDate || null,
          createdAt: n.createdAt || null,
          accountName: n.account?.name || null,
        });
      }
      nextPage = docsPage?.nextPage || null;
      if (!nextPage || rawNodes.length < DOCS_PAGE_SIZE) break;
    }

    // Only docs that contribute either side of the calc - vendor bills
    // (not denied) and customer invoices (not draft). Saves a bunch of
    // PAVE calls on jobs with many bid requests / POs.
    const relevantDocs = docs.filter((d) =>
      (d.type === 'vendorBill' && d.status !== 'denied') ||
      (d.type === 'customerInvoice' && d.status !== 'draft')
    );

    // Pass 2: per-doc cost items, in parallel batches of 10.
    const BATCH = 10;
    const MAX_DOC_PAGES = 20;
    const all: Array<{
      doc: DocMeta;
      item: {
        id: string;
        name: string;
        description: string;
        cost: number;
        quantity: number;
        unitCost: number;
        costCodeNumber: string | null;
        costCodeName: string | null;
        costTypeName: string | null;
        // Budget item linkage for getEffectiveCostCodeNumber parity
        budgetItemCostCodeNumber: string | null;
      };
    }> = [];

    for (let i = 0; i < relevantDocs.length; i += BATCH) {
      const slice = relevantDocs.slice(i, i + BATCH);
      const sliceResults = await Promise.all(
        slice.map(async (doc) => {
          const docItems: any[] = [];
          let nextItemPage: string | null = null;
          for (let p = 0; p < MAX_DOC_PAGES; p++) {
            const itemParams: Record<string, unknown> = { size: 100 };
            if (nextItemPage) itemParams.page = nextItemPage;
            try {
              const data = await pave({
                document: {
                  $: { id: doc.id },
                  costItems: {
                    $: itemParams,
                    nextPage: {},
                    nodes: {
                      id: {}, name: {}, description: {},
                      cost: {}, quantity: {}, unitCost: {},
                      costCode: { number: {}, name: {} },
                      costType: { name: {} },
                      jobCostItem: { costCode: { number: {} } },
                    },
                  },
                },
              });
              const itemsPage = (data as any)?.document?.costItems;
              const nodes = itemsPage?.nodes || [];
              docItems.push(...nodes);
              nextItemPage = itemsPage?.nextPage || null;
              if (!nextItemPage || nodes.length < 100) break;
            } catch {
              break;
            }
          }
          return docItems.map((ci: any) => ({
            doc,
            item: {
              id: ci.id,
              name: ci.name || '',
              description: ci.description || '',
              cost: Number(ci.cost) || 0,
              quantity: Number(ci.quantity) || 0,
              unitCost: Number(ci.unitCost) || 0,
              costCodeNumber: ci.costCode?.number || null,
              costCodeName: ci.costCode?.name || null,
              costTypeName: ci.costType?.name || null,
              budgetItemCostCodeNumber: ci.jobCostItem?.costCode?.number || null,
            },
          }));
        }),
      );
      for (const r of sliceResults) all.push(...r);
    }

    // Apply the SAME filter the dashboard's invoicing-health module
    // uses: effective cost code (budget link preferred, line-level
    // fallback) == 23, AND the cost type is one of the billable
    // categories. Splits into bill lines (the source) and invoice
    // lines (the offset).
    const cc23Lines = all.filter(({ item }) => {
      const eff = item.budgetItemCostCodeNumber || item.costCodeNumber;
      if (eff !== BILLABLE_COST_CODE_NUMBER) return false;
      return BILLABLE_COST_TYPE_NAMES.includes(item.costTypeName || '');
    });

    const billLines = cc23Lines
      .filter(({ doc }) => doc.type === 'vendorBill')
      .map(({ doc, item }) => ({
        lineItemId: item.id,
        lineName: item.name || item.description || '(unnamed)',
        lineDescription: item.description,
        cost: item.cost,
        quantity: item.quantity,
        unitCost: item.unitCost,
        costCodeNumber: item.costCodeNumber,
        costTypeName: item.costTypeName,
        docId: doc.id,
        vendorName: doc.accountName || '',
        billNumber: doc.number || '',
        billStatus: doc.status,
        billDate: doc.issueDate || doc.createdAt || null,
      }))
      .sort((a, b) => (a.billDate || '').localeCompare(b.billDate || ''));

    const invoiceLines = cc23Lines
      .filter(({ doc }) => doc.type === 'customerInvoice')
      .map(({ doc, item }) => ({
        lineItemId: item.id,
        lineName: item.name || item.description || '(unnamed)',
        cost: item.cost,
        docId: doc.id,
        invoiceNumber: doc.number || '',
        invoiceStatus: doc.status,
        invoiceDate: doc.issueDate || doc.createdAt || null,
      }))
      .sort((a, b) => (a.invoiceDate || '').localeCompare(b.invoiceDate || ''));

    const totalBilled = billLines.reduce((s, l) => s + l.cost, 0);
    const totalInvoiced = invoiceLines.reduce((s, l) => s + l.cost, 0);
    const netUninvoiced = Math.max(0, totalBilled - totalInvoiced);

    return NextResponse.json({
      jobId,
      totalBilled,
      totalInvoiced,
      netUninvoiced,
      billLines,
      invoiceLines,
    });
  } catch (err: any) {
    console.error('[invoicing/contract-billables] error:', err?.message || err);
    return NextResponse.json(
      { error: err?.message || 'Failed to load billable items' },
      { status: 500 },
    );
  }
}

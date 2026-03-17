import { NextResponse } from 'next/server';
import { getCostItemsLightForJob, getDocumentCostItemsLightById, getDocumentStatusesForJob } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';

export async function GET() {
  const jobId = '22PEn8bysN7v'; // Wooley

  try {
    // Get all budget items
    const budgetItems = await getCostItemsLightForJob(jobId, 500);

    // Get document statuses
    const docStatuses = await getDocumentStatusesForJob(jobId);
    const approvedDocIds = new Set<string>();
    const approvedCustomerOrderIds: string[] = [];
    for (const doc of docStatuses) {
      if (doc.status === 'approved') {
        approvedDocIds.add(doc.id);
        if (doc.type === 'customerOrder') {
          approvedCustomerOrderIds.push(doc.id);
        }
      }
    }

    // Find all mirror items and show their document references
    const mirrorItems = budgetItems.filter((item: any) =>
      item.name?.toLowerCase().includes('mirror')
    );

    // Check which mirror items pass the approved doc filter
    const mirrorWithApprovedDoc = mirrorItems.filter((item: any) => {
      const docId = item.document?.id;
      return docId && approvedDocIds.has(docId);
    });

    // Get doc-level items from approved customer orders
    const docItemPromises = approvedCustomerOrderIds.map(docId => getDocumentCostItemsLightById(docId));
    const docItemArrays = await Promise.all(docItemPromises);

    // Find mirror items from doc-level queries
    const docMirrorItems: any[] = [];
    for (const items of docItemArrays) {
      for (const item of items) {
        if (item.name?.toLowerCase().includes('mirror')) {
          docMirrorItems.push(item);
        }
      }
    }

    return NextResponse.json({
      totalBudgetItems: budgetItems.length,
      approvedDocs: docStatuses.filter((d: any) => d.status === 'approved').map((d: any) => ({ id: d.id, name: d.name, type: d.type })),
      approvedCustomerOrderIds,
      mirrorItemsInBudget: mirrorItems.map((i: any) => ({
        id: i.id,
        name: i.name,
        status: i.status,
        vendor: i.vendor,
        internalNotes: i.internalNotes,
        costGroup: i.costGroup?.name,
        parentGroup: i.costGroup?.parentCostGroup?.name,
        documentId: i.document?.id,
        documentName: i.document?.name,
        documentType: i.document?.type,
        hasApprovedDoc: i.document?.id ? approvedDocIds.has(i.document.id) : false,
      })),
      mirrorWithApprovedDocCount: mirrorWithApprovedDoc.length,
      docLevelMirrorItems: docMirrorItems.map((i: any) => ({
        id: i.id,
        name: i.name,
        status: i.status,
        vendor: i.vendor,
        internalNotes: i.internalNotes,
        costGroup: i.costGroup?.name,
        isSelected: i.isSelected,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

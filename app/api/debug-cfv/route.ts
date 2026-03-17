import { NextResponse } from 'next/server';
import { getCostItemsLightForJob, getDocumentCostItemsLightById, getDocumentStatusesForJob } from '@/app/lib/jobtread';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId') || '22PEn8bysN7v';

  // 1. Get budget items (limit 200)
  const budgetItems = await getCostItemsLightForJob(jobId, 200);

  // 2. Get document statuses
  const docStatuses = await getDocumentStatusesForJob(jobId);
  const approvedDocs = docStatuses.filter((d: any) => d.status === 'approved' && d.type === 'customerOrder');

  // 3. Get document cost items
  const docItemPromises = approvedDocs.map((d: any) => getDocumentCostItemsLightById(d.id));
  const docItemArrays = await Promise.all(docItemPromises);

  // Find mirror items in budget
  const budgetMirror = budgetItems.filter((i: any) =>
    (i.name || '').toLowerCase().includes('mirror') ||
    (i.description || '').toLowerCase().includes('mirror')
  );

  // Find mirror items in doc-level queries
  const allDocItems = docItemArrays.flat();
  const docMirror = allDocItems.filter((i: any) =>
    (i.name || '').toLowerCase().includes('mirror') ||
    (i.description || '').toLowerCase().includes('mirror')
  );

  // Items with status from budget
  const budgetWithStatus = budgetItems.filter((i: any) => i.status);

  // Items with status from docs
  const docWithStatus = allDocItems.filter((i: any) => i.status);

  return NextResponse.json({
    budgetItemCount: budgetItems.length,
    budgetMirrorItems: budgetMirror.map((i: any) => ({
      id: i.id, name: i.name, status: i.status, vendor: i.vendor,
      internalNotes: i.internalNotes, costGroup: i.costGroup?.name, document: i.document,
    })),
    budgetItemsWithStatus: budgetWithStatus.length,
    approvedDocs: approvedDocs.map((d: any) => ({ id: d.id, name: d.name, type: d.type })),
    docItemCount: allDocItems.length,
    docMirrorItems: docMirror.map((i: any) => ({
      id: i.id, name: i.name, status: i.status, vendor: i.vendor,
      internalNotes: i.internalNotes, costGroup: i.costGroup?.name,
      isSelected: i.isSelected,
    })),
    docItemsWithStatus: docWithStatus.length,
    docStatusSamples: docWithStatus.slice(0, 5).map((i: any) => ({
      id: i.id, name: i.name, status: i.status, vendor: i.vendor,
    })),
  });
}

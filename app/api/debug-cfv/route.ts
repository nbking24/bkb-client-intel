import { NextResponse } from 'next/server';
import { getCostItemsLightForJob } from '@/app/lib/jobtread';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId') || '22PEn8bysN7v';

  const items = await getCostItemsLightForJob(jobId, 200);

  // Find items with "mirror" in name
  const mirrorItems = items.filter((i: any) =>
    (i.name || '').toLowerCase().includes('mirror') ||
    (i.description || '').toLowerCase().includes('mirror')
  );

  // Also find any items that have status set
  const itemsWithStatus = items.filter((i: any) => i.status);

  return NextResponse.json({
    totalItems: items.length,
    mirrorItems: mirrorItems.map((i: any) => ({
      id: i.id,
      name: i.name,
      status: i.status,
      vendor: i.vendor,
      internalNotes: i.internalNotes,
      costGroup: i.costGroup?.name,
      document: i.document,
    })),
    itemsWithStatusCount: itemsWithStatus.length,
    itemsWithStatus: itemsWithStatus.map((i: any) => ({
      id: i.id,
      name: i.name,
      status: i.status,
      vendor: i.vendor,
    })),
  });
}

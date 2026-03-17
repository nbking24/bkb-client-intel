import { NextResponse } from 'next/server';
import { getCostItemsLightForJob, getDocumentCostItemsLightById } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';

export async function GET() {
  const jobId = '22PEn8bysN7v'; // Wooley

  try {
    // Test 1: Try with limit=500 (current setting)
    let budgetItems: any[] = [];
    let budgetError: string | null = null;
    try {
      budgetItems = await getCostItemsLightForJob(jobId, 500);
    } catch (e: any) {
      budgetError = e.message || String(e);
    }

    // Test 2: Try with limit=50 (smaller)
    let budgetItems50: any[] = [];
    let budget50Error: string | null = null;
    try {
      budgetItems50 = await getCostItemsLightForJob(jobId, 50);
    } catch (e: any) {
      budget50Error = e.message || String(e);
    }

    // Find mirror items if we got any results
    const mirrorItems500 = budgetItems.filter((item: any) =>
      item.name?.toLowerCase().includes('mirror')
    );
    const mirrorItems50 = budgetItems50.filter((item: any) =>
      item.name?.toLowerCase().includes('mirror')
    );

    // Check items with status
    const itemsWithStatus500 = budgetItems.filter((item: any) => item.status);
    const itemsWithStatus50 = budgetItems50.filter((item: any) => item.status);

    return NextResponse.json({
      test500: {
        totalItems: budgetItems.length,
        error: budgetError,
        mirrorItems: mirrorItems500.map((i: any) => ({ id: i.id, name: i.name, status: i.status, vendor: i.vendor, internalNotes: i.internalNotes, costGroup: i.costGroup?.name })),
        itemsWithStatusCount: itemsWithStatus500.length,
        itemsWithStatus: itemsWithStatus500.map((i: any) => ({ id: i.id, name: i.name, status: i.status, vendor: i.vendor, costGroup: i.costGroup?.name })),
      },
      test50: {
        totalItems: budgetItems50.length,
        error: budget50Error,
        mirrorItems: mirrorItems50.map((i: any) => ({ id: i.id, name: i.name, status: i.status, vendor: i.vendor, internalNotes: i.internalNotes, costGroup: i.costGroup?.name })),
        itemsWithStatusCount: itemsWithStatus50.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}

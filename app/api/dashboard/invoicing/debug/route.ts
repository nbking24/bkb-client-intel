import { NextResponse } from 'next/server';
import { getDocumentsForJob, getCostItemsForJobLite, getTimeEntriesForJob } from '@/app/lib/jobtread';

export const runtime = 'nodejs';

export async function GET() {
  // Test a single known job (Wallace Home Renovation)
  const testJobId = '22P5YZNtEP7V';

  try {
    const start = Date.now();
    const [documents, costItems, timeEntries] = await Promise.all([
      getDocumentsForJob(testJobId),
      getCostItemsForJobLite(testJobId, 50),
      getTimeEntriesForJob(testJobId, 50),
    ]);
    const elapsed = Date.now() - start;

    return NextResponse.json({
      testJobId,
      elapsed: `${elapsed}ms`,
      documents: documents.length,
      costItems: costItems.length,
      timeEntries: timeEntries.length,
      sampleDoc: documents[0] || null,
      sampleCostItem: costItems[0] ? { id: costItems[0].id, name: costItems[0].name, cost: costItems[0].cost, document: costItems[0].document } : null,
      envKeyLength: (process.env.JOBTREAD_API_KEY || '').length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}

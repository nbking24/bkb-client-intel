import { NextResponse } from 'next/server';
import { reorganizeCostPlusInvoice } from '@/app/lib/jobtread';

/**
 * POST /api/dashboard/invoicing/reorganize-invoice
 *
 * Reorganizes a Cost-Plus invoice (created via JT's Bills & Time UI)
 * into the BKB 3-group format: Permit & Admin, Materials, BKB Labor.
 * Each group gets a bullet-point description summarizing contents.
 *
 * Body: { documentId: string, jobId: string }
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { documentId, jobId } = body;

    if (!documentId || !jobId) {
      return NextResponse.json({ error: 'documentId and jobId are required' }, { status: 400 });
    }

    const result = await reorganizeCostPlusInvoice(documentId, jobId);

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[ReorganizeInvoice] Error:', err);
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}

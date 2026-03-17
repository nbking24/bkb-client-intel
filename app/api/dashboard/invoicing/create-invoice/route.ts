// @ts-nocheck
import { NextResponse } from 'next/server';
import { createDraftCostPlusInvoice } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 60; // Invoice creation involves many sequential API calls

export async function POST(req: Request) {
  try {
    const { jobId } = await req.json();

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    console.log('[CREATE-INVOICE] Starting draft invoice creation for job:', jobId);

    const result = await createDraftCostPlusInvoice(jobId);

    console.log('[CREATE-INVOICE] Success:', {
      documentId: result.documentId,
      documentNumber: result.documentNumber,
      itemCount: result.itemCount,
      totalPrice: result.totalPrice,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[CREATE-INVOICE] Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to create draft invoice' },
      { status: 500 }
    );
  }
}

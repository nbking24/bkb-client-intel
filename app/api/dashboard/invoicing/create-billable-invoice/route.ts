// @ts-nocheck
import { NextResponse } from 'next/server';
import { createDraftBillableInvoice } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 60; // Change Order creation involves many sequential API calls

// NOTE: Endpoint name remains /create-billable-invoice for backwards compatibility,
// but this now creates a draft Change Order (customerOrder) on fixed-price jobs.
// See createDraftBillableInvoice docstring in app/lib/jobtread.ts for the rationale.
export async function POST(req: Request) {
  try {
    const { jobId } = await req.json();

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    console.log('[CREATE-BILLABLE-CO] Starting draft billable change order creation for job:', jobId);

    const result = await createDraftBillableInvoice(jobId);

    console.log('[CREATE-BILLABLE-CO] Success:', {
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
    console.error('[CREATE-BILLABLE-CO] Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to create draft billable change order' },
      { status: 500 }
    );
  }
}

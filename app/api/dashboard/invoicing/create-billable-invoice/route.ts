// @ts-nocheck
import { NextResponse } from 'next/server';
import { createDraftBillableInvoice } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 60; // Invoice creation involves many sequential API calls

export async function POST(req: Request) {
  try {
    const { jobId } = await req.json();

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    console.log('[CREATE-BILLABLE-INVOICE] Starting draft billable invoice creation for job:', jobId);

    const result = await createDraftBillableInvoice(jobId);

    console.log('[CREATE-BILLABLE-INVOICE] Success:', {
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
    console.error('[CREATE-BILLABLE-INVOICE] Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to create draft billable invoice' },
      { status: 500 }
    );
  }
}

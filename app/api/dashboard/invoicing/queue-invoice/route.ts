import { NextResponse } from 'next/server';
import { createServerClient } from '@/app/lib/supabase';

/**
 * POST /api/dashboard/invoicing/queue-invoice
 *
 * Queues a Cost-Plus invoice creation request in Supabase.
 * The actual invoice will be created by a Claude scheduled task
 * via JT's native Bills & Time UI flow (Chrome browser automation),
 * which properly marks bills and time entries as "invoiced" in JT.
 *
 * Body: { jobId: string, jobName?: string, jobNumber?: string, clientName?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId, jobName, jobNumber, clientName } = body;

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Check for existing pending/processing request for this job.
    // Stale requests older than 10 minutes are auto-cleared to prevent blocking.
    const { data: existing } = await supabase
      .from('invoice_creation_requests')
      .select('id, status, created_at')
      .eq('job_id', jobId)
      .in('status', ['pending', 'processing'])
      .limit(5);

    if (existing && existing.length > 0) {
      const TEN_MINUTES = 10 * 60 * 1000;
      const staleRequests = existing.filter(
        (r) => Date.now() - new Date(r.created_at).getTime() > TEN_MINUTES
      );
      const freshRequests = existing.filter(
        (r) => Date.now() - new Date(r.created_at).getTime() <= TEN_MINUTES
      );

      // Auto-mark stale requests as failed
      for (const stale of staleRequests) {
        await supabase
          .from('invoice_creation_requests')
          .update({ status: 'failed', error: 'Request timed out (stale after 10 minutes)' })
          .eq('id', stale.id);
      }

      // Only block if there's a fresh pending/processing request
      if (freshRequests.length > 0) {
        return NextResponse.json({
          error: 'An invoice creation request is already pending for this job',
          existingRequestId: freshRequests[0].id,
          status: freshRequests[0].status,
        }, { status: 409 });
      }
    }

    // Insert the request
    const { data, error } = await supabase
      .from('invoice_creation_requests')
      .insert({
        job_id: jobId,
        job_name: jobName || null,
        job_number: jobNumber || null,
        client_name: clientName || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('[QueueInvoice] Supabase insert error:', error);
      return NextResponse.json({ error: 'Failed to queue request: ' + error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      requestId: data.id,
      message: `Invoice creation queued for ${jobName || jobId}. Run the "create-jt-invoice" task in Cowork to process it.`,
    });
  } catch (err: any) {
    console.error('[QueueInvoice] Error:', err);
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}

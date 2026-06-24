// @ts-nocheck
/**
 * Excluded vendor bills CRUD - cost-plus jobs only.
 *
 *   GET   /api/dashboard/invoicing/excluded-bills?jobId=XXX
 *           List bills currently excluded for that job + every
 *           candidate vendor bill on the job (so the UI can show all
 *           bills with checked / unchecked state in one render).
 *
 *   POST  /api/dashboard/invoicing/excluded-bills
 *           Body: { docId, jobId, reason? }
 *           Marks a bill as already-billed-outside-Hub. Idempotent —
 *           re-POSTing updates reason and timestamp.
 *
 *   DELETE /api/dashboard/invoicing/excluded-bills?docId=XXX
 *           Un-excludes a bill. Used when the operator changes their
 *           mind or marks a row by mistake.
 *
 * The invoicing-health compute reads this table to filter out
 * excluded bills before the FIFO unbilled calculation - so the
 * cost-plus job's "unbilled" total no longer includes pre-Hub bills.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { getDocumentsForJob } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  const sb = getSupabase();
  try {
    // Pull excluded set + all vendor bills for the job in parallel so
    // the UI can render every bill with its current state in one shot.
    const [excludedRes, docs] = await Promise.all([
      sb.from('excluded_vendor_bills')
        .select('doc_id, reason, excluded_by, excluded_at')
        .eq('job_id', jobId),
      getDocumentsForJob(jobId).catch(() => []),
    ]);
    if (excludedRes.error) {
      return NextResponse.json({ error: excludedRes.error.message }, { status: 500 });
    }
    const excludedMap = new Map<string, any>();
    for (const r of excludedRes.data || []) {
      excludedMap.set(r.doc_id, r);
    }
    // Surface every vendor bill (not just approved) so the operator
    // can mark old draft / pending bills too. Denied bills are
    // skipped - they're already filtered out of the unbilled compute.
    const vendorBills = (docs || [])
      .filter((d: any) => d.type === 'vendorBill' && d.status !== 'denied')
      .map((d: any) => {
        const ex = excludedMap.get(d.id);
        return {
          docId: d.id,
          name: d.name || '',
          number: d.number || '',
          status: d.status,
          createdAt: d.createdAt,
          cost: Number(d.cost) || 0,
          price: Number(d.price) || 0,
          excluded: !!ex,
          reason: ex?.reason || null,
          excludedBy: ex?.excluded_by || null,
          excludedAt: ex?.excluded_at || null,
        };
      })
      .sort((a: any, b: any) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    return NextResponse.json({
      jobId,
      bills: vendorBills,
      excludedCount: excludedMap.size,
      excludedTotal: vendorBills
        .filter((b: any) => b.excluded)
        .reduce((s: number, b: any) => s + b.cost, 0),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to load excluded bills' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const docId: string | undefined = body?.docId;
  const jobId: string | undefined = body?.jobId;
  const reason: string | null = body?.reason || null;
  const excludedBy: string = body?.excludedBy || 'nathan';
  if (!docId || !jobId) {
    return NextResponse.json({ error: 'docId and jobId are required' }, { status: 400 });
  }
  const sb = getSupabase();
  try {
    const { error } = await sb
      .from('excluded_vendor_bills')
      .upsert({
        doc_id: docId,
        job_id: jobId,
        reason,
        excluded_by: excludedBy,
        excluded_at: new Date().toISOString(),
      }, { onConflict: 'doc_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, docId });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Exclude failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const docId = req.nextUrl.searchParams.get('docId');
  if (!docId) {
    return NextResponse.json({ error: 'docId is required' }, { status: 400 });
  }
  const sb = getSupabase();
  try {
    const { error } = await sb
      .from('excluded_vendor_bills')
      .delete()
      .eq('doc_id', docId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, docId });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Un-exclude failed' }, { status: 500 });
  }
}

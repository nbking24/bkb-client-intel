// @ts-nocheck
/**
 * Per-cost-code % complete overrides for the Job Costing detail view.
 *
 *   GET  /api/dashboard/job-costing/cost-code-progress?jobId=XXX
 *        → { rows: [{ costCodeNumber, costCodeName, percentComplete,
 *                      setBy, setAt, notes }] }
 *
 *   PUT  /api/dashboard/job-costing/cost-code-progress
 *        body: { jobId, costCodeNumber, costCodeName?, percentComplete (0-100),
 *                setBy?, notes? }
 *        → { ok: true, ...row }
 *
 *   DELETE /api/dashboard/job-costing/cost-code-progress?jobId=XXX&costCodeNumber=01
 *        → { ok: true } — clears the override for that single code.
 *
 * The detail endpoint reads these rows and (a) annotates each cost code
 * breakdown row with its manual %, (b) includes the per-code % map in the
 * AI cost analysis prompt so the model can reason about which categories
 * are fully done vs in-progress.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../lib/supabase';

export const runtime = 'nodejs';

function shapeRow(r: any) {
  return {
    costCodeNumber: r.cost_code_number,
    costCodeName: r.cost_code_name || null,
    percentComplete: r.percent_complete,
    setBy: r.set_by || null,
    setAt: r.set_at || null,
    notes: r.notes || null,
  };
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('job_cost_code_progress')
    .select('*')
    .eq('job_id', jobId)
    .order('cost_code_number', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: (data || []).map(shapeRow) });
}

export async function PUT(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* fallthrough */ }
  const jobId: string | undefined = body.jobId;
  const costCodeNumber: string | undefined = body.costCodeNumber;
  const costCodeName: string | null = body.costCodeName || null;
  const percent = Number(body.percentComplete);
  const setBy: string = body.setBy || 'nathan';
  const notes: string | null = body.notes || null;

  if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  if (!costCodeNumber) return NextResponse.json({ error: 'costCodeNumber is required' }, { status: 400 });
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return NextResponse.json({ error: 'percentComplete must be 0-100' }, { status: 400 });
  }

  const supabase = getSupabase();
  const payload = {
    job_id: jobId,
    cost_code_number: costCodeNumber,
    cost_code_name: costCodeName,
    percent_complete: Math.round(percent),
    set_by: setBy,
    set_at: new Date().toISOString(),
    notes,
  };
  const { error } = await supabase
    .from('job_cost_code_progress')
    .upsert(payload, { onConflict: 'job_id,cost_code_number' });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...shapeRow(payload) });
}

export async function DELETE(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  const costCodeNumber = req.nextUrl.searchParams.get('costCodeNumber');
  if (!jobId || !costCodeNumber) {
    return NextResponse.json({ error: 'jobId and costCodeNumber are required' }, { status: 400 });
  }
  const supabase = getSupabase();
  const { error } = await supabase
    .from('job_cost_code_progress')
    .delete()
    .eq('job_id', jobId)
    .eq('cost_code_number', costCodeNumber);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

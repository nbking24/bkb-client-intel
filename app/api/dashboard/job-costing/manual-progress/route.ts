// @ts-nocheck
/**
 * Manual % complete override for the Job Costing detail view.
 *
 *   GET  /api/dashboard/job-costing/manual-progress?jobId=XXX
 *        → { percentComplete, setBy, setAt, notes } | null
 *
 *   PUT  /api/dashboard/job-costing/manual-progress
 *        body: { jobId, percentComplete (0-100), setBy?, notes? }
 *        → { ok: true, percentComplete, setBy, setAt, notes }
 *
 *   DELETE /api/dashboard/job-costing/manual-progress?jobId=XXX
 *        → { ok: true } — clears the override so schedule-derived
 *          progress is used again.
 *
 * The detail endpoint reads this row and prefers it over the schedule-
 * derived progress (open/closed JT task count) when generating the AI
 * cost analysis.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../lib/supabase';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('job_manual_progress')
    .select('percent_complete, set_by, set_at, notes')
    .eq('job_id', jobId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ override: null });
  return NextResponse.json({
    override: {
      percentComplete: data.percent_complete,
      setBy: data.set_by,
      setAt: data.set_at,
      notes: data.notes,
    },
  });
}

export async function PUT(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* fallthrough */ }
  const jobId: string | undefined = body.jobId;
  const percent = Number(body.percentComplete);
  const setBy: string = body.setBy || 'nathan';
  const notes: string | null = body.notes || null;

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return NextResponse.json({ error: 'percentComplete must be 0-100' }, { status: 400 });
  }

  const supabase = getSupabase();
  const payload = {
    job_id: jobId,
    percent_complete: Math.round(percent),
    set_by: setBy,
    set_at: new Date().toISOString(),
    notes,
  };
  const { error } = await supabase
    .from('job_manual_progress')
    .upsert(payload, { onConflict: 'job_id' });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    percentComplete: payload.percent_complete,
    setBy,
    setAt: payload.set_at,
    notes,
  });
}

export async function DELETE(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  const supabase = getSupabase();
  const { error } = await supabase
    .from('job_manual_progress')
    .delete()
    .eq('job_id', jobId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

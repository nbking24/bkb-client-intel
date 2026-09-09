// @ts-nocheck
/**
 * Manual projected contract total for a job on the Production Schedule.
 *
 * PUT    /api/dashboard/production-schedule/projection
 *          body: { jobId, projectedTotal: number, note?: string }
 * DELETE /api/dashboard/production-schedule/projection?jobId=…
 *
 * The value feeds the Sales Outlook "Projected" line ONLY while the job has
 * no approved Construction Contract in JobTread. Once a contract is approved
 * the JT budget total takes over automatically; the row stays for history.
 *
 * Auth: validateAuth + (owner | admin | jt_write feature).
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getEffectiveAccess } from '@/app/lib/access';
import { getSupabase } from '@/app/api/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const access = await getEffectiveAccess(auth.userId);
  const ok = access && (access.role === 'owner' || access.role === 'admin' || (access.features || []).includes('jt_write'));
  if (!ok) return { error: NextResponse.json({ error: 'Not permitted' }, { status: 403 }) };
  return { access, userId: auth.userId };
}

export async function PUT(req: NextRequest) {
  const g = await gate(req); if (g.error) return g.error;
  let body: any = {};
  try { body = await req.json(); } catch {}
  const { jobId, projectedTotal, note } = body || {};
  const n = Number(projectedTotal);
  if (!jobId || !Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'jobId and a non-negative projectedTotal required' }, { status: 400 });
  const row = { job_id: jobId, projected_total: Math.round(n * 100) / 100, note: note ? String(note).slice(0, 500) : null, set_by: g.access.name || g.userId, set_at: new Date().toISOString() };
  const { error } = await getSupabase().from('production_sales_projections').upsert(row, { onConflict: 'job_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...row });
}

export async function DELETE(req: NextRequest) {
  const g = await gate(req); if (g.error) return g.error;
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });
  const { error } = await getSupabase().from('production_sales_projections').delete().eq('job_id', jobId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, jobId });
}

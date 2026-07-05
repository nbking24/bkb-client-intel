// @ts-nocheck
/**
 * GET /api/dashboard/pm-portfolio
 *
 * Returns the logged-in user's In-Production JT jobs (filtered by the
 * Project Manager custom field matching the user's name and Status =
 * "6. In Production"). Each job carries current manual % complete plus
 * headline financials so the PM can update progress from one page.
 *
 * PUT /api/dashboard/pm-portfolio
 *   body: { jobId, percentComplete (0-100), notes? }
 *   Same effect as the existing /api/dashboard/job-costing/manual-progress
 *   PUT, but callable from this page with the user's identity captured
 *   automatically.
 *
 * Auth: validateAuth (Bearer app-pin or user token). Any authenticated
 * user can call GET - the JT filter uses THEIR name, so they only see
 * their own jobs. Nathan sees zero jobs unless his name is in a JT PM
 * field, which is fine - Nathan can view any PM's portfolio by hitting
 * /api/dashboard/pm-portfolio?pm=Evan+Harrington (owner-only override).
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getEffectiveAccess } from '@/app/lib/access';
import { getActiveJobs, getJob } from '@/app/lib/jobtread';
import { getSupabase } from '@/app/api/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PRODUCTION_STATUS = '6. In Production';

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await getEffectiveAccess(auth.userId);
  if (!access) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Owner can override to view someone else's portfolio via ?pm=Name
  const pmOverride = req.nextUrl.searchParams.get('pm');
  const isOwner = access.role === 'owner';
  const targetPm = isOwner && pmOverride ? pmOverride : access.name;

  if (!targetPm) {
    return NextResponse.json({ error: 'No PM name resolved' }, { status: 400 });
  }

  // Get all active jobs, filter to this PM + In Production
  const jobs = await getActiveJobs();
  const myJobs = jobs.filter(
    (j: any) =>
      (j.projectManager || '').trim().toLowerCase() === targetPm.trim().toLowerCase() &&
      j.customStatus === PRODUCTION_STATUS
  );

  // Fetch details + manual progress in parallel (small N, safe)
  const supabase = getSupabase();
  const [details, progressRows] = await Promise.all([
    Promise.all(
      myJobs.map(async (j: any) => {
        try {
          const d = await getJob(j.id);
          return { id: j.id, detail: d };
        } catch {
          return { id: j.id, detail: null };
        }
      })
    ),
    supabase
      .from('job_manual_progress')
      .select('job_id, percent_complete, set_by, set_at, notes')
      .in('job_id', myJobs.map((j: any) => j.id)),
  ]);

  const progressByJob: Record<string, any> = {};
  for (const row of progressRows.data || []) {
    progressByJob[row.job_id] = row;
  }
  const detailByJob: Record<string, any> = {};
  for (const d of details) {
    if (d.detail) detailByJob[d.id] = d.detail;
  }

  const today = new Date();
  const rows = myJobs
    .map((j: any) => {
      const d = detailByJob[j.id] || {};
      const p = progressByJob[j.id];
      const schedStart = d.scheduleStart || null;
      const schedEnd = d.scheduleEnd || null;
      let daysInProd: number | null = null;
      let daysToTarget: number | null = null;
      let targetDur: number | null = null;
      if (schedStart) {
        const s = new Date(schedStart);
        daysInProd = Math.floor((today.getTime() - s.getTime()) / 86400000);
      }
      if (schedStart && schedEnd) {
        const s = new Date(schedStart);
        const e = new Date(schedEnd);
        targetDur = Math.floor((e.getTime() - s.getTime()) / 86400000);
      }
      if (schedEnd) {
        const e = new Date(schedEnd);
        daysToTarget = Math.floor((e.getTime() - today.getTime()) / 86400000);
      }
      const projPrice = Number(d.projectedPrice ?? 0);
      const projCost = Number(d.projectedCost ?? 0);
      const actCost = Number(d.actualCost ?? 0);
      return {
        id: j.id,
        number: j.number,
        name: j.name,
        clientName: j.clientName,
        priceType: j.priceType,
        contractPrice: projPrice,
        budgetedCost: projCost,
        actualCost: actCost,
        costPctBudget: projCost > 0 ? (actCost / projCost) * 100 : 0,
        marginPct: d.marginPct ?? null,
        scheduleStart: schedStart,
        scheduleEnd: schedEnd,
        daysInProd,
        daysToTarget,
        targetDuration: targetDur,
        manualPercentComplete: p ? p.percent_complete : null,
        progressSetBy: p ? p.set_by : null,
        progressSetAt: p ? p.set_at : null,
        progressNotes: p ? p.notes : null,
        jobCostingUrl: `/dashboard/job-costing?job=${j.id}`,
      };
    })
    // Sort: overdue first (most days over), then largest contract
    .sort((a: any, b: any) => {
      const av = a.daysToTarget === null ? 99999 : a.daysToTarget;
      const bv = b.daysToTarget === null ? 99999 : b.daysToTarget;
      if (av !== bv) return av - bv;
      return b.contractPrice - a.contractPrice;
    });

  return NextResponse.json({
    pm: targetPm,
    generatedAt: new Date().toISOString(),
    jobCount: rows.length,
    jobs: rows,
  });
}

export async function PUT(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await getEffectiveAccess(auth.userId);
  if (!access) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  let body: any = {};
  try { body = await req.json(); } catch { /* fallthrough */ }
  const jobId: string | undefined = body.jobId;
  const percent = Number(body.percentComplete);
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
    set_by: access.name || auth.userId,
    set_at: new Date().toISOString(),
    notes,
  };
  const { error } = await supabase
    .from('job_manual_progress')
    .upsert(payload, { onConflict: 'job_id' });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Bust the job costing cache so downstream views see the new value
  await supabase.from('job_costing_cache').delete().eq('job_id', jobId);

  return NextResponse.json({
    ok: true,
    percentComplete: payload.percent_complete,
    setBy: payload.set_by,
    setAt: payload.set_at,
  });
}

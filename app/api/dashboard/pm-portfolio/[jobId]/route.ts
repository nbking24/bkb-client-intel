// @ts-nocheck
/**
 * GET /api/dashboard/pm-portfolio/[jobId]
 *
 * PM-only per-job cost detail. Returns budget vs actual by division
 * (parent cost group) plus overall budget totals. Deliberately does
 * NOT return contract price, revenue, margin dollars, or margin %.
 * PMs (Evan) should see cost discipline data without company
 * profitability data.
 *
 * Security: user must be the Project Manager on this job in JT, OR
 * be the owner. Otherwise 403.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getEffectiveAccess } from '@/app/lib/access';
import { getJob, getCostItemsForJobLite } from '@/app/lib/jobtread';
import { getSupabase } from '@/app/api/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await getEffectiveAccess(auth.userId);
  if (!access) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const jobId = params.jobId;
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  // Fetch the job to verify PM assignment
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  // Extract PM custom field
  const pmField = (job.customFieldValues?.nodes || []).find(
    (cfv: any) => cfv.customField?.name === 'Project Manager'
  );
  const jobPm = (pmField?.value || '').trim().toLowerCase();
  const userName = (access.name || '').trim().toLowerCase();
  const isOwner = access.role === 'owner';

  if (!isOwner && jobPm !== userName) {
    return NextResponse.json(
      { error: 'You are not the Project Manager on this job' },
      { status: 403 }
    );
  }

  // Fetch cost items
  const costItems = await getCostItemsForJobLite(jobId, 500);

  // Group by parent cost group (division). Fall back to costGroup name if
  // no parent, and to "Uncategorized" if neither is present. Skip items
  // where the cost group is deselected (isSelected=false) - those are
  // unpicked options that shouldn't count in the budget.
  const byDivision: Record<string, {
    name: string;
    budgetedCost: number;
    actualCost: number;
    itemCount: number;
  }> = {};

  for (const ci of costItems) {
    // Skip deselected options (mirrors budget filter)
    if (ci.costGroup?.isSelected === false) continue;
    if (ci.costGroup?.parentCostGroup?.isSelected === false) continue;

    const divisionName =
      ci.costGroup?.parentCostGroup?.name ||
      ci.costGroup?.name ||
      'Uncategorized';

    if (!byDivision[divisionName]) {
      byDivision[divisionName] = {
        name: divisionName,
        budgetedCost: 0,
        actualCost: 0,
        itemCount: 0,
      };
    }
    // Prefer estimated cost from approved cost items
    const budgetedCost = Number(ci.estimatedCost ?? 0);
    const actualCost = Number(ci.actualCost ?? 0);
    byDivision[divisionName].budgetedCost += budgetedCost;
    byDivision[divisionName].actualCost += actualCost;
    byDivision[divisionName].itemCount += 1;
  }

  // Sort divisions by budgeted cost descending
  const divisions = Object.values(byDivision)
    .filter((d) => d.budgetedCost > 0 || d.actualCost > 0)
    .map((d) => ({
      ...d,
      variance: d.actualCost - d.budgetedCost,
      variancePct: d.budgetedCost > 0 ? ((d.actualCost - d.budgetedCost) / d.budgetedCost) * 100 : 0,
      pctOfBudget: d.budgetedCost > 0 ? (d.actualCost / d.budgetedCost) * 100 : 0,
    }))
    .sort((a, b) => b.budgetedCost - a.budgetedCost);

  // Totals across all divisions
  const totalBudgeted = divisions.reduce((sum, d) => sum + d.budgetedCost, 0);
  const totalActual = divisions.reduce((sum, d) => sum + d.actualCost, 0);
  const totalVariance = totalActual - totalBudgeted;
  const overallPct = totalBudgeted > 0 ? (totalActual / totalBudgeted) * 100 : 0;

  // Pull current manual % complete so the detail page can show + let PM edit
  const supabase = getSupabase();
  const { data: progress } = await supabase
    .from('job_manual_progress')
    .select('percent_complete, set_by, set_at, notes')
    .eq('job_id', jobId)
    .maybeSingle();

  return NextResponse.json({
    jobId,
    jobName: job.name,
    jobNumber: job.number,
    clientName: job.location?.account?.name || '',
    priceType: job.priceType,
    scheduleStart: job.scheduleStart || null,
    scheduleEnd: job.scheduleEnd || null,
    manualPercentComplete: progress?.percent_complete ?? null,
    progressSetBy: progress?.set_by ?? null,
    progressSetAt: progress?.set_at ?? null,
    totals: {
      budgetedCost: totalBudgeted,
      actualCost: totalActual,
      variance: totalVariance,
      variancePct: totalBudgeted > 0 ? (totalVariance / totalBudgeted) * 100 : 0,
      pctOfBudget: overallPct,
    },
    divisions,
    generatedAt: new Date().toISOString(),
  });
}

// PUT: PM can update % complete from this page too. Same table, same
// data as the main portfolio and the job costing dashboard.
export async function PUT(req: NextRequest, { params }: { params: { jobId: string } }) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await getEffectiveAccess(auth.userId);
  if (!access) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const jobId = params.jobId;
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  // Same PM-assignment gate as GET
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  const pmField = (job.customFieldValues?.nodes || []).find(
    (cfv: any) => cfv.customField?.name === 'Project Manager'
  );
  const jobPm = (pmField?.value || '').trim().toLowerCase();
  const userName = (access.name || '').trim().toLowerCase();
  const isOwner = access.role === 'owner';
  if (!isOwner && jobPm !== userName) {
    return NextResponse.json({ error: 'You are not the Project Manager on this job' }, { status: 403 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* fallthrough */ }
  const percent = Number(body.percentComplete);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return NextResponse.json({ error: 'percentComplete must be 0-100' }, { status: 400 });
  }
  const supabase = getSupabase();
  const payload = {
    job_id: jobId,
    percent_complete: Math.round(percent),
    set_by: access.name || auth.userId,
    set_at: new Date().toISOString(),
    notes: body.notes || null,
  };
  const { error } = await supabase
    .from('job_manual_progress')
    .upsert(payload, { onConflict: 'job_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabase.from('job_costing_cache').delete().eq('job_id', jobId);

  return NextResponse.json({
    ok: true,
    percentComplete: payload.percent_complete,
    setBy: payload.set_by,
    setAt: payload.set_at,
  });
}

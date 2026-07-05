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

  return NextResponse.json({
    jobId,
    jobName: job.name,
    jobNumber: job.number,
    clientName: job.location?.account?.name || '',
    priceType: job.priceType,
    scheduleStart: job.scheduleStart || null,
    scheduleEnd: job.scheduleEnd || null,
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

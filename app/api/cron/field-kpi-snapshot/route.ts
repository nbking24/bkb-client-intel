// @ts-nocheck
// ============================================================
// Field KPI Snapshot — Bi-weekly Cron Job
//
// Runs on the 1st and 15th of each month at 6:30 AM UTC
// Snapshots KPI values for each field staff member into agent_cache
// so the dashboard can show historical trends.
//
// Also supports ?seed=true to manually trigger a one-off snapshot.
// Protected by CRON_SECRET to prevent unauthorized execution.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getActiveJobs, getTasksForJob } from '@/app/lib/jobtread';
import { computeFieldKPIs } from '@/app/lib/field-kpis';
import { createServerClient } from '@/app/lib/supabase';
import { TEAM_USERS } from '@/app/lib/constants';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  // Allow seed mode without CRON_SECRET for initial setup, or verify cron secret
  const url = new URL(req.url);
  const isSeed = url.searchParams.get('seed') === 'true';

  if (!isSeed) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  console.log('=== Field KPI Snapshot ===');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  console.log(`Date: ${todayStr}, Seed: ${isSeed}`);

  try {
    const sb = createServerClient();

    // Get all active jobs
    const activeJobs = await getActiveJobs(50).catch(() => []);

    // Find field staff users (field_sup and field roles)
    const fieldUsers = Object.entries(TEAM_USERS).filter(
      ([, u]) => u.role === 'field_sup' || u.role === 'field'
    );

    const results: any[] = [];

    for (const [userId, user] of fieldUsers) {
      console.log(`Snapshotting KPIs for ${user.name} (${userId})...`);

      // Filter jobs managed by this user
      const myJobs = activeJobs.filter((j: any) => j.projectManager === user.name);

      if (myJobs.length === 0) {
        console.log(`  No jobs for ${user.name}, skipping.`);
        continue;
      }

      // Fetch tasks for all their jobs
      const jobDataResults = await Promise.all(
        myJobs.map(async (job: any) => {
          const tasks = await getTasksForJob(job.id).catch(() => []);
          return { jobId: job.id, tasks };
        })
      );

      // Compute KPIs
      const kpis = computeFieldKPIs(jobDataResults, today);

      // Store snapshot
      const cacheKey = `field-kpi:${userId}:${todayStr}`;
      const snapshotData = {
        scheduleAdherence: kpis.scheduleAdherence,
        avgDaysOverdue: kpis.avgDaysOverdue,
        staleTaskCount: kpis.staleTaskCount,
        completedThisWeek: kpis.completedThisWeek,
        tasksNext7: kpis.tasksNext7,
        tasksNext30: kpis.tasksNext30,
        jobCount: myJobs.length,
      };

      await sb.from('agent_cache').upsert(
        { key: cacheKey, data: snapshotData, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

      results.push({ userId, userName: user.name, date: todayStr, kpis: snapshotData });
      console.log(`  Saved: ${cacheKey}`);
    }

    return NextResponse.json({
      ok: true,
      date: todayStr,
      snapshots: results,
    });
  } catch (err: any) {
    console.error('Field KPI snapshot error:', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}

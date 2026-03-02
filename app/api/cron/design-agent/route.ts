// ============================================================
// Design Manager Agent — Daily Cron Job
//
// Runs daily at 1:00 AM EST (06:00 UTC)
// Calls the agent analysis endpoint which runs a fresh
// analysis and caches the result in Supabase.
// Protected by CRON_SECRET to prevent unauthorized execution.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60; // Allow up to 60s for full agent analysis

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('Cron: unauthorized request blocked');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('=== Design Manager Agent — Daily Cron Run ===');
  console.log(`Time: ${new Date().toISOString()}`);

  try {
    // Call the agent analysis endpoint internally
    // This will run a fresh analysis and cache the result in Supabase
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const res = await fetch(`${baseUrl}/api/agent/design-manager`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`Cron: Agent returned ${res.status}: ${errText.slice(0, 300)}`);
      return NextResponse.json(
        { success: false, error: `Agent returned ${res.status}` },
        { status: 500 }
      );
    }

    const report = await res.json();

    // Log summary for Vercel dashboard
    console.log('Cron: Analysis complete — results cached in Supabase');
    console.log(`  Projects: ${report.projectCount}`);
    console.log(`  Alerts: ${report.alertCount}`);
    console.log(`  Summary: ${report.summary?.slice(0, 200)}`);

    if (report.topPriorities?.length) {
      console.log('  Top Priorities:');
      report.topPriorities.forEach((p: string, i: number) => {
        console.log(`    ${i + 1}. ${p}`);
      });
    }

    // Log per-project status
    if (report.projects?.length) {
      const statusCounts: Record<string, number> = {};
      for (const p of report.projects) {
        statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
      }
      console.log(`  Status breakdown: ${JSON.stringify(statusCounts)}`);

      // Flag critical issues
      const critical = report.projects.filter(
        (p: any) => p.status === 'stalled' || p.status === 'blocked'
      );
      if (critical.length > 0) {
        console.log(`  CRITICAL: ${critical.length} projects stalled/blocked:`);
        critical.forEach((p: any) => {
          console.log(`    - ${p.jobName}: ${p.nextStep}`);
        });
      }
    }

    return NextResponse.json({
      success: true,
      runAt: new Date().toISOString(),
      cached: true,
      projectCount: report.projectCount,
      alertCount: report.alertCount,
      summary: report.summary,
    });
  } catch (err: any) {
    console.error('Cron: Agent analysis failed:', err.message);
    return NextResponse.json(
      { success: false, error: err.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

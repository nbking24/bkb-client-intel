// ============================================================
// Invoicing Health Agent — Daily Cron Job
//
// Runs daily at 1:00 AM EST (06:00 UTC)
// Calls the invoicing agent analysis endpoint which runs
// a fresh analysis and caches the result in Supabase.
// Protected by CRON_SECRET to prevent unauthorized execution.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120; // Allow up to 2 min for full analysis

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('[InvoicingCron] Unauthorized request blocked');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('=== Invoicing Health Agent — Daily Cron Run ===');
  console.log(`Time: ${new Date().toISOString()}`);

  try {
    // Call the agent analysis endpoint internally
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const res = await fetch(`${baseUrl}/api/agent/invoicing`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[InvoicingCron] Agent returned ${res.status}: ${errText.slice(0, 300)}`);
      return NextResponse.json(
        { success: false, error: `Agent returned ${res.status}` },
        { status: 500 }
      );
    }

    const report = await res.json();

    // Log summary for Vercel dashboard
    console.log('[InvoicingCron] Analysis complete — results cached in Supabase');
    console.log(`  Open Jobs: ${report.invoicingData?.summary?.totalOpenJobs}`);
    console.log(`  Contract Jobs: ${report.invoicingData?.summary?.contractJobs}`);
    console.log(`  Cost Plus Jobs: ${report.invoicingData?.summary?.costPlusJobs}`);
    console.log(`  Total Alerts: ${report.invoicingData?.summary?.totalAlerts}`);
    console.log(`  Overall Health: ${report.invoicingData?.summary?.overallHealth}`);
    console.log(`  Summary: ${report.summary?.slice(0, 200)}`);

    if (report.recommendations?.length) {
      console.log('  Top Recommendations:');
      report.recommendations.slice(0, 3).forEach((r: any, i: number) => {
        console.log(`    ${i + 1}. [${r.priority}] ${r.action} — ${r.jobName}`);
      });
    }

    return NextResponse.json({
      success: true,
      runAt: new Date().toISOString(),
      cached: true,
      jobCount: report.invoicingData?.summary?.totalOpenJobs,
      alertCount: report.invoicingData?.summary?.totalAlerts,
      health: report.invoicingData?.summary?.overallHealth,
      recommendationCount: report.recommendations?.length || 0,
      summary: report.summary,
    });
  } catch (err: any) {
    console.error('[InvoicingCron] Agent analysis failed:', err.message);
    return NextResponse.json(
      { success: false, error: err.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

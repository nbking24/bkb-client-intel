// ============================================================
// Schedule Compliance — Daily Cron Job
//
// Runs daily at 1:30 AM EST (06:30 UTC)
// 1. Scans all active jobs for schedule compliance
// 2. Auto-fixes non-compliant jobs (creates missing phases,
//    moves orphan/misplaced tasks — NEVER deletes tasks)
// 3. Caches the compliance report in Supabase
// Protected by CRON_SECRET to prevent unauthorized execution.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300; // Allow up to 5 min for bulk operations

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('Schedule compliance cron: unauthorized request blocked');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('=== Schedule Compliance — Daily Auto-Fix ===');
  console.log(`Time: ${new Date().toISOString()}`);

  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    // Step 1: Scan for compliance issues
    const scanRes = await fetch(`${baseUrl}/api/dashboard/schedule-compliance`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!scanRes.ok) {
      const errText = await scanRes.text().catch(() => '');
      console.error(`Cron: Scan returned ${scanRes.status}: ${errText.slice(0, 300)}`);
      return NextResponse.json(
        { success: false, error: `Scan returned ${scanRes.status}` },
        { status: 500 }
      );
    }

    const scanReport = await scanRes.json();
    console.log(`Cron: Scanned ${scanReport.totalJobs} jobs — ${scanReport.nonCompliantJobs} non-compliant`);

    // Step 2: If there are non-compliant jobs, auto-fix them
    if (scanReport.nonCompliantJobs > 0) {
      console.log('Cron: Auto-fixing non-compliant jobs...');

      const fixRes = await fetch(`${baseUrl}/api/dashboard/schedule-compliance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulkStandardize' }),
      });

      if (!fixRes.ok) {
        const errText = await fixRes.text().catch(() => '');
        console.error(`Cron: Bulk fix returned ${fixRes.status}: ${errText.slice(0, 300)}`);
        return NextResponse.json(
          { success: false, phase: 'fix', error: `Fix returned ${fixRes.status}` },
          { status: 500 }
        );
      }

      const fixResult = await fixRes.json();

      console.log('Cron: Auto-fix complete');
      console.log(`  Jobs processed: ${fixResult.totalJobs}`);
      console.log(`  Phases created: ${fixResult.totals.phasesCreated}`);
      console.log(`  Orphans moved: ${fixResult.totals.orphansMoved}`);
      console.log(`  Misplaced moved: ${fixResult.totals.misplacedMoved}`);
      console.log(`  Errors: ${fixResult.totals.errors}`);

      // Log per-job details for any jobs that had changes
      if (fixResult.jobResults?.length) {
        const jobsWithChanges = fixResult.jobResults.filter(
          (j: any) => j.phasesCreated > 0 || j.orphansMoved > 0 || j.misplacedMoved > 0
        );
        if (jobsWithChanges.length > 0) {
          console.log(`  Jobs with changes (${jobsWithChanges.length}):`);
          for (const j of jobsWithChanges) {
            console.log(`    - ${j.jobName}: +${j.phasesCreated} phases, ${j.orphansMoved + j.misplacedMoved} tasks moved`);
          }
        }
      }

      return NextResponse.json({
        success: true,
        runAt: new Date().toISOString(),
        scan: {
          totalJobs: scanReport.totalJobs,
          compliant: scanReport.compliantJobs,
          nonCompliant: scanReport.nonCompliantJobs,
        },
        fix: fixResult.totals,
      });
    }

    // All jobs already compliant
    console.log('Cron: All jobs already compliant — no fixes needed');
    return NextResponse.json({
      success: true,
      runAt: new Date().toISOString(),
      scan: {
        totalJobs: scanReport.totalJobs,
        compliant: scanReport.compliantJobs,
        nonCompliant: 0,
      },
      fix: null,
    });
  } catch (err: any) {
    console.error('Cron: Schedule compliance failed:', err.message);
    return NextResponse.json(
      { success: false, error: err.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

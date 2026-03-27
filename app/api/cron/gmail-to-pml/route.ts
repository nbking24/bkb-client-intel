// @ts-nocheck
/**
 * Gmail → Project Memory Layer Cron
 *
 * GET /api/cron/gmail-to-pml
 *
 * Syncs sent + received Gmail to project_events table.
 * Also detects replies on watched threads to auto-resolve open items.
 *
 * Runs hourly during work hours (7am-9pm ET) via Vercel cron.
 * Can also be triggered manually.
 */
import { NextRequest, NextResponse } from 'next/server';
import { syncGmailToProjectMemory } from '@/app/lib/gmail-sync';
import { getActiveJobs } from '../../lib/jobtread';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    // Verify cron secret OR allow internal calls
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isFromCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
    const isInternal = req.nextUrl.searchParams.get('internal') === 'true';

    if (!isFromCron && !isInternal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if within work hours (7am-9pm ET)
    const etHour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        hour12: false,
      }).format(new Date())
    );

    if (etHour < 7 || etHour >= 21) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Outside work hours (7am-9pm ET)',
      });
    }

    // Fetch active jobs for email-to-project matching
    const jobs = await getActiveJobs(50);
    const activeJobs = (jobs || []).map((j: any) => ({
      id: j.id,
      name: j.name || '',
      number: j.number || '',
    }));

    // Run the sync (last 2 hours to catch anything missed)
    const result = await syncGmailToProjectMemory(activeJobs, 2);

    console.log('[gmail-to-pml] Sync complete:', JSON.stringify(result));

    return NextResponse.json({
      success: true,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[gmail-to-pml] Cron error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

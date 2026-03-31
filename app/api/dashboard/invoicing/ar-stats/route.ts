// ============================================================
// AR Stats — Returns aggregate AR reminder statistics
//
// GET → Scans active jobs' comments for [AR-AUTO], [AR-HOLD],
//       [AR-RESUME] tags to build a summary.
// ============================================================

import { NextResponse } from 'next/server';
import { pave } from '@/app/lib/jobtread';

export const runtime = 'nodejs';

interface ArStatRecord {
  jobId: string;
  jobName: string;
  tier: string;
  date: string;
}

export async function GET() {
  try {
    // 1. Get active (non-closed) jobs — lightweight query with just id and name
    const ORG_ID = process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';
    const jobsResp = await pave({
      organization: {
        $: { id: ORG_ID },
        jobs: {
          $: { size: 50, where: ['closedOn', '=', null] },
          nodes: { id: {}, name: {} },
        },
      },
    });
    const jobs: Array<{ id: string; name: string }> = ((jobsResp as any)?.organization?.jobs?.nodes || []);
    if (jobs.length === 0) {
      return NextResponse.json({
        totalRemindersSent: 0,
        jobsWithReminders: 0,
        jobsOnHold: 0,
        activeJobs: 0,
        totalJobsTracked: 0,
        recentReminders: [],
      });
    }

    // 2. For each job, scan comments for AR tags — sequential to avoid 413
    let totalRemindersSent = 0;
    let jobsWithReminders = 0;
    let jobsOnHold = 0;
    let activeJobCount = 0;
    const recentReminders: ArStatRecord[] = [];

    const AR_AUTO_RE = /\[AR-AUTO\]/i;
    const AR_HOLD_RE = /\[AR-HOLD\]/i;
    const AR_RESUME_RE = /\[AR-RESUME\]/i;
    const TIER_RE = /\b(20-day|30-day|45-day|60-day)\b/i;

    for (const job of jobs) {
      try {
        const commentResp = await pave({
          job: {
            $: { id: job.id },
            comments: {
              $: { size: 50 },
              nodes: { id: {}, message: {}, createdAt: {}, name: {} },
            },
          },
        });

        const comments = (commentResp as any)?.job?.comments?.nodes || [];

        let jobReminderCount = 0;
        let lastHoldDate = 0;
        let lastResumeDate = 0;

        for (const c of comments) {
          const body = (c.message || '') + ' ' + (c.name || '');

          if (AR_AUTO_RE.test(body)) {
            jobReminderCount++;
            totalRemindersSent++;

            const tierMatch = body.match(TIER_RE);
            recentReminders.push({
              jobId: job.id,
              jobName: job.name,
              tier: tierMatch ? tierMatch[1] : 'reminder',
              date: c.createdAt,
            });
          }

          if (AR_HOLD_RE.test(body)) {
            const d = new Date(c.createdAt).getTime();
            if (d > lastHoldDate) lastHoldDate = d;
          }
          if (AR_RESUME_RE.test(body)) {
            const d = new Date(c.createdAt).getTime();
            if (d > lastResumeDate) lastResumeDate = d;
          }
        }

        const isHeld = lastHoldDate > 0 && lastHoldDate > lastResumeDate;
        if (isHeld) jobsOnHold++;
        else activeJobCount++;
        if (jobReminderCount > 0) jobsWithReminders++;
      } catch (err: any) {
        // Skip this job but continue with others
        console.error(`[AR-Stats] Error scanning job ${job.id}:`, err.message);
        activeJobCount++; // Count as active if we can't determine
      }
    }

    // Sort recent reminders by date descending, take top 10
    recentReminders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({
      totalRemindersSent,
      jobsWithReminders,
      jobsOnHold,
      activeJobs: activeJobCount,
      totalJobsTracked: jobs.length,
      recentReminders: recentReminders.slice(0, 10),
    });
  } catch (err: any) {
    console.error('[AR-Stats] Error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

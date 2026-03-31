// ============================================================
// AR Stats — Returns aggregate AR reminder statistics
//
// GET → Scans active jobs' comments for [AR-AUTO], [AR-HOLD],
//       [AR-RESUME] tags to build a summary.
// ============================================================

import { NextResponse } from 'next/server';
import { pave } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 30; // Allow up to 30s for scanning all jobs

interface ArStatRecord {
  jobId: string;
  jobName: string;
  tier: string;
  date: string;
}

interface JobScanResult {
  jobId: string;
  reminderCount: number;
  isHeld: boolean;
  reminders: ArStatRecord[];
}

export async function GET() {
  try {
    // 1. Get active (non-closed) jobs — lightweight query
    const ORG_ID = process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';
    const jobsResp = await pave({
      organization: {
        $: { id: ORG_ID },
        jobs: {
          $: { size: 100, where: ['closedOn', '=', null] },
          nodes: { id: {}, name: {} },
        },
      },
    });
    const jobs: Array<{ id: string; name: string }> = ((jobsResp as any)?.organization?.jobs?.nodes || []);
    if (jobs.length === 0) {
      return NextResponse.json({
        totalRemindersSent: 0, jobsWithReminders: 0, jobsOnHold: 0,
        activeJobs: 0, totalJobsTracked: 0, recentReminders: [], heldJobIds: [],
      });
    }

    const AR_AUTO_RE = /\[AR-AUTO\]/i;
    const AR_HOLD_RE = /\[AR-HOLD\]/i;
    const AR_RESUME_RE = /\[AR-RESUME\]/i;
    const TIER_RE = /\b(20-day|30-day|45-day|60-day)\b/i;

    // 2. Scan comments in parallel batches of 6
    const allResults: JobScanResult[] = [];
    const BATCH_SIZE = 6;

    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      const batch = jobs.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map(async (job): Promise<JobScanResult> => {
          const resp = await pave({
            job: {
              $: { id: job.id },
              comments: {
                $: { size: 50 },
                nodes: { id: {}, message: {}, createdAt: {}, name: {} },
              },
            },
          });
          const comments = (resp as any)?.job?.comments?.nodes || [];

          let reminderCount = 0;
          let lastHoldDate = 0;
          let lastResumeDate = 0;
          const reminders: ArStatRecord[] = [];

          for (const c of comments) {
            const text = (c.message || '') + ' ' + (c.name || '');

            if (AR_AUTO_RE.test(text)) {
              reminderCount++;
              const tierMatch = text.match(TIER_RE);
              reminders.push({
                jobId: job.id,
                jobName: job.name,
                tier: tierMatch ? tierMatch[1] : 'reminder',
                date: c.createdAt,
              });
            }
            if (AR_HOLD_RE.test(text)) {
              const d = new Date(c.createdAt).getTime();
              if (d > lastHoldDate) lastHoldDate = d;
            }
            if (AR_RESUME_RE.test(text)) {
              const d = new Date(c.createdAt).getTime();
              if (d > lastResumeDate) lastResumeDate = d;
            }
          }

          const isHeld = lastHoldDate > 0 && lastHoldDate > lastResumeDate;
          return { jobId: job.id, reminderCount, isHeld, reminders };
        })
      );

      for (const r of settled) {
        if (r.status === 'fulfilled') {
          allResults.push(r.value);
        }
      }
    }

    // 3. Aggregate results
    let totalRemindersSent = 0;
    let jobsWithReminders = 0;
    let jobsOnHold = 0;
    let activeJobCount = 0;
    const recentReminders: ArStatRecord[] = [];
    const heldJobIds: string[] = [];

    for (const r of allResults) {
      totalRemindersSent += r.reminderCount;
      if (r.reminderCount > 0) jobsWithReminders++;
      if (r.isHeld) {
        jobsOnHold++;
        heldJobIds.push(r.jobId);
      } else {
        activeJobCount++;
      }
      recentReminders.push(...r.reminders);
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
      heldJobIds,
    });
  } catch (err: any) {
    console.error('[AR-Stats] Error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

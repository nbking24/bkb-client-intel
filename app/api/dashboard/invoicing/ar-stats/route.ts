// ============================================================
// AR Stats — Returns aggregate AR reminder statistics
//
// GET → Scans all pending invoices and their job comments
//       to build a summary of automated AR reminders sent.
// ============================================================

import { NextResponse } from 'next/server';
import { pave } from '@/app/lib/jobtread';

export const runtime = 'nodejs';

interface ArStatRecord {
  jobId: string;
  jobName: string;
  tier: string;
  date: string;
  invoiceNumber?: string;
}

export async function GET() {
  try {
    // 1. Fetch all pending (sent but unpaid) invoices
    const docResp = await pave({
      documents: {
        $: {
          filter: {
            documentTypeId: { eq: 'invoice' },
            status: { eq: 'pending' },
          },
          size: 200,
          sort: [{ field: 'createdAt', order: 'desc' }],
        },
        nodes: {
          id: {},
          number: {},
          status: {},
          createdAt: {},
          job: { id: {}, name: {} },
        },
      },
    });

    const invoiceNodes = (docResp as any)?.documents?.nodes || [];

    // Build unique job IDs from invoices
    const jobMap = new Map<string, { jobName: string; invoiceNumbers: string[] }>();
    for (const inv of invoiceNodes) {
      const jId = inv?.job?.id;
      const jName = inv?.job?.name || 'Unknown';
      if (!jId) continue;
      const existing = jobMap.get(jId);
      if (existing) {
        existing.invoiceNumbers.push(inv.number || '');
      } else {
        jobMap.set(jId, { jobName: jName, invoiceNumbers: [inv.number || ''] });
      }
    }

    const jobIds = Array.from(jobMap.keys());

    // 2. For each job, scan comments for [AR-AUTO] and [AR-HOLD] tags
    let totalRemindersSent = 0;
    let jobsWithReminders = 0;
    let jobsOnHold = 0;
    let activeJobs = 0;
    const recentReminders: ArStatRecord[] = [];

    const AR_AUTO_RE = /\[AR-AUTO\]/i;
    const AR_HOLD_RE = /\[AR-HOLD\]/i;
    const AR_RESUME_RE = /\[AR-RESUME\]/i;
    const TIER_RE = /\b(20-day|30-day|45-day|60-day)\b/i;

    for (const jobId of jobIds) {
      const commentResp = await pave({
        job: {
          $: { id: jobId },
          comments: {
            $: { size: 100 },
            nodes: { id: {}, body: {}, createdAt: {} },
          },
        },
      });

      const comments = (commentResp as any)?.job?.comments?.nodes || [];
      const jobInfo = jobMap.get(jobId)!;

      let jobReminderCount = 0;
      let lastHoldDate = 0;
      let lastResumeDate = 0;

      for (const c of comments) {
        const body = (c.body || '');

        if (AR_AUTO_RE.test(body)) {
          jobReminderCount++;
          totalRemindersSent++;

          const tierMatch = body.match(TIER_RE);
          recentReminders.push({
            jobId,
            jobName: jobInfo.jobName,
            tier: tierMatch ? tierMatch[1] : 'unknown',
            date: c.createdAt,
            invoiceNumber: jobInfo.invoiceNumbers[0],
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
      else activeJobs++;
      if (jobReminderCount > 0) jobsWithReminders++;
    }

    // Sort recent reminders by date descending, take top 10
    recentReminders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({
      totalRemindersSent,
      jobsWithReminders,
      jobsOnHold,
      activeJobs,
      totalJobsTracked: jobIds.length,
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

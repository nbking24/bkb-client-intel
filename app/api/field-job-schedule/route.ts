// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { getJobSchedule } from '@/app/lib/jobtread';

/**
 * GET /api/field-job-schedule?jobId=XXX
 * Returns the schedule (phases + tasks) for a single job.
 * Used by the field dashboard to expand job cards on demand.
 */
export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 });
  }

  try {
    const schedule = await getJobSchedule(jobId);
    if (!schedule) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Return phases with their child tasks (simplified for field view)
    const phases = (schedule.phases || []).map((phase: any) => ({
      id: phase.id,
      name: phase.name,
      progress: phase.progress,
      startDate: phase.startDate || null,
      endDate: phase.endDate || null,
      tasks: (phase.childTasks?.nodes || [])
        .filter((t: any) => !t.isGroup)
        .map((t: any) => ({
          id: t.id,
          name: t.name,
          progress: t.progress,
          startDate: t.startDate || null,
          endDate: t.endDate || null,
        })),
    }));

    return NextResponse.json({
      jobId: schedule.id,
      jobName: schedule.name,
      jobNumber: schedule.number,
      totalProgress: schedule.totalProgress,
      phases,
    });
  } catch (err: any) {
    console.error('Field job schedule error:', err);
    return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 });
  }
}

// @ts-nocheck
/**
 * GET /api/dashboard/precon/schedule
 *
 * Returns every In-Design job along with its full task list, classified
 * into actionable buckets (active / upcoming / completed / undated) so
 * the Pre-Con calendar can render every scheduled item on one canvas
 * color-coded by job.
 *
 * The whole point is to let Nathan and Allison answer two questions
 * with one glance:
 *   1. "What's getting worked on across all in-design projects right now?"
 *   2. "Which projects have nothing currently scheduled?"
 *
 * Filters to status category IN_DESIGN only (JT custom status
 * "5. Design Phase"). Skips Final Billing, Production, Ready, and
 * Leads — those have their own dashboards.
 */
import { NextResponse } from 'next/server';
import { getActiveJobs, getTasksForJob } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Distinct color palette per job. Keeping it large enough for typical
// in-design caseload (~5-15 jobs) plus a wrap-around for the rare day
// the pipeline balloons. Pulled from a colorblind-friendly Tableau-ish
// palette with enough hue separation that bars on adjacent calendar
// days don't read as the same project.
const JOB_PALETTE = [
  '#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e',
  '#17becf', '#bcbd22', '#8c564b', '#e377c2', '#7f7f7f',
  '#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f97316',
];

function pickColor(index: number): string {
  return JOB_PALETTE[index % JOB_PALETTE.length];
}

/** Normalize JT date strings (YYYY-MM-DD or ISO) to a Date at local midnight. */
function dateOnly(s: string | null): Date | null {
  if (!s) return null;
  // JT task dates are YYYY-MM-DD; new Date('2026-06-24') parses as UTC midnight,
  // which means "today" comparisons can be off by a day for users east of UTC.
  // Take just the YYYY-MM-DD prefix and reconstruct locally.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function todayDate(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

interface ScheduleTask {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  progress: number;
  status: 'active' | 'upcoming' | 'completed' | 'undated';
}

interface JobSchedule {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  customStatus: string | null;
  color: string;
  tasks: ScheduleTask[];
  // Counts for quick KPI / flag rendering on the UI side.
  activeTaskCount: number;
  upcomingTaskCount: number;
  completedTaskCount: number;
  undatedTaskCount: number;
  // True if the job has zero tasks currently in flight (no startDate
  // <= today <= endDate, ignoring already-completed tasks). The AI
  // staleness check on the UI flags these for review.
  hasNoActiveWork: boolean;
}

function classifyTask(t: any, today: Date): ScheduleTask['status'] {
  const start = dateOnly(t.startDate);
  const end = dateOnly(t.endDate);
  const progress = Number(t.progress) || 0;
  if (progress >= 1) return 'completed';
  if (!start && !end) return 'undated';
  if (start && end) {
    if (today < start) return 'upcoming';
    if (today > end) {
      // Past end date but not marked complete - still treat as active
      // so it doesn't disappear from view; it's an overdue active task.
      return 'active';
    }
    return 'active';
  }
  // Only one date set - if it's in the future, upcoming; else active.
  const ref = start || end!;
  return today < ref ? 'upcoming' : 'active';
}

export async function GET() {
  try {
    const jobs = await getActiveJobs(500);
    const inDesign = jobs.filter((j: any) => j.statusCategory === 'IN_DESIGN');

    // Concurrency-limited task fetch so we don't slam PAVE.
    const BATCH = 4;
    const today = todayDate();
    const results: JobSchedule[] = [];

    for (let i = 0; i < inDesign.length; i += BATCH) {
      const slice = inDesign.slice(i, i + BATCH);
      const batch = await Promise.all(
        slice.map(async (job: any, idxInSlice: number) => {
          try {
            const tasks = await getTasksForJob(job.id);
            // JT's "isGroup" rows are headers, not real tasks - drop them
            // so the calendar doesn't show "Phase 5: Design" as a chip.
            const realTasks = tasks.filter((t: any) => !t.isGroup);
            const classified: ScheduleTask[] = realTasks.map((t: any) => ({
              id: t.id,
              name: t.name || '(unnamed)',
              startDate: t.startDate || null,
              endDate: t.endDate || null,
              progress: Number(t.progress) || 0,
              status: classifyTask(t, today),
            }));

            const activeCount = classified.filter((t) => t.status === 'active').length;
            const upcomingCount = classified.filter((t) => t.status === 'upcoming').length;
            const completedCount = classified.filter((t) => t.status === 'completed').length;
            const undatedCount = classified.filter((t) => t.status === 'undated').length;

            return {
              jobId: job.id,
              jobName: job.name,
              jobNumber: job.number || '',
              clientName: job.clientName || '',
              customStatus: job.customStatus || null,
              color: '', // filled in below using the job's global index
              tasks: classified,
              activeTaskCount: activeCount,
              upcomingTaskCount: upcomingCount,
              completedTaskCount: completedCount,
              undatedTaskCount: undatedCount,
              hasNoActiveWork: activeCount === 0,
            } as JobSchedule;
          } catch (err: any) {
            console.error(`[precon/schedule] job ${job.id} failed:`, err?.message || err);
            return null;
          }
        }),
      );
      results.push(...batch.filter(Boolean));
    }

    // Sort A-Z by client name (tiebreak by job name) so the legend
    // order is stable across reloads and matches what the rest of the
    // precon dashboard uses.
    results.sort((a, b) => {
      const aKey = (a.clientName || a.jobName || '').toLowerCase().trim();
      const bKey = (b.clientName || b.jobName || '').toLowerCase().trim();
      if (aKey !== bKey) return aKey.localeCompare(bKey);
      return (a.jobName || '').toLowerCase().localeCompare((b.jobName || '').toLowerCase());
    });
    // Assign palette colors AFTER sorting so the same job keeps its
    // color across loads (deterministic from sort order).
    results.forEach((r, idx) => {
      r.color = pickColor(idx);
    });

    const totals = results.reduce(
      (acc, j) => {
        acc.activeTaskCount += j.activeTaskCount;
        acc.upcomingTaskCount += j.upcomingTaskCount;
        acc.completedTaskCount += j.completedTaskCount;
        acc.undatedTaskCount += j.undatedTaskCount;
        if (j.hasNoActiveWork) acc.jobsWithNoActiveWork += 1;
        return acc;
      },
      {
        jobCount: results.length,
        activeTaskCount: 0,
        upcomingTaskCount: 0,
        completedTaskCount: 0,
        undatedTaskCount: 0,
        jobsWithNoActiveWork: 0,
      },
    );

    return NextResponse.json({
      computedAt: new Date().toISOString(),
      totals,
      jobs: results,
    });
  } catch (err: any) {
    console.error('[precon/schedule] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to load schedules' }, { status: 500 });
  }
}

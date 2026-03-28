// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth, isFieldStaffRole } from '../../lib/auth';
import { getActiveJobs, getTasksForJob, getOpenTasksForMember } from '@/app/lib/jobtread';
import { TEAM_USERS } from '@/app/lib/constants';

/**
 * GET /api/field-dashboard
 * Returns personalized field staff dashboard data:
 * - Tasks assigned to this user across all active jobs (today + upcoming)
 * - Simple AI briefing text
 */
export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;
  if (!userId) {
    return NextResponse.json({ error: 'No user ID' }, { status: 400 });
  }

  const user = TEAM_USERS[userId];
  if (!user) {
    return NextResponse.json({ error: 'Unknown user' }, { status: 400 });
  }

  try {
    // Fetch all open tasks for this user's membership ID
    const membershipId = user.membershipId;
    const [memberTasks, activeJobs] = await Promise.all([
      getOpenTasksForMember(membershipId).catch(() => []),
      getActiveJobs(20).catch(() => []),
    ]);

    // Build a job name map for enrichment
    const jobMap = new Map<string, any>();
    for (const job of activeJobs) {
      jobMap.set(job.id, job);
    }

    // Categorize tasks
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    const weekStr = weekFromNow.toISOString().split('T')[0];

    const todayTasks: any[] = [];
    const overdueTasks: any[] = [];
    const upcomingTasks: any[] = [];
    const otherTasks: any[] = [];

    for (const task of memberTasks) {
      const enriched = {
        id: task.id,
        name: task.name,
        progress: task.progress,
        startDate: task.startDate || null,
        endDate: task.endDate || null,
        jobName: task.jobName || jobMap.get(task.jobId)?.name || 'Unknown Job',
        jobNumber: task.jobNumber || jobMap.get(task.jobId)?.number || '',
        jobId: task.jobId,
      };

      if (!task.endDate) {
        otherTasks.push(enriched);
      } else if (task.endDate < todayStr) {
        overdueTasks.push(enriched);
      } else if (task.endDate === todayStr) {
        todayTasks.push(enriched);
      } else if (task.endDate <= weekStr) {
        upcomingTasks.push(enriched);
      } else {
        otherTasks.push(enriched);
      }
    }

    // Sort each category by due date
    const byDate = (a: any, b: any) => (a.endDate || '9999').localeCompare(b.endDate || '9999');
    overdueTasks.sort(byDate);
    todayTasks.sort(byDate);
    upcomingTasks.sort(byDate);

    // Generate simple briefing
    const totalOpen = memberTasks.length;
    const overdueCount = overdueTasks.length;
    const todayCount = todayTasks.length;
    const upcomingCount = upcomingTasks.length;

    let briefing = '';
    if (totalOpen === 0) {
      briefing = 'No open tasks assigned to you right now. Check with Nathan if you need new assignments.';
    } else {
      const parts: string[] = [];
      if (overdueCount > 0) parts.push(overdueCount + ' overdue task' + (overdueCount > 1 ? 's' : '') + ' need attention');
      if (todayCount > 0) parts.push(todayCount + ' task' + (todayCount > 1 ? 's' : '') + ' due today');
      if (upcomingCount > 0) parts.push(upcomingCount + ' task' + (upcomingCount > 1 ? 's' : '') + ' coming up this week');
      briefing = 'You have ' + totalOpen + ' open task' + (totalOpen > 1 ? 's' : '') + '. ' + parts.join(', ') + '.';
    }

    return NextResponse.json({
      userName: user.name,
      briefing,
      stats: { total: totalOpen, overdue: overdueCount, today: todayCount, upcoming: upcomingCount },
      overdueTasks,
      todayTasks,
      upcomingTasks,
      otherTasks: otherTasks.slice(0, 20),
      activeJobCount: activeJobs.length,
    });
  } catch (err: any) {
    console.error('Field dashboard error:', err);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}

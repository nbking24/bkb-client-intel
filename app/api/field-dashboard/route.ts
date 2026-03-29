// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth, isFieldStaffRole } from '../lib/auth';
import { getActiveJobs, getTasksForJob } from '@/app/lib/jobtread';
import { TEAM_USERS } from '@/app/lib/constants';

/**
 * GET /api/field-dashboard
 * Returns personalized field staff dashboard data:
 * - Active jobs where user is PM
 * - 2-week calendar of scheduled tasks per job (color-coded)
 * - Brief AI-generated summary of what's upcoming
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
    // Fetch active jobs
    const activeJobs = await getActiveJobs(50).catch(() => []);

    // Filter active jobs to only those where this user is PM
    const userPmName = user.name;
    const myJobs = activeJobs.filter((j: any) => j.projectManager === userPmName);

    // Build date boundaries: start of this week (Monday) through 2 weeks out
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Find Monday of this week
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    // 2 weeks from Monday = 14 days
    const twoWeeksOut = new Date(weekStart);
    twoWeeksOut.setDate(weekStart.getDate() + 13);
    const twoWeeksStr = twoWeeksOut.toISOString().split('T')[0];

    // Fetch tasks for each PM job in parallel
    const jobTaskPromises = myJobs.map(async (job: any) => {
      try {
        const tasks = await getTasksForJob(job.id);
        return { jobId: job.id, tasks };
      } catch {
        return { jobId: job.id, tasks: [] };
      }
    });
    const jobTaskResults = await Promise.all(jobTaskPromises);

    // Build calendar entries: tasks with dates in the 2-week window
    // Also collect overdue tasks (endDate before today, not complete)
    const calendarTasks: any[] = [];
    const overdueTasks: any[] = [];

    for (const { jobId, tasks } of jobTaskResults) {
      const job = myJobs.find((j: any) => j.id === jobId);
      if (!job) continue;

      for (const task of tasks) {
        if (task.isGroup) continue; // Skip group/phase headers
        const isComplete = task.progress !== null && task.progress >= 1;

        // Use endDate or startDate for calendar placement
        const taskDate = task.endDate || task.startDate;
        if (!taskDate) continue;
        const dateStr = taskDate.split('T')[0];

        // Overdue: before today and not complete
        if (dateStr < todayStr && !isComplete) {
          overdueTasks.push({
            id: task.id,
            name: task.name,
            date: dateStr,
            progress: task.progress,
            jobId: job.id,
            jobName: job.name,
            jobNumber: job.number,
          });
          continue;
        }

        // In the 2-week window
        if (dateStr >= weekStartStr && dateStr <= twoWeeksStr) {
          calendarTasks.push({
            id: task.id,
            name: task.name,
            date: dateStr,
            startDate: task.startDate ? task.startDate.split('T')[0] : null,
            endDate: task.endDate ? task.endDate.split('T')[0] : null,
            progress: task.progress,
            isComplete,
            jobId: job.id,
            jobName: job.name,
            jobNumber: job.number,
          });
        }
      }
    }

    // Sort calendar tasks by date, then job
    calendarTasks.sort((a, b) => a.date.localeCompare(b.date) || a.jobName.localeCompare(b.jobName));
    overdueTasks.sort((a, b) => a.date.localeCompare(b.date));

    // Generate briefing
    const totalCal = calendarTasks.filter(t => !t.isComplete).length;
    const todayTasks = calendarTasks.filter(t => t.date === todayStr && !t.isComplete);
    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
    const tomorrowTasks = calendarTasks.filter(t => t.date === tomorrowStr && !t.isComplete);

    let briefing = '';
    const parts: string[] = [];
    if (overdueTasks.length > 0) {
      parts.push(`${overdueTasks.length} overdue item${overdueTasks.length > 1 ? 's' : ''} need attention`);
    }
    if (todayTasks.length > 0) {
      parts.push(`${todayTasks.length} task${todayTasks.length > 1 ? 's' : ''} scheduled today`);
    }
    if (tomorrowTasks.length > 0) {
      parts.push(`${tomorrowTasks.length} task${tomorrowTasks.length > 1 ? 's' : ''} tomorrow`);
    }
    if (parts.length > 0) {
      briefing = parts.join(' · ') + `. ${totalCal} total across ${myJobs.length} active job${myJobs.length > 1 ? 's' : ''} over the next two weeks.`;
    } else if (myJobs.length > 0) {
      briefing = `${myJobs.length} active job${myJobs.length > 1 ? 's' : ''}, no tasks scheduled in the next two weeks.`;
    } else {
      briefing = 'No active jobs assigned to you right now.';
    }

    return NextResponse.json({
      userName: user.name,
      briefing,
      weekStartDate: weekStartStr,
      todayDate: todayStr,
      overdueTasks: overdueTasks.slice(0, 15),
      calendarTasks,
      activeJobs: myJobs.map((j: any) => ({
        id: j.id,
        name: j.name,
        number: j.number,
        clientName: j.clientName || '',
        customStatus: j.customStatus || null,
      })),
    });
  } catch (err: any) {
    console.error('Field dashboard error:', err);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}

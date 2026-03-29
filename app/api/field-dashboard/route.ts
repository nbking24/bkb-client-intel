// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth, isFieldStaffRole } from '../lib/auth';
import { getActiveJobs, getTasksForJob, getOpenTasksForMember } from '@/app/lib/jobtread';
import { TEAM_USERS } from '@/app/lib/constants';

/**
 * GET /api/field-dashboard
 * Returns personalized field staff dashboard data:
 * - AI briefing text summarizing what needs attention
 * - 2-week calendar of scheduled tasks per job (color-coded)
 * - Open tasks assigned to this user (collapsible list)
 * - Overdue tasks
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
    const membershipId = user.membershipId;

    // Fetch active jobs + open tasks for this member in parallel
    const [activeJobs, memberTasks] = await Promise.all([
      getActiveJobs(50).catch(() => []),
      getOpenTasksForMember(membershipId).catch(() => []),
    ]);

    // Filter active jobs to only those where this user is PM
    const userPmName = user.name;
    const myJobs = activeJobs.filter((j: any) => j.projectManager === userPmName);
    const myJobIds = new Set(myJobs.map((j: any) => j.id));

    // Build date boundaries
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const twoWeeksOut = new Date(weekStart);
    twoWeeksOut.setDate(weekStart.getDate() + 13);
    const twoWeeksStr = twoWeeksOut.toISOString().split('T')[0];

    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];

    // Fetch tasks for each PM job in parallel (for calendar)
    const jobTaskPromises = myJobs.map(async (job: any) => {
      try {
        const tasks = await getTasksForJob(job.id);
        return { jobId: job.id, tasks };
      } catch {
        return { jobId: job.id, tasks: [] };
      }
    });
    const jobTaskResults = await Promise.all(jobTaskPromises);

    // Build calendar entries + overdue
    const calendarTasks: any[] = [];
    const overdueTasks: any[] = [];

    for (const { jobId, tasks } of jobTaskResults) {
      const job = myJobs.find((j: any) => j.id === jobId);
      if (!job) continue;

      for (const task of tasks) {
        if (task.isGroup) continue;
        const isComplete = task.progress !== null && task.progress >= 1;
        const taskDate = task.endDate || task.startDate;
        if (!taskDate) continue;
        const dateStr = taskDate.split('T')[0];

        if (dateStr < todayStr && !isComplete) {
          overdueTasks.push({
            id: task.id, name: task.name, date: dateStr,
            progress: task.progress,
            jobId: job.id, jobName: job.name, jobNumber: job.number,
          });
          continue;
        }

        if (dateStr >= weekStartStr && dateStr <= twoWeeksStr) {
          calendarTasks.push({
            id: task.id, name: task.name, date: dateStr,
            startDate: task.startDate ? task.startDate.split('T')[0] : null,
            endDate: task.endDate ? task.endDate.split('T')[0] : null,
            progress: task.progress, isComplete,
            jobId: job.id, jobName: job.name, jobNumber: job.number,
          });
        }
      }
    }

    calendarTasks.sort((a, b) => a.date.localeCompare(b.date) || a.jobName.localeCompare(b.jobName));
    overdueTasks.sort((a, b) => a.date.localeCompare(b.date));

    // Process member's open tasks (assigned to Evan)
    const jobMap = new Map<string, any>();
    for (const job of myJobs) jobMap.set(job.id, job);

    const openTasks = memberTasks.map((t: any) => {
      const jobInfo = t.job ? jobMap.get(t.job.id) || t.job : null;
      return {
        id: t.id,
        name: t.name,
        endDate: t.endDate || null,
        progress: t.progress,
        jobName: jobInfo?.name || t.job?.name || 'Unknown',
        jobNumber: jobInfo?.number || t.job?.number || '',
        jobId: t.job?.id || '',
      };
    }).sort((a: any, b: any) => {
      // Sort: overdue first, then by date
      if (!a.endDate && !b.endDate) return 0;
      if (!a.endDate) return 1;
      if (!b.endDate) return -1;
      return a.endDate.localeCompare(b.endDate);
    });

    // Count task categories for briefing
    const todayCalTasks = calendarTasks.filter(t => t.date === todayStr && !t.isComplete);
    const tomorrowCalTasks = calendarTasks.filter(t => t.date === tomorrowStr && !t.isComplete);
    const thisWeekTasks = calendarTasks.filter(t => {
      const weekEndStr = new Date(weekStart.getTime() + 6 * 86400000).toISOString().split('T')[0];
      return t.date >= todayStr && t.date <= weekEndStr && !t.isComplete;
    });

    // Build AI briefing — contextual based on time of day
    const hour = new Date().getHours();
    const briefingParts: string[] = [];

    if (hour < 12) {
      // Morning briefing
      if (todayCalTasks.length > 0) {
        const taskNames = todayCalTasks.slice(0, 3).map(t => t.name);
        briefingParts.push(`Today: ${taskNames.join(', ')}${todayCalTasks.length > 3 ? ` and ${todayCalTasks.length - 3} more` : ''}.`);
      } else {
        briefingParts.push('No scheduled tasks today.');
      }
      if (overdueTasks.length > 0) {
        briefingParts.push(`${overdueTasks.length} overdue item${overdueTasks.length > 1 ? 's' : ''} need attention.`);
      }
      if (tomorrowCalTasks.length > 0) {
        briefingParts.push(`Tomorrow has ${tomorrowCalTasks.length} task${tomorrowCalTasks.length > 1 ? 's' : ''} scheduled.`);
      }
    } else if (hour < 17) {
      // Afternoon
      if (todayCalTasks.length > 0) {
        briefingParts.push(`${todayCalTasks.length} task${todayCalTasks.length > 1 ? 's' : ''} still scheduled today.`);
      }
      if (overdueTasks.length > 0) {
        briefingParts.push(`${overdueTasks.length} overdue item${overdueTasks.length > 1 ? 's' : ''} pending.`);
      }
      if (tomorrowCalTasks.length > 0) {
        const names = tomorrowCalTasks.slice(0, 2).map(t => t.name);
        briefingParts.push(`Tomorrow: ${names.join(', ')}${tomorrowCalTasks.length > 2 ? ` +${tomorrowCalTasks.length - 2} more` : ''}.`);
      }
    } else {
      // Evening prep
      if (tomorrowCalTasks.length > 0) {
        const names = tomorrowCalTasks.slice(0, 3).map(t => t.name);
        briefingParts.push(`Tomorrow: ${names.join(', ')}${tomorrowCalTasks.length > 3 ? ` and ${tomorrowCalTasks.length - 3} more` : ''}.`);
      } else {
        briefingParts.push('Nothing scheduled tomorrow.');
      }
      if (overdueTasks.length > 0) {
        briefingParts.push(`${overdueTasks.length} overdue item${overdueTasks.length > 1 ? 's' : ''} to address.`);
      }
    }

    // Add job-level context
    const jobsWithUpcoming = myJobs.filter((j: any) =>
      calendarTasks.some(t => t.jobId === j.id && !t.isComplete)
    );
    if (jobsWithUpcoming.length > 0) {
      const jobNames = jobsWithUpcoming.slice(0, 3).map((j: any) => j.name.split(' ').slice(0, 2).join(' '));
      briefingParts.push(`Active this period: ${jobNames.join(', ')}${jobsWithUpcoming.length > 3 ? ` +${jobsWithUpcoming.length - 3} more` : ''}.`);
    }

    briefingParts.push(`${myJobs.length} total active job${myJobs.length > 1 ? 's' : ''} · ${openTasks.length} open task${openTasks.length > 1 ? 's' : ''} assigned to you.`);

    return NextResponse.json({
      userName: user.name,
      briefing: briefingParts.join(' '),
      weekStartDate: weekStartStr,
      todayDate: todayStr,
      overdueTasks: overdueTasks.slice(0, 15),
      calendarTasks,
      openTasks,
      activeJobCount: myJobs.length,
    });
  } catch (err: any) {
    console.error('Field dashboard error:', err);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}

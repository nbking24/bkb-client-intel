// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { getActiveJobs, getTasksForJob, getOpenTasksForMember, updateTaskProgress } from '@/app/lib/jobtread';
import { TEAM_USERS } from '@/app/lib/constants';

/**
 * GET /api/field-dashboard
 * Forward-looking 2-week calendar, AI briefing, open/overdue tasks
 *
 * PATCH /api/field-dashboard
 * Mark a task complete or incomplete: { taskId, complete: boolean }
 */
export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = auth.userId;
  if (!userId) return NextResponse.json({ error: 'No user ID' }, { status: 400 });
  const user = TEAM_USERS[userId];
  if (!user) return NextResponse.json({ error: 'Unknown user' }, { status: 400 });

  try {
    const membershipId = user.membershipId;
    const [activeJobs, memberTasks] = await Promise.all([
      getActiveJobs(50).catch(() => []),
      getOpenTasksForMember(membershipId).catch(() => []),
    ]);

    const userPmName = user.name;
    const myJobs = activeJobs.filter((j: any) => j.projectManager === userPmName);

    // Date boundaries
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];

    // Forward-looking: upcoming Monday (if today is Mon, use today; otherwise next Mon)
    const dow = today.getDay(); // 0=Sun
    let upcomingMonday: Date;
    if (dow === 1) {
      upcomingMonday = new Date(today); // today is Monday
    } else if (dow === 0) {
      upcomingMonday = new Date(today.getTime() + 86400000); // tomorrow is Monday
    } else {
      upcomingMonday = new Date(today.getTime() + (8 - dow) * 86400000); // next Monday
    }
    const week1Start = upcomingMonday.toISOString().split('T')[0];
    const week2End = new Date(upcomingMonday.getTime() + 13 * 86400000).toISOString().split('T')[0];

    // Build set of member-assigned task IDs for highlighting
    const myTaskIds = new Set(memberTasks.map((t: any) => t.id));

    // Fetch tasks per PM job
    const jobTaskResults = await Promise.all(
      myJobs.map(async (job: any) => {
        try {
          return { jobId: job.id, tasks: await getTasksForJob(job.id) };
        } catch {
          return { jobId: job.id, tasks: [] };
        }
      })
    );

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

        // Overdue: before today and not complete
        if (dateStr < todayStr && !isComplete) {
          overdueTasks.push({
            id: task.id, name: task.name, date: dateStr,
            progress: task.progress,
            jobId: job.id, jobName: job.name, jobNumber: job.number,
            isAssignedToMe: myTaskIds.has(task.id),
          });
          continue;
        }

        // In 2-week forward window
        if (dateStr >= week1Start && dateStr <= week2End) {
          calendarTasks.push({
            id: task.id, name: task.name, date: dateStr,
            startDate: task.startDate ? task.startDate.split('T')[0] : null,
            endDate: task.endDate ? task.endDate.split('T')[0] : null,
            progress: task.progress, isComplete,
            jobId: job.id, jobName: job.name, jobNumber: job.number,
            isAssignedToMe: myTaskIds.has(task.id),
          });
        }
      }
    }

    calendarTasks.sort((a, b) => a.date.localeCompare(b.date) || a.jobName.localeCompare(b.jobName));
    overdueTasks.sort((a, b) => a.date.localeCompare(b.date));

    // Open tasks assigned to user
    const jobMap = new Map<string, any>();
    for (const job of myJobs) jobMap.set(job.id, job);

    const openTasks = memberTasks.map((t: any) => {
      const jobInfo = t.job ? jobMap.get(t.job.id) || t.job : null;
      return {
        id: t.id, name: t.name, endDate: t.endDate || null,
        progress: t.progress,
        jobName: jobInfo?.name || t.job?.name || 'Unknown',
        jobNumber: jobInfo?.number || t.job?.number || '',
        jobId: t.job?.id || '',
      };
    }).sort((a: any, b: any) => {
      if (!a.endDate && !b.endDate) return 0;
      if (!a.endDate) return 1;
      if (!b.endDate) return -1;
      return a.endDate.localeCompare(b.endDate);
    });

    // Briefing
    const hour = new Date().getHours();
    const week1EndStr = new Date(upcomingMonday.getTime() + 6 * 86400000).toISOString().split('T')[0];
    const week1Tasks = calendarTasks.filter(t => t.date <= week1EndStr && !t.isComplete);
    const myWeek1Tasks = week1Tasks.filter(t => t.isAssignedToMe);
    const todayCalTasks = calendarTasks.filter(t => t.date === todayStr && !t.isComplete);
    const tomorrowCalTasks = calendarTasks.filter(t => t.date === tomorrowStr && !t.isComplete);
    const parts: string[] = [];

    if (hour < 12) {
      if (todayCalTasks.length > 0) {
        parts.push(`Today: ${todayCalTasks.slice(0, 3).map(t => t.name).join(', ')}${todayCalTasks.length > 3 ? ` +${todayCalTasks.length - 3} more` : ''}.`);
      }
      if (overdueTasks.length > 0) parts.push(`${overdueTasks.length} overdue item${overdueTasks.length > 1 ? 's' : ''} need attention.`);
      if (tomorrowCalTasks.length > 0) parts.push(`${tomorrowCalTasks.length} task${tomorrowCalTasks.length > 1 ? 's' : ''} tomorrow.`);
    } else if (hour < 17) {
      if (overdueTasks.length > 0) parts.push(`${overdueTasks.length} overdue item${overdueTasks.length > 1 ? 's' : ''} pending.`);
      if (tomorrowCalTasks.length > 0) {
        parts.push(`Tomorrow: ${tomorrowCalTasks.slice(0, 2).map(t => t.name).join(', ')}${tomorrowCalTasks.length > 2 ? ` +${tomorrowCalTasks.length - 2} more` : ''}.`);
      }
    } else {
      if (tomorrowCalTasks.length > 0) {
        parts.push(`Tomorrow: ${tomorrowCalTasks.slice(0, 3).map(t => t.name).join(', ')}${tomorrowCalTasks.length > 3 ? ` +${tomorrowCalTasks.length - 3}` : ''}.`);
      }
      if (overdueTasks.length > 0) parts.push(`${overdueTasks.length} overdue to address.`);
    }

    if (myWeek1Tasks.length > 0) {
      parts.push(`${myWeek1Tasks.length} task${myWeek1Tasks.length > 1 ? 's' : ''} assigned to you next week.`);
    }
    parts.push(`${myJobs.length} active jobs · ${openTasks.length} open tasks.`);

    return NextResponse.json({
      userName: user.name,
      briefing: parts.join(' '),
      week1Start: week1Start,
      todayDate: todayStr,
      overdueTasks: overdueTasks.slice(0, 20),
      calendarTasks,
      openTasks,
      activeJobCount: myJobs.length,
    });
  } catch (err: any) {
    console.error('Field dashboard error:', err);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}

/** PATCH: mark task complete/incomplete */
export async function PATCH(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { taskId, complete } = await req.json();
    if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 });
    await updateTaskProgress(taskId, complete ? 1 : 0);
    return NextResponse.json({ ok: true, taskId, progress: complete ? 1 : 0 });
  } catch (err: any) {
    console.error('Task update error:', err);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

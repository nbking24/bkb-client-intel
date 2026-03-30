// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { getActiveJobs, getTasksForJob, getOpenTasksForMember, updateTaskProgress, updateTask } from '@/app/lib/jobtread';
import { TEAM_USERS } from '@/app/lib/constants';

/**
 * GET /api/field-dashboard
 * Forward-looking 2-week calendar, AI briefing, open/overdue tasks
 *
 * PATCH /api/field-dashboard
 * Mark task complete/incomplete: { taskId, complete: boolean }
 * Update task date: { taskId, endDate: string }
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
    const dayAfterStr = new Date(today.getTime() + 2 * 86400000).toISOString().split('T')[0];

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
    const jobOverdueTasks: any[] = [];  // ALL overdue tasks across PM jobs
    const myOverdueTasks: any[] = [];   // Only overdue tasks assigned to user

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
          const overdueItem = {
            id: task.id, name: task.name, date: dateStr,
            progress: task.progress,
            jobId: job.id, jobName: job.name, jobNumber: job.number,
            isAssignedToMe: myTaskIds.has(task.id),
          };
          jobOverdueTasks.push(overdueItem);
          if (myTaskIds.has(task.id)) {
            myOverdueTasks.push(overdueItem);
          }
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
    jobOverdueTasks.sort((a, b) => a.date.localeCompare(b.date));
    myOverdueTasks.sort((a, b) => a.date.localeCompare(b.date));

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

    // ── BRIEFING: schedule-focused, prep-oriented ──
    const hour = new Date().getHours();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayCalTasks = calendarTasks.filter(t => t.date === todayStr && !t.isComplete);
    const tomorrowCalTasks = calendarTasks.filter(t => t.date === tomorrowStr && !t.isComplete);
    const dayAfterTasks = calendarTasks.filter(t => t.date === dayAfterStr && !t.isComplete);
    const tomorrowDow = new Date(today.getTime() + 86400000).getDay();
    const dayAfterDow = new Date(today.getTime() + 2 * 86400000).getDay();

    function taskWithJob(t: any) {
      return `${t.name} at ${t.jobName.replace(/^#\d+\s*/, '')}`;
    }
    function taskListNarrative(tasks: any[], limit = 3) {
      if (tasks.length === 0) return '';
      const shown = tasks.slice(0, limit).map(taskWithJob);
      const extra = tasks.length > limit ? ` and ${tasks.length - limit} more` : '';
      return shown.join(', ') + extra;
    }

    const parts: string[] = [];

    if (hour < 12) {
      // MORNING: focus on today + peek at tomorrow
      if (todayCalTasks.length > 0) {
        parts.push(`On deck today: ${taskListNarrative(todayCalTasks)}.`);
      } else {
        parts.push('Nothing scheduled for today.');
      }
      if (tomorrowCalTasks.length > 0) {
        parts.push(`${dayNames[tomorrowDow]}: ${taskListNarrative(tomorrowCalTasks, 2)}.`);
      }
    } else if (hour < 17) {
      // AFTERNOON: remaining today + tomorrow preview
      if (todayCalTasks.length > 0) {
        parts.push(`Still on today's schedule: ${taskListNarrative(todayCalTasks, 2)}.`);
      }
      if (tomorrowCalTasks.length > 0) {
        parts.push(`Tomorrow: ${taskListNarrative(tomorrowCalTasks)}.`);
      }
    } else {
      // EVENING: prep for tomorrow + look ahead
      if (tomorrowCalTasks.length > 0) {
        parts.push(`Tomorrow's schedule: ${taskListNarrative(tomorrowCalTasks)}.`);
      } else {
        parts.push(`Nothing scheduled for tomorrow.`);
      }
      if (dayAfterTasks.length > 0) {
        parts.push(`${dayNames[dayAfterDow]}: ${taskListNarrative(dayAfterTasks, 2)}.`);
      }
    }

    // Add a heads-up if upcoming week has key milestones
    const week1EndStr = new Date(upcomingMonday.getTime() + 6 * 86400000).toISOString().split('T')[0];
    const myWeek1Tasks = calendarTasks.filter(t => t.date >= week1Start && t.date <= week1EndStr && !t.isComplete && t.isAssignedToMe);
    if (myWeek1Tasks.length > 0) {
      parts.push(`${myWeek1Tasks.length} task${myWeek1Tasks.length > 1 ? 's' : ''} assigned to you this upcoming week.`);
    }

    return NextResponse.json({
      userName: user.name,
      briefing: parts.join(' '),
      week1Start: week1Start,
      todayDate: todayStr,
      jobOverdueTasks: jobOverdueTasks.slice(0, 40),
      myOverdueTasks: myOverdueTasks.slice(0, 20),
      calendarTasks,
      openTasks,
      activeJobCount: myJobs.length,
    });
  } catch (err: any) {
    console.error('Field dashboard error:', err);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}

/** PATCH: mark task complete/incomplete OR update task date */
export async function PATCH(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const { taskId, complete, endDate } = body;
    if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 });

    // Date update
    if (endDate !== undefined) {
      await updateTask(taskId, { endDate });
      return NextResponse.json({ ok: true, taskId, endDate });
    }

    // Completion toggle
    if (complete !== undefined) {
      await updateTaskProgress(taskId, complete ? 1 : 0);
      return NextResponse.json({ ok: true, taskId, progress: complete ? 1 : 0 });
    }

    return NextResponse.json({ error: 'No action specified' }, { status: 400 });
  } catch (err: any) {
    console.error('Task update error:', err);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

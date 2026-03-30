// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { getActiveJobs, getTasksForJob, getOpenTasksForMember, updateTaskProgress, updateTask, getCommentsForTarget } from '@/app/lib/jobtread';
import { TEAM_USERS } from '@/app/lib/constants';

/**
 * GET /api/field-dashboard
 * Forward-looking 2-week calendar, AI briefing with recent job comms, open/overdue tasks
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
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
    const dayAfterStr = new Date(today.getTime() + 2 * 86400000).toISOString().split('T')[0];

    // Forward-looking: upcoming Monday
    const dow = today.getDay();
    let upcomingMonday: Date;
    if (dow === 1) upcomingMonday = new Date(today);
    else if (dow === 0) upcomingMonday = new Date(today.getTime() + 86400000);
    else upcomingMonday = new Date(today.getTime() + (8 - dow) * 86400000);
    const week1Start = upcomingMonday.toISOString().split('T')[0];
    const week2End = new Date(upcomingMonday.getTime() + 13 * 86400000).toISOString().split('T')[0];

    const myTaskIds = new Set(memberTasks.map((t: any) => t.id));

    // Fetch tasks AND recent comments per PM job in parallel
    const jobDataResults = await Promise.all(
      myJobs.map(async (job: any) => {
        const [tasks, comments] = await Promise.all([
          getTasksForJob(job.id).catch(() => []),
          getCommentsForTarget(job.id, 'job', 15).catch(() => []),
        ]);
        return { jobId: job.id, tasks, comments };
      })
    );

    const calendarTasks: any[] = [];
    const jobOverdueTasks: any[] = []; // overdue on PM jobs, NOT assigned to Evan
    const myOverdueTasks: any[] = [];  // overdue AND assigned to Evan
    const myUpcomingTasks: any[] = []; // assigned to Evan, NOT overdue

    // Collect recent comments (last 30 days) across all jobs
    const cutoffTime = now.getTime() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
    const recentComments: any[] = [];

    for (const { jobId, tasks, comments } of jobDataResults) {
      const job = myJobs.find((j: any) => j.id === jobId);
      if (!job) continue;

      // Process tasks
      for (const task of tasks) {
        if (task.isGroup) continue;
        const isComplete = task.progress !== null && task.progress >= 1;
        const taskDate = task.endDate || task.startDate;
        if (!taskDate) continue;
        const dateStr = taskDate.split('T')[0];

        if (dateStr < todayStr && !isComplete) {
          const overdueItem = {
            id: task.id, name: task.name, date: dateStr,
            progress: task.progress,
            jobId: job.id, jobName: job.name, jobNumber: job.number,
            isAssignedToMe: myTaskIds.has(task.id),
          };
          if (myTaskIds.has(task.id)) {
            myOverdueTasks.push(overdueItem);
          } else {
            jobOverdueTasks.push(overdueItem); // PM job overdue but NOT assigned to Evan
          }
          continue;
        }

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

      // Collect recent comments for this job
      for (const c of comments) {
        if (!c.createdAt) continue;
        const commentTime = new Date(c.createdAt).getTime();
        if (commentTime >= cutoffTime) {
          recentComments.push({
            id: c.id,
            message: c.message || '',
            author: c.name && c.name !== 'Unknown' ? c.name : '',
            createdAt: c.createdAt,
            jobId: job.id,
            jobName: job.name,
            jobNumber: job.number,
          });
        }
      }
    }

    calendarTasks.sort((a, b) => a.date.localeCompare(b.date) || a.jobName.localeCompare(b.jobName));
    jobOverdueTasks.sort((a, b) => a.date.localeCompare(b.date));
    myOverdueTasks.sort((a, b) => a.date.localeCompare(b.date));
    // Sort comments newest first
    recentComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Upcoming tasks assigned to user (not overdue)
    const jobMap = new Map<string, any>();
    for (const job of myJobs) jobMap.set(job.id, job);

    // Add any overdue memberTasks not already captured from PM job loop
    const myOverdueIds = new Set(myOverdueTasks.map((t: any) => t.id));
    for (const t of memberTasks) {
      const ed = t.endDate ? t.endDate.split('T')[0] : null;
      if (ed && ed < todayStr && !myOverdueIds.has(t.id)) {
        const jobInfo = t.job ? jobMap.get(t.job.id) || t.job : null;
        myOverdueTasks.push({
          id: t.id, name: t.name, date: ed,
          progress: t.progress,
          jobId: t.job?.id || '', jobName: jobInfo?.name || t.job?.name || 'Unknown',
          jobNumber: jobInfo?.number || t.job?.number || '',
          isAssignedToMe: true,
        });
        myOverdueIds.add(t.id);
      }
    }
    myOverdueTasks.sort((a: any, b: any) => a.date.localeCompare(b.date));

    // Upcoming = assigned to Evan, NOT overdue
    const myUpcomingFromMember = memberTasks
      .filter((t: any) => {
        if (myOverdueIds.has(t.id)) return false;
        const ed = t.endDate ? t.endDate.split('T')[0] : null;
        if (ed && ed < todayStr) return false;
        return true;
      })
      .map((t: any) => {
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

    // PM jobs list for quick navigation
    const pmJobs = myJobs.map((j: any) => ({
      id: j.id, name: j.name, number: j.number,
    })).sort((a: any, b: any) => a.name.localeCompare(b.name));

    // ── BRIEFING: schedule-focused + recent communications ──
    const hour = now.getHours();
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

    // Schedule section
    if (hour < 12) {
      if (todayCalTasks.length > 0) {
        parts.push(`On deck today: ${taskListNarrative(todayCalTasks)}.`);
      } else {
        parts.push('Nothing scheduled for today.');
      }
      if (tomorrowCalTasks.length > 0) {
        parts.push(`${dayNames[tomorrowDow]}: ${taskListNarrative(tomorrowCalTasks, 2)}.`);
      }
    } else if (hour < 17) {
      if (todayCalTasks.length > 0) {
        parts.push(`Still on today's schedule: ${taskListNarrative(todayCalTasks, 2)}.`);
      }
      if (tomorrowCalTasks.length > 0) {
        parts.push(`Tomorrow: ${taskListNarrative(tomorrowCalTasks)}.`);
      }
    } else {
      if (tomorrowCalTasks.length > 0) {
        parts.push(`Tomorrow's schedule: ${taskListNarrative(tomorrowCalTasks)}.`);
      } else {
        parts.push(`Nothing scheduled for tomorrow.`);
      }
      if (dayAfterTasks.length > 0) {
        parts.push(`${dayNames[dayAfterDow]}: ${taskListNarrative(dayAfterTasks, 2)}.`);
      }
    }

    // Assigned tasks heads-up
    const week1EndStr = new Date(upcomingMonday.getTime() + 6 * 86400000).toISOString().split('T')[0];
    const myWeek1Tasks = calendarTasks.filter(t => t.date >= week1Start && t.date <= week1EndStr && !t.isComplete && t.isAssignedToMe);
    if (myWeek1Tasks.length > 0) {
      parts.push(`${myWeek1Tasks.length} task${myWeek1Tasks.length > 1 ? 's' : ''} assigned to you this upcoming week.`);
    }

    // ── KPI CALCULATIONS ──
    // We use all tasks from PM jobs (jobDataResults) which includes completed tasks
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000).toISOString().split('T')[0];
    const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000).toISOString().split('T')[0];

    let totalCompletedLast30 = 0;
    let completedOnTimeLast30 = 0;
    let completedThisWeek = 0;
    let completedLastWeek = 0;
    const fourteenDaysAgo = new Date(today.getTime() - 14 * 86400000).toISOString().split('T')[0];
    let allOverdueDaysSum = 0;
    let allOverdueCount = 0;
    let staleTaskCount = 0; // overdue 30+ days with no progress

    for (const { tasks } of jobDataResults) {
      for (const task of tasks) {
        if (task.isGroup) continue;
        const isComplete = task.progress !== null && task.progress >= 1;
        const endDate = task.endDate ? task.endDate.split('T')[0] : null;
        const completedAt = task.completedAt ? task.completedAt.split('T')[0] : null;
        // Use updatedAt as proxy for completion date if completedAt not available
        const doneDate = completedAt || (isComplete && task.updatedAt ? task.updatedAt.split('T')[0] : null);

        // KPI 1: Schedule Adherence (completed in last 30 days, was it on time?)
        if (isComplete && doneDate && doneDate >= thirtyDaysAgo) {
          totalCompletedLast30++;
          if (endDate && doneDate <= endDate) {
            completedOnTimeLast30++;
          } else if (!endDate) {
            // No due date = can't be late, count as on-time
            completedOnTimeLast30++;
          }
        }

        // KPI 4: Tasks Completed This Week / Last Week
        if (isComplete && doneDate) {
          if (doneDate >= sevenDaysAgo) completedThisWeek++;
          if (doneDate >= fourteenDaysAgo && doneDate < sevenDaysAgo) completedLastWeek++;
        }

        // KPI 2 & 3: Average Days Overdue + Stale count (open tasks only)
        if (!isComplete && endDate && endDate < todayStr) {
          const daysOver = Math.floor((today.getTime() - new Date(endDate + 'T12:00:00').getTime()) / 86400000);
          allOverdueDaysSum += daysOver;
          allOverdueCount++;
          if (daysOver >= 30 && (task.progress === null || task.progress === 0)) {
            staleTaskCount++;
          }
        }
      }
    }

    // Also count overdue from non-PM member tasks
    for (const t of memberTasks) {
      const ed = t.endDate ? t.endDate.split('T')[0] : null;
      if (ed && ed < todayStr) {
        const isComplete = t.progress !== null && t.progress >= 1;
        if (!isComplete && !myOverdueIds.has(t.id)) {
          // Already counted in PM job loop if present — skip duplicates
        }
      }
    }

    // KPI 1: Schedule Adherence Score (%)
    const scheduleAdherence = totalCompletedLast30 > 0
      ? Math.round((completedOnTimeLast30 / totalCompletedLast30) * 100)
      : null; // null = not enough data

    // KPI 2: Average Days Overdue
    const avgDaysOverdue = allOverdueCount > 0
      ? Math.round((allOverdueDaysSum / allOverdueCount) * 10) / 10
      : 0;

    // KPI 3: Stale Task Count (30+ days overdue, no progress)
    // Already calculated above

    // KPI 4: Tasks Completed This Week + trend vs last week
    const completionTrend = completedThisWeek - completedLastWeek; // positive = improving

    // KPI 5: Upcoming Task Density (next 7 vs next 30)
    const sevenDaysOut = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];
    const thirtyDaysOut = new Date(today.getTime() + 30 * 86400000).toISOString().split('T')[0];
    let tasksNext7 = 0;
    let tasksNext30 = 0;
    for (const { tasks } of jobDataResults) {
      for (const task of tasks) {
        if (task.isGroup) continue;
        const isComplete = task.progress !== null && task.progress >= 1;
        if (isComplete) continue;
        const ed = task.endDate ? task.endDate.split('T')[0] : null;
        if (!ed || ed < todayStr) continue;
        if (ed <= sevenDaysOut) tasksNext7++;
        if (ed <= thirtyDaysOut) tasksNext30++;
      }
    }

    const kpis = {
      scheduleAdherence,        // % on-time (last 30 days) or null
      totalCompletedLast30,     // for context
      avgDaysOverdue,           // average days overdue across all open overdue tasks
      overdueTaskCount: allOverdueCount, // total overdue (all PM jobs)
      staleTaskCount,           // 30+ days overdue, no progress
      completedThisWeek,        // tasks done in last 7 days
      completedLastWeek,        // tasks done 7-14 days ago (for trend)
      completionTrend,          // +/- vs last week
      tasksNext7,               // upcoming density: next 7 days
      tasksNext30,              // upcoming density: next 30 days
    };

    // Recent communications section — limit to 3 most active jobs
    if (recentComments.length > 0) {
      const commentsByJob = new Map<string, any[]>();
      for (const c of recentComments) {
        if (!commentsByJob.has(c.jobId)) commentsByJob.set(c.jobId, []);
        commentsByJob.get(c.jobId)!.push(c);
      }

      // Sort jobs by most recent comment, take top 3
      const sortedJobs = Array.from(commentsByJob.entries())
        .sort((a, b) => new Date(b[1][0].createdAt).getTime() - new Date(a[1][0].createdAt).getTime())
        .slice(0, 3);

      const commParts: string[] = [];
      for (const [jobId, jobComments] of sortedJobs) {
        const jobName = jobComments[0].jobName.replace(/^#\d+\s*/, '');
        const latest = jobComments[0]; // newest first
        const msgPreview = latest.message.length > 60
          ? latest.message.substring(0, 57).trim() + '...'
          : latest.message;
        if (jobComments.length === 1) {
          commParts.push(`${jobName}: "${msgPreview}"`);
        } else {
          commParts.push(`${jobComments.length} updates on ${jobName} — latest: "${msgPreview}"`);
        }
      }
      parts.push(`Recent activity: ${commParts.join('. ')}.`);
    }

    return NextResponse.json({
      userName: user.name,
      briefing: parts.join(' '),
      week1Start,
      todayDate: todayStr,
      jobOverdueTasks: jobOverdueTasks.slice(0, 50),
      myOverdueTasks: myOverdueTasks.slice(0, 30),
      myUpcomingTasks: myUpcomingFromMember.slice(0, 30),
      calendarTasks,
      recentComments: recentComments.slice(0, 10),
      activeJobCount: myJobs.length,
      pmJobs,
      kpis,
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

    if (endDate !== undefined) {
      await updateTask(taskId, { endDate });
      return NextResponse.json({ ok: true, taskId, endDate });
    }

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

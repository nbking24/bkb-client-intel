// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { getActiveJobs, getTasksForJob, getOpenTasksForMember, updateTaskProgress, updateTask, getCommentsForTarget, pave, getDocumentStatusesForJob } from '@/app/lib/jobtread';
import { TEAM_USERS } from '@/app/lib/constants';

/**
 * GET /api/field-dashboard
 * Forward-looking 2-week calendar, AI briefing with recent job comms, open/overdue tasks
 *
 * PATCH /api/field-dashboard
 * Mark task complete/incomplete: { taskId, complete: boolean }
 * Update task date: { taskId, endDate: string }
 */

async function getCOTrackingForJob(jobId: string): Promise<{
  budgetCOs: Array<{ id: string; name: string }>;
  documents: Array<{ id: string; name: string; number: string; status: string; type: string; createdAt?: string }>;
}> {
  try {
    // Fetch cost groups with pagination (PAVE max size is 100)
    const docs = await getDocumentStatusesForJob(jobId);

    let allGroups: any[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const groupData = await pave({
        job: {
          $: { id: jobId },
          costGroups: {
            $: { size: 100, page },
            nodes: {
              id: {},
              name: {},
              parentCostGroup: { id: {}, name: {} },
            },
          },
        },
      });
      const nodes = (groupData as any)?.job?.costGroups?.nodes || [];
      allGroups = allGroups.concat(nodes);
      hasMore = nodes.length === 100;
      page++;
    }

    const groups = allGroups;

    // Find the "Change Orders" parent group(s) — top-level CO containers
    const coRootIds = new Set(
      groups
        .filter((g: any) => /change\s*order|🔁|post\s*pricing/i.test(g.name || ''))
        .map((g: any) => g.id)
    );

    // Build parent→children map for recursive traversal
    const childrenOf = new Map<string, any[]>();
    for (const g of groups) {
      const pid = g.parentCostGroup?.id;
      if (pid) {
        if (!childrenOf.has(pid)) childrenOf.set(pid, []);
        childrenOf.get(pid)!.push(g);
      }
    }

    // Recursively find leaf CO groups (groups with no children that are descendants of a CO root)
    // Also collect intermediate groups that have items (some COs are direct children)
    const budgetCOs: Array<{ id: string; name: string }> = [];
    const visited = new Set<string>();

    function findCOGroups(parentId: string, depth: number) {
      const children = childrenOf.get(parentId) || [];
      for (const child of children) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        const grandChildren = childrenOf.get(child.id) || [];

        // Skip known structural groups (e.g., "Client Requested", "Owner Requested", "🟢 Approved")
        const isStructural = /^(client|owner|bkb)\s+requested$|^🟢\s*approved$|^🔴\s*declined$|^scope\s*of\s*work$/i.test(child.name?.trim() || '');

        if (isStructural && grandChildren.length > 0) {
          // Structural group — recurse into it but don't add it as a CO
          findCOGroups(child.id, depth + 1);
        } else if (grandChildren.length > 0 && depth < 3) {
          // Has children and not too deep — this could be a CO group that contains scope subgroups
          // Add it as a CO (it's likely "CO: Name" with line item subgroups)
          budgetCOs.push({ id: child.id, name: child.name });
        } else {
          // Leaf group or deep enough — this is a CO
          budgetCOs.push({ id: child.id, name: child.name });
        }
      }
    }

    for (const rootId of coRootIds) {
      findCOGroups(rootId, 0);
    }

    // Filter documents that are change orders (customerOrder type)
    // CO documents are typically named "Change Order" or have "CO" in the name
    const coDocuments = docs.filter((d: any) =>
      d.type === 'customerOrder' && /change\s*order|^co\b/i.test(d.name || '')
    );

    console.log(`[CO-TRACK] Job ${jobId}: ${groups.length} groups, ${coRootIds.size} CO roots, ${budgetCOs.length} budget COs, ${coDocuments.length} CO docs`);
    if (coRootIds.size > 0) {
      const rootNames = groups.filter((g: any) => coRootIds.has(g.id)).map((g: any) => g.name);
      console.log(`[CO-TRACK] Job ${jobId} roots: ${rootNames.join(', ')}`);
      console.log(`[CO-TRACK] Job ${jobId} COs found: ${budgetCOs.map(c => c.name).join(', ')}`);
    }
    return { budgetCOs, documents: coDocuments };
  } catch (err: any) {
    console.error(`[CO-TRACK] ERROR for job ${jobId}:`, err?.message || err);
    return { budgetCOs: [], documents: [] };
  }
}

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = auth.userId;
  if (!userId) return NextResponse.json({ error: 'No user ID' }, { status: 400 });
  const user = TEAM_USERS[userId];
  if (!user) return NextResponse.json({ error: 'Unknown user' }, { status: 400 });

  try {
    const membershipId = user.membershipId;

    // Fetch weather in parallel (non-blocking) — Perkasie, PA
    const weatherPromise = fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=40.37&longitude=-75.26&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&temperature_unit=fahrenheit&timezone=America/New_York&forecast_days=10'
    ).then(r => r.json()).then(d => {
      const daily = d.daily || {};
      const dates = daily.time || [];
      return dates.map((date: string, i: number) => ({
        date,
        high: Math.round(daily.temperature_2m_max?.[i] || 0),
        low: Math.round(daily.temperature_2m_min?.[i] || 0),
        precipChance: daily.precipitation_probability_max?.[i] || 0,
        code: daily.weathercode?.[i] || 0,
      }));
    }).catch(() => []);

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

    // Fetch tasks, comments, and CO tracking per PM job in parallel, plus weather
    const [jobDataResults, coTrackingResults, weather] = await Promise.all([
      Promise.all(
        myJobs.map(async (job: any) => {
          const [tasks, comments] = await Promise.all([
            getTasksForJob(job.id).catch(() => []),
            getCommentsForTarget(job.id, 'job', 15).catch(() => []),
          ]);
          return { jobId: job.id, tasks, comments };
        })
      ),
      // Scan ALL active jobs for COs (not just PM's jobs) — field staff need visibility across all projects
      Promise.all(
        activeJobs.map(async (job: any) => {
          const tracking = await getCOTrackingForJob(job.id).catch(() => ({ budgetCOs: [], documents: [] }));
          return { jobId: job.id, jobName: job.name, jobNumber: job.number, ...tracking };
        })
      ),
      weatherPromise,
    ]);

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

    let allOverdueDaysSum = 0;
    let allOverdueCount = 0;
    let staleTaskCount = 0; // overdue 30+ days with no progress
    let totalTasksWithDueDate = 0;
    let totalCompletedTasks = 0;
    let completedOnOrBeforeDue = 0; // completed tasks whose due date >= today or progress=1
    let completedThisWeek = 0;
    let completedLastWeek = 0;
    const fourteenDaysAgo = new Date(today.getTime() - 14 * 86400000).toISOString().split('T')[0];
    // Track completed tasks in date windows using endDate (since PAVE has no completedAt)
    // For "this week" / "last week" we look at completed tasks whose endDate falls in those windows

    for (const { tasks } of jobDataResults) {
      for (const task of tasks) {
        if (task.isGroup) continue;
        const isComplete = task.progress !== null && task.progress >= 1;
        const endDate = task.endDate ? task.endDate.split('T')[0] : null;

        // KPI 1: Schedule Adherence — of all tasks with due dates, what % are on-track?
        // On-track = completed (regardless of when) OR not yet due
        // Off-track = overdue and not complete
        if (endDate) {
          totalTasksWithDueDate++;
          if (isComplete || endDate >= todayStr) {
            completedOnOrBeforeDue++;
          }
        }

        // KPI 4: Tasks completed with endDate in recent windows
        if (isComplete && endDate) {
          totalCompletedTasks++;
          if (endDate >= sevenDaysAgo && endDate <= todayStr) completedThisWeek++;
          if (endDate >= fourteenDaysAgo && endDate < sevenDaysAgo) completedLastWeek++;
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

    // KPI 1: Schedule Adherence Score (%) — tasks on-track / total with due dates
    const scheduleAdherence = totalTasksWithDueDate > 0
      ? Math.round((completedOnOrBeforeDue / totalTasksWithDueDate) * 100)
      : null;

    // KPI 2: Average Days Overdue
    const avgDaysOverdue = allOverdueCount > 0
      ? Math.round((allOverdueDaysSum / allOverdueCount) * 10) / 10
      : 0;

    // KPI 4: Tasks Completed This Week + trend vs last week
    const completionTrend = completedThisWeek - completedLastWeek;

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
      scheduleAdherence,        // % of tasks on-track (complete or not yet due)
      totalCompletedLast30: totalCompletedTasks, // total completed tasks across PM jobs
      avgDaysOverdue,           // average days overdue across all open overdue tasks
      overdueTaskCount: allOverdueCount, // total overdue (all PM jobs)
      staleTaskCount,           // 30+ days overdue, no progress
      completedThisWeek,        // tasks with endDate in last 7 days that are complete
      completedLastWeek,        // tasks with endDate 7-14 days ago that are complete
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

    // Build CO tracker data
    const changeOrders: any[] = [];
    console.log(`[CO-TRACK] Total coTrackingResults: ${coTrackingResults.length}`);
    for (const jco of coTrackingResults) {
      if (jco.budgetCOs.length > 0 || jco.documents.length > 0) {
        console.log(`[CO-TRACK] Job ${jco.jobName}: ${jco.budgetCOs.length} budget COs, ${jco.documents.length} docs`);
      }
    }

    for (const jobCO of coTrackingResults) {
      if (jobCO.budgetCOs.length === 0 && jobCO.documents.length === 0) continue;

      // Match budget COs to documents
      const docsByStatus: Record<string, any[]> = {
        draft: jobCO.documents.filter((d: any) => d.status === 'draft'),
        issued: jobCO.documents.filter((d: any) => d.status === 'issued'),
        approved: jobCO.documents.filter((d: any) => d.status === 'approved'),
        declined: jobCO.documents.filter((d: any) => d.status === 'declined'),
      };

      const STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
      const now = Date.now();

      // Each budget CO group is a separate change order
      for (const co of jobCO.budgetCOs) {
        changeOrders.push({
          jobId: jobCO.jobId,
          jobName: jobCO.jobName,
          jobNumber: jobCO.jobNumber,
          coName: co.name,
          coGroupId: co.id,
          hasDocument: false,
          documentStatus: 'needs_document',
          documentId: null,
          isStale: true, // No document at all = always stale
        });
      }

      // Map documents to the tracker
      for (const doc of jobCO.documents) {
        const status = doc.status === 'draft' ? 'draft'
          : doc.status === 'approved' ? 'approved'
            : doc.status === 'declined' ? 'declined'
              : doc.status === 'issued' ? 'sent'
                : 'draft';

        // Calculate stale based on 3-day threshold
        const docAge = doc.createdAt ? now - new Date(doc.createdAt).getTime() : Infinity;
        const isStaleByAge = docAge > STALE_THRESHOLD_MS;

        // Try to find matching budget CO
        const matchIdx = changeOrders.findIndex((co: any) =>
          co.jobId === jobCO.jobId && co.documentStatus === 'needs_document'
        );

        if (matchIdx >= 0) {
          changeOrders[matchIdx].hasDocument = true;
          changeOrders[matchIdx].documentStatus = status;
          changeOrders[matchIdx].documentId = doc.id;
          changeOrders[matchIdx].documentNumber = doc.number;
          changeOrders[matchIdx].isStale = (status === 'draft' && isStaleByAge);
        } else {
          // Document exists but no matching budget group
          changeOrders.push({
            jobId: jobCO.jobId,
            jobName: jobCO.jobName,
            jobNumber: jobCO.jobNumber,
            coName: doc.name + ' #' + doc.number,
            coGroupId: null,
            hasDocument: true,
            documentStatus: status,
            documentId: doc.id,
            documentNumber: doc.number,
            isStale: (status === 'draft' && isStaleByAge),
          });
        }
      }
    }

    // Sort: stale/needs_document first, then draft, then sent, then approved/declined
    const statusOrder: Record<string, number> = { needs_document: 0, draft: 1, sent: 2, declined: 3, approved: 4 };
    changeOrders.sort((a, b) => (statusOrder[a.documentStatus] || 5) - (statusOrder[b.documentStatus] || 5));

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
      changeOrders,
      weather,
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

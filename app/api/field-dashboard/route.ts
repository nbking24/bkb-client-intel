// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { getActiveJobs, getTasksForJob, getOpenTasksForMember, updateTaskProgress, updateTask, getCommentsForTarget, pave } from '@/app/lib/jobtread';
import { TEAM_USERS, FIELD_KPI_TARGETS } from '@/app/lib/constants';
import { computeFieldKPIs } from '@/app/lib/field-kpis';
import { createServerClient } from '@/app/lib/supabase';

/**
 * GET /api/field-dashboard
 * Forward-looking 2-week calendar, AI briefing with recent job comms, open/overdue tasks
 *
 * PATCH /api/field-dashboard
 * Mark task complete/incomplete: { taskId, complete: boolean }
 * Update task date: { taskId, endDate: string }
 */

async function getCOTrackingForJob(jobId: string): Promise<{
  budgetCOs: Array<{ id: string; name: string; isApproved: boolean }>;
}> {
  try {
    // --- Phase 1: Fetch cost groups + documents (with cost groups) in parallel ---
    const firstPageSize = 100;
    const [groupPage1, docData] = await Promise.all([
      pave({
        job: {
          $: { id: jobId },
          costGroups: {
            $: { size: firstPageSize },
            nextPage: {},
            nodes: { id: {}, name: {}, parentCostGroup: { id: {} } },
          },
        },
      }),
      pave({
        job: {
          $: { id: jobId },
          documents: {
            $: { size: 50 },
            nodes: {
              id: {}, type: {}, status: {},
              costGroups: { nodes: { id: {}, name: {}, parentCostGroup: { id: {}, name: {} } } },
              costItems: {
                $: { size: 100 },
                nodes: { id: {}, name: {}, costCode: { number: {} }, costGroup: { id: {}, name: {} } },
              },
            },
          },
        },
      }),
    ]);

    // Paginate remaining cost groups
    let allGroups: any[] = (groupPage1 as any)?.job?.costGroups?.nodes || [];
    let nextGroupPage = (groupPage1 as any)?.job?.costGroups?.nextPage || null;
    for (let i = 1; i < 10 && nextGroupPage; i++) {
      const gd = await pave({
        job: {
          $: { id: jobId },
          costGroups: {
            $: { size: firstPageSize, page: nextGroupPage },
            nextPage: {},
            nodes: { id: {}, name: {}, parentCostGroup: { id: {} } },
          },
        },
      });
      const cg = (gd as any)?.job?.costGroups;
      allGroups = allGroups.concat(cg?.nodes || []);
      nextGroupPage = cg?.nextPage || null;
      if ((cg?.nodes?.length || 0) < firstPageSize) break;
    }

    // --- Phase 2: Identify approved customerOrder documents ---
    const allDocs = (docData as any)?.job?.documents?.nodes || [];
    const approvedCODocs = allDocs.filter((d: any) =>
      d.type === 'customerOrder' && d.status === 'approved'
    );
    // If no approved CO docs, all COs are pending — but we still need to find them
    const hasApprovedDocs = approvedCODocs.length > 0;

    // --- Phase 3: Find "Post Pricing Changes" root and its direct children (= COs) ---
    const postPricingRoot = allGroups.find((g: any) =>
      /post\s*pricing/i.test(g.name || '')
    );
    if (!postPricingRoot) {
      console.log(`[CO-TRACK] job=${jobId}: no Post Pricing root found among ${allGroups.length} groups. Names: ${allGroups.slice(0, 10).map((g: any) => g.name).join(', ')}`);
      return { budgetCOs: [], _debug: `no postPricing root in ${allGroups.length} groups` };
    }

    const coGroups = allGroups.filter((g: any) =>
      g.parentCostGroup?.id === postPricingRoot.id
    );
    if (coGroups.length === 0) return { budgetCOs: [] };

    // Build descendant group names for each CO (budget-side)
    const childrenOf = new Map<string, any[]>();
    for (const g of allGroups) {
      const pid = g.parentCostGroup?.id;
      if (pid) {
        if (!childrenOf.has(pid)) childrenOf.set(pid, []);
        childrenOf.get(pid)!.push(g);
      }
    }

    // For each CO, collect all descendant group names (normalized) + cost item names
    const coDescendantNames = new Map<string, Set<string>>(); // coId → set of normalized group names
    const coDescendantGroupIds = new Map<string, Set<string>>(); // coId → set of group IDs
    for (const co of coGroups) {
      const names = new Set<string>([(co.name || '').trim().toLowerCase()]);
      const ids = new Set<string>([co.id]);
      const queue = [co.id];
      while (queue.length) {
        const curr = queue.shift()!;
        for (const child of (childrenOf.get(curr) || [])) {
          if (!ids.has(child.id)) {
            ids.add(child.id);
            names.add((child.name || '').trim().toLowerCase());
            queue.push(child.id);
          }
        }
      }
      coDescendantNames.set(co.id, names);
      coDescendantGroupIds.set(co.id, ids);
    }

    // --- Phase 4: Match approved documents to CO groups ---
    // Strategy A: Match document cost group names to budget CO group names
    // Strategy B: Match document cost item names to budget cost item names
    // JT doesn't expose budget↔document linkage via API, so we match by name.
    const approvedCOIds = new Set<string>();
    let budgetItems: any[] | null = null; // lazy-loaded for Strategy B

    for (const doc of (hasApprovedDocs ? approvedCODocs : [])) {
      const docGroups = doc.costGroups?.nodes || [];
      const docItems = doc.costItems?.nodes || [];

      // Strategy A: Check if any document cost group name matches a budget CO group name
      const docGroupNames = new Set(
        docGroups.map((g: any) => (g.name || '').trim().toLowerCase())
      );

      for (const co of coGroups) {
        if (approvedCOIds.has(co.id)) continue;
        const budgetNames = coDescendantNames.get(co.id)!;
        for (const bn of budgetNames) {
          if (docGroupNames.has(bn)) {
            approvedCOIds.add(co.id);
            break;
          }
        }
      }

      // Strategy B: For unmatched COs, check if document cost items match
      // budget cost items (by name) that belong to a CO group
      if (approvedCOIds.size < coGroups.length && docItems.length > 0) {
        const docItemNames = new Set(
          docItems.map((item: any) => (item.name || '').trim().toLowerCase())
        );

        // Lazy-fetch budget cost items (only once per getCOTrackingForJob call)
        if (!budgetItems) {
          budgetItems = [];
          let biNextPage: any = null;
          for (let p = 0; p < 10; p++) {
            const biParams: Record<string, unknown> = { size: firstPageSize };
            if (biNextPage) biParams.page = biNextPage;
            const biData = await pave({
              job: {
                $: { id: jobId },
                costItems: {
                  $: biParams,
                  nextPage: {},
                  nodes: { id: {}, name: {}, costGroup: { id: {} } },
                },
              },
            });
            const ci = (biData as any)?.job?.costItems;
            budgetItems = budgetItems.concat(ci?.nodes || []);
            biNextPage = ci?.nextPage || null;
            if (!biNextPage || (ci?.nodes?.length || 0) < firstPageSize) break;
          }
        }

        for (const co of coGroups) {
          if (approvedCOIds.has(co.id)) continue;
          const groupIds = coDescendantGroupIds.get(co.id)!;
          for (const bi of budgetItems) {
            const biGroupId = bi.costGroup?.id;
            if (!biGroupId || !groupIds.has(biGroupId)) continue;
            const biName = (bi.name || '').trim().toLowerCase();
            if (docItemNames.has(biName)) {
              approvedCOIds.add(co.id);
              break;
            }
          }
        }
      }

      if (approvedCOIds.size === coGroups.length) break;
    }

    console.log(`[CO-TRACK] job=${jobId}: groups=${allGroups.length}, postPricing=${postPricingRoot?.name}, coGroups=${coGroups.length}, approvedDocs=${approvedCODocs.length}, approvedCOIds=${[...approvedCOIds]}`);
    return {
      budgetCOs: coGroups.map((co: any) => ({
        id: co.id,
        name: co.name,
        isApproved: approvedCOIds.has(co.id),
      })),
    };
  } catch (err: any) {
    console.error(`[CO-TRACK] ERROR for job ${jobId}:`, err?.message || err, err?.stack);
    return { budgetCOs: [], _error: err?.message || String(err) };
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
      // Scan PM's jobs for COs — limited to user's jobs to stay within Vercel timeout
      Promise.all(
        myJobs.map(async (job: any) => {
          const tracking = await getCOTrackingForJob(job.id).catch((e) => ({ budgetCOs: [], _error: e?.message || String(e) }));
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
      customStatus: j.customStatus || null,
      statusCategory: j.statusCategory || null,
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

    // ── KPI CALCULATIONS (shared helper) ──
    const kpis = computeFieldKPIs(jobDataResults, today);

    // ── KPI HISTORY (from bi-weekly snapshots in agent_cache) ──
    let kpiHistory: any[] = [];
    try {
      const sb = createServerClient();
      const sixMonthsAgo = new Date(today.getTime() - 180 * 86400000).toISOString().split('T')[0];
      const { data: snapshots } = await sb
        .from('agent_cache')
        .select('key, data')
        .like('key', `field-kpi:${userId}:%`)
        .order('key', { ascending: true });
      if (snapshots) {
        kpiHistory = snapshots
          .map((s: any) => {
            const date = s.key.split(':')[2]; // field-kpi:userId:YYYY-MM-DD
            return date >= sixMonthsAgo ? { date, ...s.data } : null;
          })
          .filter(Boolean);
      }
    } catch (e) {
      console.error('KPI history fetch error:', e);
    }

    const kpiTargets = FIELD_KPI_TARGETS;

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

    // Build CO tracker data — simple two-status model:
    //   "approved" = cost items under this CO group have an approved price in JT
    //   "pending"  = no approved price yet
    const changeOrders: any[] = [];
    for (const jobCO of coTrackingResults) {
      if (jobCO.budgetCOs.length === 0) continue;

      for (const co of jobCO.budgetCOs) {
        changeOrders.push({
          jobId: jobCO.jobId,
          jobName: jobCO.jobName,
          jobNumber: jobCO.jobNumber,
          coName: co.name,
          coGroupId: co.id,
          status: co.isApproved ? 'approved' : 'pending',
        });
      }
    }

    // Sort: pending first, then approved
    changeOrders.sort((a, b) => {
      if (a.status === b.status) return a.jobName.localeCompare(b.jobName);
      return a.status === 'pending' ? -1 : 1;
    });

    // Debug CO tracking when ?debug=co is passed
    const debugCO = req.nextUrl.searchParams.get('debug') === 'co';
    const debugData = debugCO ? {
      coTrackingRaw: coTrackingResults.map((r: any) => ({
        jobId: r.jobId, jobName: r.jobName,
        budgetCOs: r.budgetCOs,
        _error: r._error || null,
        _debug: r._debug || null,
      })),
    } : {};

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
      kpiHistory,
      kpiTargets,
      ...debugData,
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

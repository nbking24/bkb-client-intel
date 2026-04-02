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
    // --- Phase 1: Fetch cost groups + approved documents in parallel ---
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
            nodes: { id: {}, type: {}, status: {} },
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
    const approvedCODocIds = allDocs
      .filter((d: any) => d.type === 'customerOrder' && d.status === 'approved')
      .map((d: any) => d.id as string);

    // --- Phase 3: Find ALL "Post Pricing Changes" roots and their CO groups ---
    // Some jobs have multiple PP roots (from separate scopes/copies). We must
    // collect COs from ALL of them so document-link matching works correctly.
    const postPricingRoots = allGroups.filter((g: any) =>
      /post\s*pricing/i.test(g.name || '')
    );
    if (postPricingRoots.length === 0) return { budgetCOs: [] };

    // Org/status groups are direct children of Post Pricing that organize COs:
    //   Client Requested, Trade Walk, ✅ Approved, 🚫 OS Out of Scope, etc.
    // NOTE: ✅ prefix is also used as an approval marker on individual CO names
    // (e.g. "✅ Paint Colors"), so we match only KNOWN org group names.
    const KNOWN_ORG_NAMES = /^(client requested|trade walk|os out of scope|approved|declined|pending|out of scope)$/i;
    const isOrgGroup = (name: string) => {
      const trimmed = name.trim();
      // Strip leading emoji + space if present, then check against known org names
      const stripped = trimmed.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*/u, '');
      return KNOWN_ORG_NAMES.test(stripped);
    };

    // Normalize CO name: strip ✅ approval prefix for deduplication/matching
    const normalizeCOName = (name: string) => (name || '').replace(/^✅\s*/, '');

    const ppRootIds = new Set(postPricingRoots.map((g: any) => g.id));
    const orgGroupIds = new Set<string>();
    const coGroups: any[] = [];
    const seenCONames = new Set<string>(); // Dedupe same-named COs across PP roots

    for (const ppRoot of postPricingRoots) {
      const directChildren = allGroups.filter((g: any) =>
        g.parentCostGroup?.id === ppRoot.id
      );

      for (const g of directChildren) {
        const norm = normalizeCOName(g.name);
        if (isOrgGroup(g.name || '')) {
          orgGroupIds.add(g.id);
        } else if (!seenCONames.has(norm)) {
          seenCONames.add(norm);
          coGroups.push(g);
        }
      }
    }
    // Also check children of org groups across all PP roots
    if (orgGroupIds.size > 0) {
      for (const g of allGroups) {
        const norm = normalizeCOName(g.name);
        if (g.parentCostGroup?.id && orgGroupIds.has(g.parentCostGroup.id) && !seenCONames.has(norm)) {
          seenCONames.add(norm);
          coGroups.push(g);
        }
      }
    }
    if (coGroups.length === 0) return { budgetCOs: [] };

    // Build a comprehensive set of ALL CO group IDs across ALL PP roots
    // (same-named COs under different PP roots have different IDs, but we
    // need to match against ALL of them for document-link approval)
    const coNameToCanonicalId = new Map<string, string>();
    for (const co of coGroups) {
      coNameToCanonicalId.set(normalizeCOName(co.name), co.id);
    }
    // Collect ALL group IDs that represent CO groups (including duplicates across PP roots)
    const allCOGroupIds = new Set<string>();
    for (const ppRoot of postPricingRoots) {
      const directChildren = allGroups.filter((g: any) =>
        g.parentCostGroup?.id === ppRoot.id
      );
      for (const g of directChildren) {
        const norm = normalizeCOName(g.name);
        if (!isOrgGroup(g.name || '') && coNameToCanonicalId.has(norm)) {
          allCOGroupIds.add(g.id);
        }
      }
    }
    if (orgGroupIds.size > 0) {
      for (const g of allGroups) {
        const norm = normalizeCOName(g.name);
        if (g.parentCostGroup?.id && orgGroupIds.has(g.parentCostGroup.id) && coNameToCanonicalId.has(norm)) {
          allCOGroupIds.add(g.id);
        }
      }
    }
    // Map any CO group ID (from any PP root) back to the canonical CO entry
    const coIdToCanonicalId = new Map<string, string>();
    for (const ppRoot of postPricingRoots) {
      const directChildren = allGroups.filter((g: any) =>
        g.parentCostGroup?.id === ppRoot.id
      );
      for (const g of directChildren) {
        const norm = normalizeCOName(g.name);
        if (!isOrgGroup(g.name || '') && coNameToCanonicalId.has(norm)) {
          coIdToCanonicalId.set(g.id, coNameToCanonicalId.get(norm)!);
        }
      }
    }
    if (orgGroupIds.size > 0) {
      for (const g of allGroups) {
        const norm = normalizeCOName(g.name);
        if (g.parentCostGroup?.id && orgGroupIds.has(g.parentCostGroup.id) && coNameToCanonicalId.has(norm)) {
          coIdToCanonicalId.set(g.id, coNameToCanonicalId.get(norm)!);
        }
      }
    }

    // --- Phase 4: Determine approval via document→budget linkage ---
    // For each approved customerOrder doc, query its cost items' jobCostItem.costGroup
    // with a parent chain (up to 5 levels). Walk up to find which CO group under
    // Post Pricing each item belongs to. We match against ALL CO group IDs across
    // ALL PP roots, then map back to the canonical CO entry for deduplication.
    const approvedCOIds = new Set<string>();

    if (approvedCODocIds.length > 0) {
      const docItemResults = await Promise.all(
        approvedCODocIds.map((docId: string) =>
          pave({
            document: {
              $: { id: docId },
              costItems: {
                $: { size: 100 },
                nodes: {
                  jobCostItem: {
                    costGroup: {
                      id: {}, name: {},
                      parentCostGroup: {
                        id: {}, name: {},
                        parentCostGroup: {
                          id: {}, name: {},
                          parentCostGroup: {
                            id: {}, name: {},
                            parentCostGroup: { id: {}, name: {} },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          }).then((r: any) => r?.document?.costItems?.nodes || []).catch(() => [])
        )
      );

      for (const items of docItemResults) {
        for (const item of items) {
          const cg = item?.jobCostItem?.costGroup;
          if (!cg) continue;

          // Walk up the parent chain to find which CO group this item belongs to
          // Match against ALL CO group IDs (from any PP root), then map to canonical
          let curr = cg;
          while (curr?.id) {
            if (allCOGroupIds.has(curr.id)) {
              const canonicalId = coIdToCanonicalId.get(curr.id) || curr.id;
              approvedCOIds.add(canonicalId);
              break;
            }
            curr = curr.parentCostGroup;
          }
        }
        if (approvedCOIds.size === coGroups.length) break;
      }
    }

    return {
      budgetCOs: coGroups.map((co: any) => ({
        id: co.id,
        name: (co.name || '').replace(/^✅\s*/, ''), // Strip approval emoji for clean display
        isApproved: approvedCOIds.has(co.id),
      })),
    };
  } catch (err: any) {
    console.error(`[CO-TRACK] ERROR for job ${jobId}:`, err?.message || err);
    return { budgetCOs: [] };
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
          const tracking = await getCOTrackingForJob(job.id).catch(() => ({ budgetCOs: [] }));
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
      coTrackingRaw: coTrackingResults
        .filter((r: any) => r.budgetCOs.length > 0)
        .map((r: any) => ({
          jobId: r.jobId, jobName: r.jobName,
          budgetCOs: r.budgetCOs,
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

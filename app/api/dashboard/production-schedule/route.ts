// @ts-nocheck
/**
 * GET /api/dashboard/production-schedule
 *
 * Cross-job production milestone feed for the Production Schedule page.
 *
 * Source of truth is the Claude-managed schedule group that the
 * jobtread-production-schedule task writes into each job:
 *
 *   🤖 PRODUCTION MILESTONES — Claude Managed (Do Not Edit)
 *
 * Every open job that carries that group is returned with the group's
 * child tasks (the milestones), including JobTread baseline dates where a
 * baseline has been captured (Schedule Settings > Baseline). Jobs are NOT
 * filtered by the Status custom field — if the task has built a milestone
 * group for a job, it belongs on the production projection.
 *
 * Only two PAVE round-trips regardless of job count:
 *   1. org.tasks where isGroup = true AND name like '%PRODUCTION MILESTONES%'
 *   2. org.tasks where parentTask.id in [...groupIds]  (paginated)
 *   (+ getActiveJobs() for Status / PM / contract value, run in parallel)
 *
 * Auth: validateAuth (Bearer user token). Read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { pave, getActiveJobs } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ORG_ID = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';

/** Canonical group name written by the Claude task. */
const MILESTONE_GROUP_NAME = '🤖 PRODUCTION MILESTONES — Claude Managed (Do Not Edit)';
/** Loose match so a hand-renamed variant (different dash, trailing text) still qualifies. */
const GROUP_LIKE = '%PRODUCTION MILESTONES%';

// Stable, distinguishable palette (12) — deterministic by sorted job number so
// a job keeps its color between loads and across users.
const PALETTE = [
  '#68050a', '#1d4ed8', '#047857', '#b45309', '#6d28d9', '#be185d',
  '#0e7490', '#4d7c0f', '#9a3412', '#374151', '#7c2d12', '#0f766e',
];

async function fetchGroups() {
  const data = await pave({
    organization: {
      $: { id: ORG_ID() },
      tasks: {
        $: {
          size: 100,
          where: { and: [['isGroup', '=', true], ['name', 'like', GROUP_LIKE]] },
        },
        nodes: {
          id: {},
          name: {},
          startDate: {},
          endDate: {},
          baselineStartDate: {},
          baselineEndDate: {},
          progress: {},
          description: {},
          // Keep this slim — PAVE returns 413 if each task row drags in job
          // custom fields. Job metadata is joined from getActiveJobs() below.
          job: { id: {}, name: {}, number: {}, closedOn: {} },
        },
      },
    },
  });
  return (data as any)?.organization?.tasks?.nodes || [];
}

async function fetchChildren(groupIds: string[]) {
  const out: any[] = [];
  let page: string | null = null;
  for (let i = 0; i < 20; i++) {
    const params: Record<string, unknown> = {
      size: 100,
      where: { and: [['isGroup', '=', false], [['parentTask', 'id'], 'in', groupIds]] },
    };
    if (page) params.page = page;
    const data = await pave({
      organization: {
        $: { id: ORG_ID() },
        tasks: {
          $: params,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            startDate: {},
            endDate: {},
            baselineStartDate: {},
            baselineEndDate: {},
            progress: {},
            taskType: { id: {}, name: {}, color: {} },
            parentTask: { id: {} },
            taskDependencies: { nodes: { dependsOnTask: { id: {} } } },
          },
        },
      },
    });
    const t = (data as any)?.organization?.tasks;
    const nodes = t?.nodes || [];
    out.push(...nodes);
    page = t?.nextPage || null;
    if (!page || nodes.length < 100) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [rawGroups, activeJobs] = await Promise.all([fetchGroups(), getActiveJobs().catch(() => [])]);
    const groups = rawGroups.filter((g: any) => g.job && !g.job.closedOn);
    const groupIds = groups.map((g: any) => g.id);
    const children = groupIds.length ? await fetchChildren(groupIds) : [];
    const meta: Record<string, any> = {};
    for (const aj of activeJobs as any[]) meta[aj.id] = aj;

    const byGroup: Record<string, any[]> = {};
    for (const c of children) {
      const pid = c.parentTask?.id;
      if (!pid) continue;
      (byGroup[pid] ||= []).push(c);
    }

    // One row per job. If a job somehow has two matching groups, merge them
    // and flag it so the Claude task can clean it up.
    const jobsById: Record<string, any> = {};
    const warnings: string[] = [];
    for (const g of groups) {
      const j = g.job;
      const existing = jobsById[j.id];
      // "START ANCHOR: Mon 2026-09-28 (TENTATIVE ...)" written by the Claude task.
      const am = /START ANCHOR:\s*(?:\w{3}\s+)?(\d{4}-\d{2}-\d{2})\s*(?:\(([^)]*)\))?/i.exec(g.description || '');
      const anchor = am ? { date: am[1], tentative: /tentative/i.test(am[2] || '') } : null;
      const milestones = (byGroup[g.id] || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        description: c.description || null,
        start: c.startDate || null,
        end: c.endDate || null,
        baselineStart: c.baselineStartDate || null,
        baselineEnd: c.baselineEndDate || null,
        progress: typeof c.progress === 'number' ? c.progress : 0,
        taskType: c.taskType?.name || null,
        dependsOn: (c.taskDependencies?.nodes || []).map((d: any) => d.dependsOnTask?.id).filter(Boolean),
      }));
      if (existing) {
        warnings.push(`${j.number} ${j.name}: more than one milestone group found — merged.`);
        existing.milestones.push(...milestones);
        continue;
      }
      if (milestones.length === 0) {
        warnings.push(`${j.number} ${j.name}: milestone group exists but has no milestones.`);
      }
      jobsById[j.id] = {
        id: j.id,
        number: String(j.number || ''),
        name: j.name,
        clientName: meta[j.id]?.clientName || '',
        locationName: meta[j.id]?.locationName || '',
        status: meta[j.id]?.customStatus || null,
        projectManager: meta[j.id]?.projectManager || null,
        priceType: meta[j.id]?.priceType || null,
        contractValue: Number(meta[j.id]?.projectedPrice) || 0,
        groupId: g.id,
        groupName: g.name,
        groupNote: g.description || null,
        anchorDate: anchor?.date || null,
        tentative: anchor ? anchor.tentative : /tentative/i.test(g.description || ''),
        milestones,
      };
    }

    const jobs = Object.values(jobsById).map((job: any) => {
      job.milestones.sort((a: any, b: any) => (a.start || '').localeCompare(b.start || ''));
      const starts = job.milestones.map((m: any) => m.start).filter(Boolean).sort();
      const ends = job.milestones.map((m: any) => m.end).filter(Boolean).sort();
      const bStarts = job.milestones.map((m: any) => m.baselineStart).filter(Boolean).sort();
      const bEnds = job.milestones.map((m: any) => m.baselineEnd).filter(Boolean).sort();
      job.start = starts[0] || null;
      job.end = ends[ends.length - 1] || null;
      job.baselineStart = bStarts[0] || null;
      job.baselineEnd = bEnds[bEnds.length - 1] || null;
      job.hasBaseline = job.milestones.some((m: any) => m.baselineStart && m.baselineEnd);
      if (job.anchorDate && job.start && job.anchorDate !== job.start) {
        warnings.push(`${job.number} ${job.name}: group note says start anchor ${job.anchorDate} but first milestone starts ${job.start} — the Claude task should re-sync the note.`);
      }
      const done = job.milestones.filter((m: any) => m.progress >= 1).length;
      job.completedMilestones = done;
      job.milestoneCount = job.milestones.length;
      // Dependency links inside the group: every milestone but the anchor should have one.
      const idSet = new Set(job.milestones.map((m: any) => m.id));
      const dated = job.milestones.filter((m: any) => m.start && m.end);
      job.linkedCount = dated.filter((m: any, i: number) => i > 0 && (m.dependsOn || []).some((d: string) => idSet.has(d))).length;
      job.linkableCount = Math.max(0, dated.length - 1);
      job.fullyLinked = job.linkableCount > 0 && job.linkedCount === job.linkableCount;
      // Slip in days of the projected completion vs baseline completion (positive = late).
      job.slipDays =
        job.hasBaseline && job.end && job.baselineEnd
          ? Math.round((Date.parse(job.end) - Date.parse(job.baselineEnd)) / 86400000)
          : null;
      return job;
    });

    jobs.sort((a: any, b: any) => (a.start || '9999').localeCompare(b.start || '9999') || a.number.localeCompare(b.number));
    // Color by job number order so colors are stable regardless of dates.
    const byNumber = [...jobs].sort((a, b) => Number(a.number) - Number(b.number));
    byNumber.forEach((j, i) => (j.color = PALETTE[i % PALETTE.length]));

    for (const j of jobs) j.jtUrl = `https://app.jobtread.com/jobs/${j.id}/schedule`;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      groupName: MILESTONE_GROUP_NAME,
      jobCount: jobs.length,
      milestoneCount: children.length,
      range: {
        start: jobs.map((j) => j.start).filter(Boolean).sort()[0] || null,
        end: jobs.map((j) => j.end).filter(Boolean).sort().slice(-1)[0] || null,
      },
      warnings,
      jobs,
    });
  } catch (err: any) {
    console.error('[production-schedule]', err);
    return NextResponse.json({ error: err?.message || 'Failed to load production schedule' }, { status: 500 });
  }
}

// @ts-nocheck
/**
 * POST /api/dashboard/production-schedule/baseline
 *   body: { jobId: string, action: 'capture' | 'clear' }
 *
 * Writes the JobTread schedule baseline for every milestone in a job's
 * "🤖 PRODUCTION MILESTONES — Claude Managed (Do Not Edit)" group:
 *
 *   capture → baselineStartDate/EndDate := current startDate/endDate
 *             (equivalent to JobTread Schedule Settings > Baseline, but
 *             scoped to the milestone group only — day-to-day tasks in
 *             other groups are untouched). Re-running re-baselines.
 *   clear   → baselineStartDate/EndDate := null
 *
 * Also stamps the group note ("Baseline captured YYYY-MM-DD" /
 * "Baseline cleared YYYY-MM-DD") so the Claude task and humans see the
 * same state, and leaves a job comment for the audit trail.
 *
 * Auth: validateAuth + (role owner OR 'jt_write' feature).
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getEffectiveAccess } from '@/app/lib/access';
import { pave, createComment } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ORG_ID = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';
const GROUP_LIKE = '%PRODUCTION MILESTONES%';

function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
}

async function loadJobMilestones(jobId: string) {
  const g = await pave({
    job: { $: { id: jobId }, id: {}, name: {}, number: {} },
    organization: {
      $: { id: ORG_ID() },
      tasks: {
        $: { size: 100, where: { and: [['isGroup', '=', true], ['name', 'like', GROUP_LIKE], [['job', 'id'], '=', jobId]] } },
        nodes: { id: {}, name: {}, description: {}, startDate: {}, endDate: {} },
      },
    },
  });
  const job = (g as any)?.job;
  const groups = (g as any)?.organization?.tasks?.nodes || [];
  if (!job || groups.length === 0) return { job, groups: [], tasks: [] };
  const c = await pave({
    organization: {
      $: { id: ORG_ID() },
      tasks: {
        $: { size: 100, where: { and: [['isGroup', '=', false], [['parentTask', 'id'], 'in', groups.map((x: any) => x.id)]] } },
        nodes: { id: {}, name: {}, startDate: {}, endDate: {}, baselineStartDate: {}, baselineEndDate: {} },
      },
    },
  });
  return { job, groups, tasks: (c as any)?.organization?.tasks?.nodes || [] };
}

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getEffectiveAccess(auth.userId);
  const canWrite = access && (access.role === 'owner' || (access.features || []).includes('jt_write'));
  if (!canWrite) return NextResponse.json({ error: 'JobTread write access required' }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { jobId, action } = body || {};
  if (!jobId || !['capture', 'clear'].includes(action)) {
    return NextResponse.json({ error: 'jobId and action (capture|clear) required' }, { status: 400 });
  }

  try {
    const { job, groups, tasks } = await loadJobMilestones(jobId);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    if (groups.length === 0) return NextResponse.json({ error: 'This job has no 🤖 PRODUCTION MILESTONES group' }, { status: 404 });

    const stamp = todayISO();
    let updated = 0;
    const skipped: string[] = [];

    // Milestones only — the group row rolls its dates up from its children.
    for (const t of tasks) {
      const params: Record<string, unknown> = { id: t.id, notify: false, updateDependentTasks: false };
      if (action === 'capture') {
        if (!t.startDate || !t.endDate) { skipped.push(t.name); continue; }
        params.baselineStartDate = t.startDate;
        params.baselineEndDate = t.endDate;
      } else {
        params.baselineStartDate = null;
        params.baselineEndDate = null;
      }
      await pave({ updateTask: { $: params, task: { $: { id: t.id }, id: {} } } });
      updated++;
    }

    // Stamp the group note so the Claude task sees the same state.
    const label = action === 'capture' ? `Baseline captured ${stamp}` : `Baseline cleared ${stamp}`;
    for (const g of groups) {
      const desc: string = g.description || '';
      let next: string;
      if (/Baseline (captured|cleared) \d{4}-\d{2}-\d{2}/.test(desc)) next = desc.replace(/Baseline (captured|cleared) \d{4}-\d{2}-\d{2}/, label);
      else next = desc ? `${desc.trim()} ${label}.` : `${label}.`;
      if (next !== desc) {
        await pave({ updateTask: { $: { id: g.id, description: next.slice(0, 4096), notify: false }, task: { $: { id: g.id }, id: {} } } });
      }
    }

    // Audit comment on the job.
    const who = access.name || auth.userId;
    const msg = action === 'capture'
      ? `📌 Production milestone baseline ${tasks.some((t: any) => t.baselineStartDate) ? 're-captured' : 'captured'} from the BKB Hub by ${who} on ${stamp} — ${updated} milestones locked to their current dates.`
      : `🧹 Production milestone baseline cleared from the BKB Hub by ${who} on ${stamp}.`;
    try {
      await createComment({ targetType: 'job', targetId: jobId, message: msg, name: who });
    } catch (e) { console.warn('[baseline] comment failed', e); }

    return NextResponse.json({ ok: true, action, jobId, job: `${job.number} ${job.name}`, milestones: updated, skipped, stamp });
  } catch (err: any) {
    console.error('[production-schedule/baseline]', err);
    return NextResponse.json({ error: err?.message || 'Baseline update failed' }, { status: 500 });
  }
}

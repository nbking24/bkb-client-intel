// @ts-nocheck
/**
 * Production milestone re-anchoring + dependency linking.
 *
 * GET  /api/dashboard/production-schedule/reschedule?jobId=…
 *      → link status for the job's 🤖 PRODUCTION MILESTONES group
 *        { anchor, milestones, linked, unlinked: [names], plan: [{task, dependsOn, anchor}] }
 *
 * POST /api/dashboard/production-schedule/reschedule
 *      body: { jobId, action: 'link' | 'move', newStart?: 'YYYY-MM-DD', firm?: boolean }
 *
 *   link → ensure every milestone (except the anchor = earliest start) has a
 *          JobTread dependency so a date change cascades:
 *            predecessor = the milestone with the latest END that finishes
 *            before this one starts (finish-to-start, offset locked so the
 *            existing gap is preserved). Milestones that start with the
 *            anchor get a start-to-start link to the anchor. Parallel
 *            branches (e.g. "EXT:" work) therefore keep their layout.
 *          Existing dependencies are kept; only missing ones are added.
 *   move → run `link` first, then move the anchor to newStart with
 *          updateDependentTasks:true so JobTread cascades the whole chain.
 *          Re-reads the group and shifts any straggler by the same delta so
 *          the result is always a clean whole-schedule shift. Baseline is
 *          untouched (that is what makes slip visible). Stamps the group note
 *          (START ANCHOR: … (TENTATIVE|FIRM)) and posts a job comment.
 *
 * Auth: validateAuth + (owner OR jt_write).
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getEffectiveAccess } from '@/app/lib/access';
import { pave, createComment } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ORG_ID = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';
const GROUP_LIKE = '%PRODUCTION MILESTONES%';
const DAY = 86400000;

const toIdx = (s: string) => Math.floor(Date.parse(`${s}T00:00:00Z`) / DAY);
const toISO = (i: number) => new Date(i * DAY).toISOString().slice(0, 10);
const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
function todayISO(): string { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }

type MS = { id: string; name: string; startDate: string | null; endDate: string | null; progress: number; deps: { id: string; dependsOnId: string; offsetIsLocked: boolean }[] };

async function load(jobId: string) {
  const g = await pave({
    job: { $: { id: jobId }, id: {}, name: {}, number: {} },
    organization: {
      $: { id: ORG_ID() },
      tasks: {
        $: { size: 100, where: { and: [['isGroup', '=', true], ['name', 'like', GROUP_LIKE], [['job', 'id'], '=', jobId]] } },
        nodes: { id: {}, name: {}, description: {} },
      },
    },
  });
  const job = (g as any)?.job;
  const groups = (g as any)?.organization?.tasks?.nodes || [];
  if (!job || groups.length === 0) return { job, groups: [], tasks: [] as MS[] };
  const c = await pave({
    organization: {
      $: { id: ORG_ID() },
      tasks: {
        $: { size: 100, where: { and: [['isGroup', '=', false], [['parentTask', 'id'], 'in', groups.map((x: any) => x.id)]] } },
        nodes: {
          id: {}, name: {}, startDate: {}, endDate: {}, progress: {},
          taskDependencies: { nodes: { id: {}, offsetIsLocked: {}, dependsOnTask: { id: {} } } },
        },
      },
    },
  });
  const tasks: MS[] = ((c as any)?.organization?.tasks?.nodes || []).map((t: any) => ({
    id: t.id, name: t.name, startDate: t.startDate || null, endDate: t.endDate || null, progress: t.progress || 0,
    deps: (t.taskDependencies?.nodes || []).map((d: any) => ({ id: d.id, dependsOnId: d.dependsOnTask?.id, offsetIsLocked: !!d.offsetIsLocked })),
  }));
  tasks.sort((a, b) => (a.startDate || '9999').localeCompare(b.startDate || '9999') || (a.endDate || '').localeCompare(b.endDate || ''));
  return { job, groups, tasks };
}

/** Which milestone each one should depend on (within the group). */
function buildPlan(tasks: MS[]) {
  const dated = tasks.filter((t) => t.startDate && t.endDate);
  const anchor = dated[0] || null;
  const ids = new Set(dated.map((t) => t.id));
  const plan: { task: MS; dependsOn: MS; anchorType: 'end' | 'start'; existing: boolean }[] = [];
  for (const t of dated) {
    if (!anchor || t.id === anchor.id) continue;
    const inGroupDeps = t.deps.filter((d) => ids.has(d.dependsOnId));
    if (inGroupDeps.length) { plan.push({ task: t, dependsOn: dated.find((x) => x.id === inGroupDeps[0].dependsOnId)!, anchorType: 'end', existing: true }); continue; }
    // nearest preceding finisher: latest end strictly before this start
    let pred: MS | null = null;
    for (const p of dated) {
      if (p.id === t.id) continue;
      if (p.endDate! < t.startDate! && (!pred || p.endDate! > pred.endDate! || (p.endDate === pred.endDate && p.startDate! > pred.startDate!))) pred = p;
    }
    if (pred) plan.push({ task: t, dependsOn: pred, anchorType: 'end', existing: false });
    else plan.push({ task: t, dependsOn: anchor, anchorType: 'start', existing: false });
  }
  return { anchor, plan, undated: tasks.filter((t) => !t.startDate || !t.endDate) };
}

async function applyLinks(tasks: MS[]) {
  const { anchor, plan } = buildPlan(tasks);
  let added = 0;
  for (const p of plan) {
    if (p.existing) continue;
    // Replace-collection semantics: include the task's existing deps (any group) plus the new one.
    const deps = [
      ...p.task.deps.map((d) => ({ id: d.dependsOnId, offsetIsLocked: d.offsetIsLocked, offsetAnchor: 'end' })),
      { id: p.dependsOn.id, offsetIsLocked: true, offsetAnchor: p.anchorType },
    ];
    await pave({ updateTask: { $: { id: p.task.id, notify: false, updateDependentTasks: false, dependsOnTasks: deps }, task: { $: { id: p.task.id }, id: {} } } });
    added++;
  }
  return { anchor, added, total: plan.length };
}

function canWrite(access: any) { return !!access && (access.role === 'owner' || (access.features || []).includes('jt_write')); }

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });
  try {
    const { job, groups, tasks } = await load(jobId);
    if (!job || !groups.length) return NextResponse.json({ error: 'No milestone group' }, { status: 404 });
    const { anchor, plan, undated } = buildPlan(tasks);
    const linked = plan.filter((p) => p.existing).length;
    return NextResponse.json({
      job: `${job.number} ${job.name}`,
      anchor: anchor ? { id: anchor.id, name: anchor.name, start: anchor.startDate, end: anchor.endDate } : null,
      milestones: tasks.length,
      linked,
      unlinked: plan.filter((p) => !p.existing).map((p) => p.task.name),
      undated: undated.map((t) => t.name),
      fullyLinked: plan.length > 0 && linked === plan.length,
      plan: plan.map((p) => ({ task: p.task.name, dependsOn: p.dependsOn.name, type: p.anchorType === 'end' ? 'finish→start' : 'start→start', existing: p.existing })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getEffectiveAccess(auth.userId);
  if (!canWrite(access)) return NextResponse.json({ error: 'JobTread write access required' }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { jobId, action, newStart, firm } = body || {};
  if (!jobId || !['link', 'move'].includes(action)) return NextResponse.json({ error: 'jobId and action (link|move) required' }, { status: 400 });
  if (action === 'move' && !/^\d{4}-\d{2}-\d{2}$/.test(newStart || '')) return NextResponse.json({ error: 'newStart (YYYY-MM-DD) required' }, { status: 400 });

  try {
    const { job, groups, tasks } = await load(jobId);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    if (!groups.length) return NextResponse.json({ error: 'This job has no 🤖 PRODUCTION MILESTONES group' }, { status: 404 });
    const who = access.name || auth.userId;
    const stamp = todayISO();

    // 1. Links (idempotent)
    const linkRes = await applyLinks(tasks);
    if (!linkRes.anchor) return NextResponse.json({ error: 'No dated milestones to anchor on' }, { status: 400 });

    if (action === 'link') {
      if (linkRes.added > 0) {
        try { await createComment({ targetType: 'job', targetId: jobId, message: `🔗 Linked ${linkRes.added} production milestone${linkRes.added === 1 ? '' : 's'} (finish→start, offsets locked) from the BKB Hub by ${who} on ${stamp}. Moving the start anchor now cascades the whole chain.`, name: who }); } catch {}
      }
      return NextResponse.json({ ok: true, action, linked: linkRes.added, total: linkRes.total });
    }

    // 2. Move the anchor; JobTread cascades dependents.
    const anchor = linkRes.anchor;
    const oldStart = anchor.startDate!;
    const delta = toIdx(newStart) - toIdx(oldStart);
    const before = Object.fromEntries(tasks.map((t) => [t.id, { s: t.startDate, e: t.endDate }]));
    const oldEnd = tasks.map((t) => t.endDate).filter(Boolean).sort().slice(-1)[0];

    if (delta !== 0) {
      await pave({
        updateTask: {
          $: { id: anchor.id, notify: false, updateDependentTasks: true, startDate: newStart, endDate: toISO(toIdx(anchor.endDate!) + delta) },
          task: { $: { id: anchor.id }, id: {} },
        },
      });
      // 3. Verify + patch stragglers so the result is a clean whole-schedule shift.
      const after = await load(jobId);
      for (const t of after.tasks) {
        const b = before[t.id];
        if (!b?.s || !b?.e) continue;
        const wantS = toISO(toIdx(b.s) + delta), wantE = toISO(toIdx(b.e) + delta);
        if (t.startDate !== wantS || t.endDate !== wantE) {
          await pave({ updateTask: { $: { id: t.id, notify: false, updateDependentTasks: false, startDate: wantS, endDate: wantE }, task: { $: { id: t.id }, id: {} } } });
        }
      }
    }

    const newEnd = oldEnd ? toISO(toIdx(oldEnd) + delta) : null;

    // 4. Stamp the group note: START ANCHOR: Mon YYYY-MM-DD (TENTATIVE|FIRM …)
    const wd = new Date(`${newStart}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const flag = firm ? 'FIRM' : 'TENTATIVE';
    for (const g of groups) {
      const desc: string = g.description || '';
      const re = /START ANCHOR:\s*(?:\w{3}\s+)?\d{4}-\d{2}-\d{2}\s*(?:\(([^)]*)\))?/i;
      let next: string;
      const m = re.exec(desc);
      if (m) {
        // keep any trailing note inside the parens after the flag word
        const tail = (m[1] || '').replace(/^\s*(TENTATIVE|FIRM)\s*/i, '').trim();
        next = desc.replace(re, `START ANCHOR: ${wd} ${newStart} (${flag}${tail ? ' ' + tail : ''})`);
      } else {
        next = `${desc.trim()} START ANCHOR: ${wd} ${newStart} (${flag}).`.trim();
      }
      next = next.replace(/Projected completion \w{3} \d{4}-\d{2}-\d{2}\.?/, newEnd ? `Projected completion ${new Date(`${newEnd}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${newEnd}.` : '');
      if (next !== desc) await pave({ updateTask: { $: { id: g.id, description: next.slice(0, 4096), notify: false }, task: { $: { id: g.id }, id: {} } } });
    }

    // 5. Audit comment
    const dir = delta === 0 ? 'unchanged' : delta > 0 ? `pushed out ${delta} day${delta === 1 ? '' : 's'}` : `pulled in ${-delta} day${delta === -1 ? '' : 's'}`;
    const msg = `📅 Production start re-anchored from the BKB Hub by ${who} on ${stamp}: ${fmt(oldStart)} → ${fmt(newStart)} (${flag}), schedule ${dir}. Projected completion now ${newEnd ? fmt(newEnd) : '—'}.${linkRes.added ? ` Linked ${linkRes.added} milestone${linkRes.added === 1 ? '' : 's'} first so the chain cascades.` : ''}`;
    try { await createComment({ targetType: 'job', targetId: jobId, message: msg, name: who }); } catch (e) { console.warn('[reschedule] comment failed', e); }

    return NextResponse.json({ ok: true, action, job: `${job.number} ${job.name}`, oldStart, newStart, delta, oldEnd, newEnd, firm: !!firm, linked: linkRes.added, milestones: tasks.length });
  } catch (err: any) {
    console.error('[production-schedule/reschedule]', err);
    return NextResponse.json({ error: err?.message || 'Reschedule failed' }, { status: 500 });
  }
}

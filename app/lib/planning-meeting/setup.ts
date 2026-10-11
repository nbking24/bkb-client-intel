// @ts-nocheck
/**
 * Planning Meeting: set up a job with the planning structure.
 *
 * Copies the structure from A-TEST PROJECT (#100), the master copy, so every
 * job looks the same:
 *   📄 JOB PLAN (keep current, never complete)   to-do, moved to the top, template description
 *   ✅ PROJECT GATES                              to-do group with the 8 gates and their checklists (all unticked)
 *   🎨 PLANNING MILESTONES                        schedule group with the 7 gate markers (undated), moved to the top
 * Only missing pieces are created, so running it twice does nothing the second time.
 *
 * Second step (Gate 1), once a target start and rough build length are known:
 *   🤖 PRODUCTION MILESTONES                      one projected build bar from the start for N weeks,
 *                                                 with a TENTATIVE start anchor note, so the job shows on
 *                                                 the Production Schedule and the gate dates can be counted
 *                                                 back. The real milestones replace it at Gate 5.
 *   Optionally dates the 7 undated gate markers, counted back 20, 16, 14, 12, 8, 4 and 1 weeks.
 *
 * JobTread rules learned the hard way (see JobTread Assistant project, rollout notes):
 *   - one createTask per request (several in one request can 500 and get retried into duplicates)
 *   - never pass positionAfterTaskId: null on create; create, then move to the top with updateTask
 */
import { pave } from '@/app/lib/jobtread';
import { isGatesGroup, isMilestonesGroup, isPlanTodo, isOldGatesGroup, isProductionGroup, GATE_DEFAULT_WEEKS, addDays, parseDay, toDay } from './constants';

export const MASTER_JOB_ID = '22P5TUVA36x2'; // A-TEST PROJECT (#100)

async function allTasks(jobId: string) {
  const out: any[] = [];
  let page: string | null = null;
  for (let i = 0; i < 30; i++) {
    const args: any = { size: 100 };
    if (page) args.page = page;
    const d: any = await pave({ job: { $: { id: jobId }, tasks: { $: args, nextPage: {}, nodes: { id: {}, name: {}, isGroup: {}, isToDo: {}, startDate: {}, endDate: {}, parentTask: { id: {} } } } } });
    out.push(...(d?.job?.tasks?.nodes || []));
    page = d?.job?.tasks?.nextPage || null;
    if (!page) break;
  }
  return out;
}

async function taskFull(id: string) {
  const d: any = await pave({ task: { $: { id }, id: {}, name: {}, description: {}, isGroup: {}, isToDo: {}, subtasks: { name: {} } } });
  return d?.task;
}

const num = (n: string, re: RegExp) => { const m = String(n || '').match(re); return m ? Number(m[1]) : 99; };

/** Read the master structure from A-TEST. */
export async function readMaster() {
  const tasks = await allTasks(MASTER_JOB_ID);
  const planT = tasks.find((t) => !t.isGroup && t.isToDo && isPlanTodo(t.name));
  const gatesG = tasks.find((t) => t.isGroup && isGatesGroup(t.name) && !isOldGatesGroup(t.name));
  const milesG = tasks.find((t) => t.isGroup && isMilestonesGroup(t.name));
  if (!planT || !gatesG || !milesG) throw new Error('A-TEST PROJECT is missing its Job Plan, Project Gates or Planning Milestones, so there is no master copy to set up from.');
  const gateIds = tasks.filter((t) => t.parentTask?.id === gatesG.id && !t.isGroup).sort((a, b) => num(a.name, /^\s*(\d+)\./) - num(b.name, /^\s*(\d+)\./));
  const markerIds = tasks.filter((t) => t.parentTask?.id === milesG.id && !t.isGroup).sort((a, b) => num(a.name, /Gate\s+(\d+)/i) - num(b.name, /Gate\s+(\d+)/i));
  const [plan, gatesGroup, milesGroup] = await Promise.all([taskFull(planT.id), taskFull(gatesG.id), taskFull(milesG.id)]);
  const gates = [];
  for (const g of gateIds) {
    const f = await taskFull(g.id);
    gates.push({ name: f.name, description: f.description || '', items: (f.subtasks || []).map((s) => s.name) });
  }
  return {
    plan: { name: plan.name, description: plan.description || '' },
    gatesGroup: { name: gatesGroup.name, description: gatesGroup.description || '' },
    milesGroup: { name: milesGroup.name, description: milesGroup.description || '' },
    gates,
    markers: markerIds.map((m) => m.name),
  };
}

/** What a job already has and what setup would add. */
export async function planSetup(jobId: string) {
  const [jobData, tasks] = await Promise.all([
    pave({ job: { $: { id: jobId }, id: {}, name: {}, number: {}, closedOn: {} } }),
    allTasks(jobId),
  ]);
  const job = (jobData as any)?.job;
  if (!job?.id) throw new Error('Job not found');
  const has = {
    plan: tasks.some((t) => !t.isGroup && t.isToDo && isPlanTodo(t.name)),
    gates: tasks.some((t) => t.isGroup && isGatesGroup(t.name) && !isOldGatesGroup(t.name)),
    markers: tasks.some((t) => t.isGroup && isMilestonesGroup(t.name)),
  };
  const oldGates = tasks.filter((t) => t.isGroup && /DESIGN PHASE GATES/i.test(t.name) && !isOldGatesGroup(t.name)).map((t) => t.name);
  return { job: { id: job.id, name: job.name, number: job.number, closed: !!job.closedOn }, has, oldGates, block: await blockStatus(tasks) };
}

/* ---------------- projected build block ---------------- */

export const PRODUCTION_GROUP_NAME = '🤖 PRODUCTION MILESTONES — Claude Managed (Do Not Edit)';
export const BLOCK_NAME = 'Projected build (rough, replaced at Gate 5)';

/** What the job has on the production side, plus what the Job Plan says about start and length. */
async function blockStatus(tasks: any[]) {
  const prodG = tasks.find((t) => t.isGroup && isProductionGroup(t.name));
  const bars = prodG ? tasks.filter((t) => t.parentTask?.id === prodG.id && !t.isGroup) : [];
  const dated = bars.filter((t) => t.startDate).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const milesG = tasks.find((t) => t.isGroup && isMilestonesGroup(t.name));
  const markers = milesG ? tasks.filter((t) => t.parentTask?.id === milesG.id && !t.isGroup) : [];
  const planT = tasks.find((t) => !t.isGroup && t.isToDo && isPlanTodo(t.name));
  let planStart = null, planWeeks = null;
  if (planT) {
    const d = await taskFull(planT.id);
    const field = (label: string) => { const m = String(d?.description || '').match(new RegExp('^' + label + '[^:\\n]*:[ \\t]*(.*)$', 'mi')); return m && m[1].trim() ? m[1].trim() : null; };
    planStart = field('TARGET START');
    planWeeks = field('ROUGH BUILD LENGTH');
  }
  const weeksNums = String(planWeeks || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  const startIso = /^\d{4}-\d{2}-\d{2}$/.test(String(planStart || '')) ? planStart : null;
  return {
    hasGroup: !!prodG,
    bars: bars.length,
    start: dated[0]?.startDate?.slice(0, 10) || null,
    end: dated.length ? dated.map((t) => (t.endDate || t.startDate).slice(0, 10)).sort().pop() : null,
    isProjected: bars.length === 1 && bars[0].name === BLOCK_NAME,
    markers: markers.length,
    markersUndated: markers.filter((m) => !m.startDate).length,
    planStart, planWeeks,
    suggest: { start: startIso, weeks: weeksNums.length ? Math.max(...weeksNums) : null },
  };
}

/** Last day of an N-week block starting on `start`, pulled back off a weekend. */
export function blockEnd(start: string, weeks: number) {
  let end = addDays(start, Math.round(weeks * 7) - 1);
  const dow = parseDay(end).getUTCDay();
  if (dow === 6) end = addDays(end, -1);
  if (dow === 0) end = addDays(end, -2);
  return end;
}

/**
 * Add the projected build block. Refuses if the job already has production
 * milestones (those are the real schedule; move them on the Production Schedule page).
 */
export async function runBuildBlock(jobId: string, start: string, weeks: number, dateMarkers: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) throw new Error('Pick a start date.');
  if (!(weeks > 0 && weeks <= 104)) throw new Error('Rough build length must be between 1 and 104 weeks.');
  const tasks = await allTasks(jobId);
  const st = await blockStatus(tasks);
  if (st.bars > 0) throw new Error(st.isProjected ? `This job already has a projected build block (${st.start} to ${st.end}). Move it on the Production Schedule page.` : 'This job already has production milestones. Move them on the Production Schedule page instead.');
  const jt = { targetType: 'job', targetId: jobId };
  const end = blockEnd(start, weeks);
  const done: string[] = [];
  let groupId = tasks.find((t) => t.isGroup && isProductionGroup(t.name))?.id;
  const note = `START ANCHOR: ${start} (TENTATIVE, projected block)\nProjected build block added from the Hub: ${weeks} weeks from the target start. The real production milestones replace it at Gate 5 (Job Documented).`;
  if (groupId) await pave({ updateTask: { $: { id: groupId, description: note, notify: false } } });
  else groupId = await create({ ...jt, name: PRODUCTION_GROUP_NAME, isGroup: true, isToDo: false, description: note });
  await create({ ...jt, name: BLOCK_NAME, parentTaskId: groupId, isGroup: false, isToDo: false, progress: 0, startDate: start, endDate: end,
    description: `Rough build length: ${weeks} weeks. Placeholder until Gate 5, when the production milestones are built from the contract budget.` });
  done.push(`Projected build block ${start} to ${end} (${weeks} weeks) in 🤖 PRODUCTION MILESTONES, start marked tentative`);

  if (dateMarkers) {
    const r = await dateMarkersFrom(tasks, start, false);
    if (r.dated) done.push(`${r.dated} gate marker${r.dated === 1 ? '' : 's'} dated, counted back from ${start}`);
    else if (r.markers) done.push('Gate markers already had dates, left as they were');
  }
  return { done, start, end };
}

/**
 * Date the gate markers counted back from the build start, using the default
 * weeks before start for each gate (GATE_DEFAULT_WEEKS). Only undated markers
 * unless `replace` is true. Dates are a starting point; edit them in JobTread.
 */
async function dateMarkersFrom(tasks: any[], start: string, replace: boolean) {
  const milesG = tasks.find((t) => t.isGroup && isMilestonesGroup(t.name));
  const markers = milesG ? tasks.filter((t) => t.parentTask?.id === milesG.id && !t.isGroup) : [];
  let dated = 0;
  const lines: string[] = [];
  for (const m of markers) {
    if (m.startDate && !replace) continue;
    const g = Number(String(m.name).match(/Gate\s+(\d+)/i)?.[1] || 0);
    const w = GATE_DEFAULT_WEEKS[g - 2];
    if (!w) continue;
    const d = addDays(start, -7 * w);
    if (m.startDate && m.startDate.slice(0, 10) === d) continue;
    await pave({ updateTask: { $: { id: m.id, startDate: d, endDate: d, notify: false, updateDependentTasks: false } } });
    lines.push(`Gate ${g}: ${d}`);
    dated++;
  }
  return { markers: markers.length, dated, lines };
}

/**
 * "Date the gate markers" button: uses the start of the job's production
 * milestones (projected block or real schedule), or a start passed in.
 */
export async function runDateMarkers(jobId: string, start: string | null, replace: boolean) {
  const tasks = await allTasks(jobId);
  const st = await blockStatus(tasks);
  const from = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : st.start;
  if (!from) throw new Error('This job has no build start on the schedule yet. Add the projected build block first.');
  if (!st.markers) throw new Error('This job has no Planning Milestones group. Run the setup step first.');
  const r = await dateMarkersFrom(tasks, from, replace);
  const done = r.dated
    ? [`${r.dated} gate marker${r.dated === 1 ? '' : 's'} dated, counted back from ${from}: ${r.lines.join(', ')}`]
    : [replace ? 'Every gate marker already matched the default dates' : 'Every gate marker already had a date, left as it was'];
  return { done, start: from };
}

async function create(args: any) {
  const d: any = await pave({ createTask: { $: { notify: false, ...args }, createdTask: { id: {} } } });
  const id = d?.createTask?.createdTask?.id;
  if (!id) throw new Error('createTask returned no id for ' + args.name);
  return id;
}
const toTop = (id: string) => pave({ updateTask: { $: { id, notify: false, positionAfterTaskId: null, updateDependentTasks: false } } });

/** Create whatever is missing. Returns a plain-language list of what was done. */
export async function runSetup(jobId: string) {
  const before = await planSetup(jobId);
  if (before.job.closed) throw new Error('That job is closed.');
  const m = await readMaster();
  const jt = { targetType: 'job', targetId: jobId };
  const done: string[] = [];

  if (!before.has.plan) {
    const id = await create({ ...jt, name: m.plan.name, isGroup: false, isToDo: true, progress: 0, description: m.plan.description });
    await toTop(id);
    done.push('Job Plan to-do (at the top)');
  }
  if (!before.has.gates) {
    const g = await create({ ...jt, name: m.gatesGroup.name, isGroup: true, isToDo: true, description: m.gatesGroup.description });
    let prev: string | null = null;
    for (const gate of m.gates) {
      prev = await create({
        ...jt, name: gate.name, parentTaskId: g, isGroup: false, isToDo: true, progress: 0, description: gate.description,
        subtasks: gate.items.map((name) => ({ name, isComplete: false })),
        ...(prev ? { positionAfterTaskId: prev } : {}),
      });
    }
    done.push(`Project Gates with ${m.gates.length} gates and ${m.gates.reduce((n, x) => n + x.items.length, 0)} checklist items, all unticked`);
  }
  if (!before.has.markers) {
    const g = await create({ ...jt, name: m.milesGroup.name, isGroup: true, isToDo: false, description: m.milesGroup.description });
    await toTop(g);
    let prev: string | null = null;
    for (const name of m.markers) {
      prev = await create({ ...jt, name, parentTaskId: g, isGroup: false, isToDo: false, progress: 0, ...(prev ? { positionAfterTaskId: prev } : {}) });
    }
    done.push(`Planning Milestones with ${m.markers.length} undated gate markers (at the top of the schedule)`);
  }
  return { job: before.job, done, oldGates: before.oldGates };
}

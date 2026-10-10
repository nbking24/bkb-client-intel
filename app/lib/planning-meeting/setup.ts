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
 * JobTread rules learned the hard way (see JobTread Assistant project, rollout notes):
 *   - one createTask per request (several in one request can 500 and get retried into duplicates)
 *   - never pass positionAfterTaskId: null on create; create, then move to the top with updateTask
 */
import { pave } from '@/app/lib/jobtread';
import { isGatesGroup, isMilestonesGroup, isPlanTodo, isOldGatesGroup } from './constants';

export const MASTER_JOB_ID = '22P5TUVA36x2'; // A-TEST PROJECT (#100)

async function allTasks(jobId: string) {
  const out: any[] = [];
  let page: string | null = null;
  for (let i = 0; i < 30; i++) {
    const args: any = { size: 100 };
    if (page) args.page = page;
    const d: any = await pave({ job: { $: { id: jobId }, tasks: { $: args, nextPage: {}, nodes: { id: {}, name: {}, isGroup: {}, isToDo: {}, parentTask: { id: {} } } } } });
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
  return { job: { id: job.id, name: job.name, number: job.number, closed: !!job.closedOn }, has, oldGates };
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

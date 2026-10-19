// @ts-nocheck
/**
 * Planning Meeting: the Prep Brief.
 *
 * Reads every open job at Status "5. Design Phase" from JobTread and returns,
 * per job, what the meeting card needs (gates, markers, production dates, open
 * tasks, roadblocks, selections, last activity, old documents) plus the flags
 * the Prep Brief shows. The rules are fixed and deliberately simple; anything
 * no rule catches is left to Heather to add as a talking point.
 *
 * Rules (agreed with Nathan 2026-10-10):
 *   RED    Start at risk    production start exists and a gate's due date has
 *                           passed with its checklist not done. Due dates come
 *                           from the 🎨 PLANNING MILESTONES markers when dated,
 *                           otherwise counted back from the start (20,16,14,12,8,4,1 wks).
 *   RED    Status mismatch  Status is Design Phase but production has started or
 *                           starts within 30 days.
 *   AMBER  Overdue task     open task in 🔵 ACTIVE (or loose) past its due date.
 *   AMBER  Aging ask        task type Pending waiting more than 14 days.
 *   AMBER  Unsigned contract construction contract pending more than 14 days.
 *   AMBER  Quiet job        no comment, daily log or new task in 14 days.
 *   AMBER  Gate due soon    a gate due within 14 days with its checklist not done.
 *   AMBER  Decision past due a decision line (Status 0 to 3) past its Decide By date.
 *   HOUSE  No Decide By     open decision lines with no Decide By date, once the
 *                           Gate 2 concept and budget approval is ticked (added 2026-10-11).
 *   HOUSE  Task type says done, old draft/pending documents, tasks outside 🔵 ACTIVE
 *          or no 🔵 ACTIVE group.
 * Setup gaps (Job Plan blank, design lead and PM not named, markers undated)
 * are shown once at the top, not as flags.
 */
import { pave, getActiveJobs } from '@/app/lib/jobtread';
import { findPlanGroup } from './job-plan';
import { fetchJobContext, jobInsight, TeamContext } from './insight';
import {
  DESIGN_STATUS, SELECTION_STATUS_CF_ID, SELECTION_FLAG_CF_ID, PLAN_TAG_CF_ID, DECIDE_BY_CF_ID, isUndecided, GATE_DEFAULT_WEEKS, RULES, DONE_LIKE_TYPES, ANCHOR_NAME, ROADBLOCK_TASK_TYPE_NAME,
  isActiveGroup, isGatesGroup, isPlanTodo, isMilestonesGroup, isProductionGroup, isFieldGroup, isCompletedGroup, isOldGatesGroup,
  addDays, daysBetween, fmtDay, shortJobName, todayEastern,
} from './constants';

const JT_ORG = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';

/* ---------------------------------------------------------------- JobTread reads */

function isTooBig(err: any) {
  return /413|too large|cost/i.test(String(err?.message || err));
}

/** All tasks on a job, paginated. Falls back to smaller pages on a 413. */
export async function fetchJobTasks(jobId: string): Promise<any[]> {
  const nodes = {
    id: {}, name: {}, isGroup: {}, isToDo: {}, progress: {}, startDate: {}, endDate: {}, createdAt: {},
    parentTask: { id: {} },
    taskType: { id: {}, name: {} },
    subtasks: { name: {}, isComplete: {} },
    assignedMemberships: { nodes: { id: {} } },
  };
  for (const size of [100, 50, 25]) {
    try {
      const out: any[] = [];
      let page: string | null = null;
      for (let i = 0; i < 30; i++) {
        const args: any = { size };
        if (page) args.page = page;
        const data: any = await pave({ job: { $: { id: jobId }, tasks: { $: args, nextPage: {}, nodes } } });
        const conn = data?.job?.tasks;
        out.push(...(conn?.nodes || []));
        page = conn?.nextPage || null;
        if (!page) break;
      }
      return out;
    } catch (e) {
      if (!isTooBig(e) || size === 25) throw e;
    }
  }
  return [];
}

async function fetchJobExtras(jobId: string) {
  const data: any = await pave({
    job: {
      $: { id: jobId },
      documents: {
        $: { size: 100, where: { or: [['status', '=', 'draft'], ['status', '=', 'pending']] } },
        nodes: { id: {}, name: {}, type: {}, status: {}, createdAt: {} },
      },
      dailyLogs: { $: { size: 1, sortBy: [{ field: ['date'], order: 'desc' }] }, nodes: { date: {} } },
      comments: { $: { size: 1, sortBy: [{ field: ['createdAt'], order: 'desc' }] }, nodes: { createdAt: {} } },
    },
  });
  const j = data?.job || {};
  return {
    docs: j.documents?.nodes || [],
    lastLog: j.dailyLogs?.nodes?.[0]?.date || null,
    lastComment: j.comments?.nodes?.[0]?.createdAt || null,
  };
}

/**
 * Decision lines on the job's budget (not document copies): Status counts, and
 * every undecided decision (Status 0 to 3) with its Decide By date and Plan Tag.
 * A decision line is a line flagged Selection.
 */
async function fetchDecisions(jobId: string) {
  const counts: Record<string, number> = {};
  const open: any[] = [];
  let page: string | null = null;
  for (let i = 0; i < 30; i++) {
    const args: any = { size: 100, where: { and: [[['document', 'id'], '=', null]] } };
    if (page) args.page = page;
    const data: any = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: args,
          nextPage: {},
          nodes: {
            id: {}, name: {},
            customFieldValues: {
              $: { size: 4, where: { and: [[['customField', 'id'], 'in', [SELECTION_STATUS_CF_ID, DECIDE_BY_CF_ID, SELECTION_FLAG_CF_ID, PLAN_TAG_CF_ID]]] } },
              nodes: { value: {}, customField: { id: {} } },
            },
          },
        },
      },
    });
    const conn = data?.job?.costItems;
    for (const n of conn?.nodes || []) {
      const cf: Record<string, any> = {};
      for (const v of n?.customFieldValues?.nodes || []) cf[v?.customField?.id] = v?.value;
      const status = cf[SELECTION_STATUS_CF_ID] || null;
      const flagged = cf[SELECTION_FLAG_CF_ID] === true || cf[SELECTION_FLAG_CF_ID] === 'true';
      if (status) counts[status] = (counts[status] || 0) + 1;
      // only lines flagged Selection are decisions (a Status left on an allowance or margin line is ignored)
      if (flagged && isUndecided(status)) {
        open.push({ id: n.id, name: dec(n.name), status, tag: cf[PLAN_TAG_CF_ID] || null, decideBy: cf[DECIDE_BY_CF_ID] ? String(cf[DECIDE_BY_CF_ID]).slice(0, 10) : null });
      }
    }
    page = conn?.nextPage || null;
    if (!page) break;
  }
  open.sort((a, b) => (a.decideBy || '9999') < (b.decideBy || '9999') ? -1 : 1);
  return { counts, open };
}

async function fetchTaskDescription(taskId: string): Promise<string> {
  const data: any = await pave({ task: { $: { id: taskId }, description: {} } });
  return data?.task?.description || '';
}

/** Internal JobTread memberships: id -> full name. */
export async function fetchMembers(): Promise<{ id: string; name: string }[]> {
  const all: any[] = [];
  let page: string | null = null;
  for (let i = 0; i < 10; i++) {
    const args: any = { size: 100 };
    if (page) args.page = page;
    const out: any = await pave({
      organization: { $: { id: JT_ORG() }, memberships: { $: args, nextPage: {}, nodes: { id: {}, user: { name: {} }, role: { type: {} } } } },
    });
    const conn = out?.organization?.memberships;
    for (const m of conn?.nodes || []) {
      const name = (m?.user?.name || '').trim();
      if (m?.role?.type === 'internal' && name && name !== 'Loop CRM') all.push({ id: m.id, name });
    }
    page = conn?.nextPage || null;
    if (!page) break;
  }
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------------------------------------------------------- helpers */

const easternDay = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) : null;

const gateNum = (name: string) => {
  const m = String(name || '').match(/^\s*(\d+)\./);
  return m ? Number(m[1]) : 99;
};
const markerGate = (name: string) => {
  const m = String(name || '').match(/Gate\s+(\d+)/i);
  return m ? Number(m[1]) : 99;
};
const dueOf = (t: any) => (t.endDate || t.startDate || null);
const isOpen = (t: any) => (t.progress ?? 0) < 1;
const firstName = (n: string) => String(n || '').split(' ')[0];
/** JobTread returns some names HTML-escaped ("Containment &amp; Demo"). */
const dec = (s: string | null | undefined) => (s == null ? s : String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));

async function inBatches<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  }
  return out;
}

/* ---------------------------------------------------------------- one job */

export interface LastMeetingTask { jt_task_id: string; job_id: string; kind: string; name: string; assignee?: string; due_date?: string }

async function buildJob(job: any, today: string, memberName: Record<string, string>, lastTasks: LastMeetingTask[]) {
  const [tasks, extras, dl] = await Promise.all([
    fetchJobTasks(job.id),
    fetchJobExtras(job.id),
    fetchDecisions(job.id).catch(() => ({ counts: {}, open: [], failed: true })),
  ]);
  const sel = dl.counts;
  const decisions = {
    list: dl.open.filter((x) => x.decideBy),
    overdue: dl.open.filter((x) => x.decideBy && x.decideBy < today),
    undated: dl.open.filter((x) => !x.decideBy).length,
    open: dl.open.length,
    failed: !!dl.failed,
  };
  const byId: Record<string, any> = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const kids = (id: string) => tasks.filter((t) => t.parentTask?.id === id);
  const groups = tasks.filter((t) => t.isGroup);

  const activeGroup = groups.find((g) => !g.isToDo && isActiveGroup(g.name)) || groups.find((g) => isActiveGroup(g.name));
  const gatesGroup = groups.find((g) => isGatesGroup(g.name) && !isOldGatesGroup(g.name));
  const milesGroup = groups.find((g) => isMilestonesGroup(g.name));
  const prodGroup = groups.find((g) => isProductionGroup(g.name));

  // gates
  const gates = gatesGroup
    ? kids(gatesGroup.id).filter((t) => !t.isGroup).sort((a, b) => gateNum(a.name) - gateNum(b.name)).map((g) => ({
        id: g.id,
        name: g.name,
        items: (g.subtasks || []).map((s) => [s.name, !!s.isComplete]),
      }))
    : [];
  const gateDone = (g) => g.items.filter((i) => i[1]).length;
  const curGate = gates.findIndex((g) => gateDone(g) < g.items.length);
  const done = gates.reduce((n, g) => n + gateDone(g), 0);
  const total = gates.reduce((n, g) => n + g.items.length, 0);

  // markers
  const markers = milesGroup
    ? kids(milesGroup.id).filter((t) => !t.isGroup).sort((a, b) => markerGate(a.name) - markerGate(b.name)).map((m) => ({
        id: m.id, name: m.name, gate: markerGate(m.name), date: dueOf(m),
      }))
    : [];

  // production
  const prod = prodGroup ? kids(prodGroup.id).filter((t) => !t.isGroup && t.startDate) : [];
  prod.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const start = prod[0]?.startDate || null;
  const startName = dec(prod[0]?.name) || null;
  const last = prod.slice().sort((a, b) => ((a.endDate || '') > (b.endDate || '') ? -1 : 1))[0];

  // open tasks: in ACTIVE, plus loose top-level tasks
  const lastIds = new Set(lastTasks.map((t) => t.jt_task_id));
  const toCard = (t: any, src: string) => {
    const due = dueOf(t);
    const type = t.taskType?.name || null;
    const doneLike = type && DONE_LIKE_TYPES.includes(type);
    const overdue = !!due && due < today && !doneLike;
    return {
      id: t.id, name: dec(t.name), due, type, src,
      who: (t.assignedMemberships?.nodes || []).map((m) => firstName(memberName[m.id] || '')).filter(Boolean),
      overdue, days: overdue ? daysBetween(due, today) : 0, doneLike: !!doneLike,
      created: easternDay(t.createdAt),
      fromLast: lastIds.has(t.id),
      roadblock: type === ROADBLOCK_TASK_TYPE_NAME,
    };
  };
  const activeTasks = activeGroup ? kids(activeGroup.id).filter((t) => !t.isGroup && isOpen(t) && t.name !== ANCHOR_NAME) : [];
  const looseTasks = tasks.filter((t) => !t.parentTask && !t.isGroup && isOpen(t) && !isPlanTodo(t.name));
  const openTasks = [...activeTasks.map((t) => toCard(t, 'ACTIVE')), ...looseTasks.map((t) => toCard(t, 'Not in ACTIVE'))]
    .sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1);

  // roadblocks anywhere on the job
  const roadblocks = tasks.filter((t) => !t.isGroup && isOpen(t) && t.taskType?.name === ROADBLOCK_TASK_TYPE_NAME).map((t) => ({
    ...toCard(t, 'Roadblock'), daysOpen: daysBetween(easternDay(t.createdAt) || today, today),
  }));

  // last meeting's tasks for this job, with live status
  const lastMeeting = lastTasks.filter((t) => t.job_id === job.id).map((t) => {
    const live = byId[t.jt_task_id];
    const isDone = live ? !isOpen(live) : true; // gone from JobTread counts as closed
    const due = live ? dueOf(live) : t.due_date;
    const status = isDone ? 'done' : due && due < today ? 'late' : 'open';
    return { id: t.jt_task_id, name: dec(live?.name) || t.name, kind: t.kind, who: t.assignee, due, status, missing: !live };
  });

  // last activity
  const scaffold = new Set([gatesGroup?.id, milesGroup?.id, prodGroup?.id].filter(Boolean));
  const taskDays = tasks
    .filter((t) => !t.isGroup && t.name !== ANCHOR_NAME && !isPlanTodo(t.name) && !scaffold.has(t.parentTask?.id))
    .map((t) => easternDay(t.createdAt)).filter(Boolean);
  const candidates = [
    { date: easternDay(extras.lastComment), what: 'comment' },
    { date: extras.lastLog, what: 'daily log' },
    { date: taskDays.sort().pop() || null, what: 'new task' },
  ].filter((c) => c.date);
  const lastActivity = candidates.sort((a, b) => (a.date > b.date ? -1 : 1))[0] || null;

  // job plan: the description of the 📋 Project Details budget group. Blank?
  let jobPlanBlank = true;
  let planText = '';
  let planGroupId: string | null = null;
  try {
    const pg = await findPlanGroup(job.id);
    if (pg) {
      planGroupId = pg.id;
      planText = pg.description;
      jobPlanBlank = !planText.trim() || /DESIGN LEAD:[ \t]*\n[ \t]*PM:[ \t]*\n[ \t]*TARGET START:[ \t]*\n/.test(planText);
    }
  } catch { /* leave as blank */ }
  const planField = (label: string) => {
    const m = planText.match(new RegExp('^' + label + ':[ \\t]*(.*)$', 'mi'));
    return m && m[1].trim() ? m[1].trim() : null;
  };
  const plan = { designLead: planField('DESIGN LEAD'), pm: planField('PM'), targetStart: planField('TARGET START'), clientWindow: planField('CLIENT TARGET WINDOW') };

  const short = shortJobName(job.name, job.number);
  return {
    id: job.id, number: job.number, name: dec(job.name), short, status: job.customStatus,
    gates, gatesGroupId: gatesGroup?.id || null, curGate: curGate < 0 ? (gates.length ? gates.length - 1 : 0) : curGate, done, total,
    markers, milesGroupId: milesGroup?.id || null,
    start, startName, end: last?.endDate || null, endName: dec(last?.name) || null,
    activeGroupId: activeGroup?.id || null,
    tasks: openTasks, roadblocks, lastMeeting,
    sel, decisions, lastActivity,
    docs: extras.docs.map((d) => ({ name: d.name, type: d.type, status: d.status, created: easternDay(d.createdAt) })),
    planGroupId, jobPlanBlank, plan, planText, _planText: jobPlanBlank ? '' : planText,
    setup: {
      jobPlanBlank,
      leadNotNamed: gates[0] ? !gates[0].items[0]?.[1] : true,
      markersUndated: markers.length > 0 && markers.every((m) => !m.date),
      noStructure: !gatesGroup || !milesGroup,
    },
  };
}

/* ---------------------------------------------------------------- flags */

function flagsFor(j: any, today: string) {
  const flags: any[] = [];
  const add = (sev, kind, key, text, owner) => flags.push({ id: `${kind}|${j.id}|${key}`, jobId: j.id, job: j.short, sev, kind, text, owner });
  const gateDone = (g) => g.items.filter((i) => i[1]).length;
  const gateComplete = (n) => { const g = j.gates[n - 1]; return !g || gateDone(g) >= g.items.length; };

  // gate due dates: marker date if set, else counted back from the start
  const gateDue = [];
  for (let n = 2; n <= 8; n++) {
    const m = j.markers.find((x) => x.gate === n);
    const d = m?.date || (j.start ? addDays(j.start, -7 * GATE_DEFAULT_WEEKS[n - 2]) : null);
    if (d) gateDue.push({ n, d, set: !!m?.date });
  }

  if (j.start) {
    const past = gateDue.filter((g) => g.d < today && !gateComplete(g.n));
    const days = daysBetween(today, j.start);
    if (past.length) {
      const nxt = gateDue.find((g) => g.d >= today);
      const how = past.every((g) => g.set) ? 'By the gate dates set on the schedule' : 'Counted back with the default weeks';
      add('red', 'Start at risk', 'start',
        `${j.startName} starts ${fmtDay(j.start)} (${days} days). ${how}, Gate${past.length > 1 ? 's' : ''} ${past.map((g) => g.n).join(', ')} ${past.length > 1 ? 'are' : 'is'} past due, and ${j.done} of ${j.total} checklist items are ticked.` +
        (nxt ? ` Gate ${nxt.n} is due ${fmtDay(nxt.d)}.` : '') + ' Confirm the start or move it.', 'Nathan');
    } else {
      const soon = gateDue.find((g) => g.d >= today && daysBetween(today, g.d) <= RULES.gateDueSoonDays && !gateComplete(g.n));
      if (soon) {
        const g = j.gates[soon.n - 1];
        add('amber', 'Gate due soon', `gate${soon.n}`, `Gate ${soon.n} (${g?.name?.replace(/^\d+\.\s*/, '') || ''}) is due ${fmtDay(soon.d)}${soon.set ? '' : ' by the default weeks'}. ${g ? gateDone(g) : 0} of ${g?.items.length || 0} items ticked.`, 'Design lead');
      }
    }
    if (days <= RULES.statusMismatchDays) {
      add('red', 'Status mismatch', 'status',
        `Status says ${j.status || 'Design Phase'}, but ${j.startName} ${days < 0 ? 'started' : 'starts'} ${fmtDay(j.start)}${days >= 0 ? ` (${days} days)` : ''}. Should the Status move up?`, 'Nathan');
    }
  }

  for (const t of j.tasks) {
    if (t.doneLike) {
      add('house', 'Task type says done', `type:${t.id}`, `"${t.name}" has type ${t.type} but is not ticked complete. Tick it or change the type.`, t.who[0] || 'Heather');
    } else if (t.type === 'Pending') {
      const since = t.due || t.created;
      if (since && daysBetween(since, today) > RULES.agingAskDays) {
        add('amber', 'Aging ask', `ask:${t.id}`, `"${t.name}" has been waiting since ${fmtDay(since)} (${daysBetween(since, today)} days)${t.who.length ? '' : ', and nobody is assigned'}.`, t.who.join(', ') || 'No owner');
      }
    } else if (t.overdue && !t.roadblock) {
      add('amber', 'Overdue task', `late:${t.id}`, `"${t.name}", ${t.who.join(', ') || 'no one assigned'}, due ${fmtDay(t.due)} (${t.days} day${t.days === 1 ? '' : 's'} late).`, t.who.join(', ') || 'No owner');
    }
  }

  // decisions: past their Decide By and still undecided; open decisions with no date once the concept is approved
  const od = j.decisions?.overdue || [];
  if (od.length) {
    add('amber', 'Decision past due', 'decide',
      `${od.length} decision${od.length === 1 ? ' is' : 's are'} past the Decide By date and not decided: ${od.slice(0, 3).map((x) => `"${x.name}"${x.tag ? ' (' + x.tag + ')' : ''} by ${fmtDay(x.decideBy)}`).join(', ')}${od.length > 3 ? ', ...' : ''}. Decide, or set a new date and say what it does to the start.`, 'Heather');
  }
  const conceptOk = !!j.gates[1]?.items.find((i) => /concept and budget/i.test(i[0]))?.[1];
  if (conceptOk && (j.decisions?.undated || 0) > 0) {
    add('house', 'No Decide By', 'undated', `${j.decisions.undated} open decision${j.decisions.undated === 1 ? ' has' : 's have'} no Decide By date. Set it on each decision line in the budget (Selections ONLY view).`, 'Heather');
  }

  if (j.lastActivity && daysBetween(j.lastActivity.date, today) > RULES.quietDays) {
    add('amber', 'Quiet job', 'quiet', `No comment, daily log or new task since ${fmtDay(j.lastActivity.date)} (${daysBetween(j.lastActivity.date, today)} days).${j.start ? '' : ' No production dates.'} On hold?`, 'Nathan');
  }

  const old = j.docs.filter((d) => d.created && daysBetween(d.created, today) > RULES.oldDocumentDays);
  for (const d of old.filter((d) => /contract/i.test(d.name) && d.type === 'customerOrder' && d.status === 'pending')) {
    add('amber', 'Unsigned contract', `contract:${d.created}`, `${d.name} sent ${fmtDay(d.created)}, still not signed (${daysBetween(d.created, today)} days).`, 'Nathan');
  }
  const rest = old.filter((d) => !(/contract/i.test(d.name) && d.type === 'customerOrder' && d.status === 'pending'));
  if (rest.length) {
    const grp: Record<string, any> = {};
    for (const d of rest) {
      const k = `${d.name}|${d.type}|${d.status}`;
      (grp[k] = grp[k] || { ...d, count: 0, oldest: d.created }).count++;
      if (d.created < grp[k].oldest) grp[k].oldest = d.created;
    }
    const owners = new Set<string>();
    const parts = Object.values(grp).map((g: any) => {
      owners.add(g.type === 'customerInvoice' || g.type === 'vendorBill' ? 'Terri' : 'Heather');
      const label = g.type === 'vendorBill' ? 'vendor bill' : `"${g.name}" document`;
      return `${g.count} ${g.status} ${label}${g.count > 1 ? 's' : ''}, oldest ${fmtDay(g.oldest)}.`;
    });
    add('house', 'Old documents', 'docs', parts.join(' ') + ' Send them, clear out the stale ones, or confirm they are still needed.', [...owners].join(', '));
  }

  if (!j.activeGroupId) {
    add('house', 'No ACTIVE group', 'noactive', 'No 🔵 ACTIVE group, so new commitments have nowhere to go. The Hub creates it on Confirm, or add it now.', 'Heather');
  }
  const loose = j.tasks.filter((t) => t.src !== 'ACTIVE');
  if (loose.length) {
    add('house', 'Tasks outside ACTIVE', 'loose', `${loose.length === 1 ? 'This task is' : 'These tasks are'} on the schedule but not in 🔵 ACTIVE, so ${loose.length === 1 ? 'it is' : 'they are'} easy to miss and won't be swept when done: ${loose.slice(0, 3).map((t) => `"${t.name}"${t.due ? ' (' + fmtDay(t.due) + ')' : ''}`).join(', ')}${loose.length > 3 ? ', ...' : ''}. If it already happened, tick it complete. If not, use "Move to ACTIVE" on the job card.`, 'Heather');
  }
  return flags;
}

function agendaFor(j: any) {
  const pts: string[] = [];
  const k = j.gates[0];
  if (k) {
    const open = k.items.filter((i) => !i[1]).length;
    if (open) pts.push(`Kickoff is ${k.items.length - open} of ${k.items.length} done.${j.setup.leadNotNamed ? ' Name the design lead and PM.' : ''}${j.start ? '' : ' Set a target start.'}${j.jobPlanBlank ? ' Assign who fills in the Job Plan.' : ''}`);
  } else {
    pts.push('This job has no ✅ PROJECT GATES yet. Set it up before the next meeting.');
  }
  if (j.start && j.setup.markersUndated) pts.push('Set the 7 gate dates. Defaults counted back from the start are one click away below.');
  return pts;
}

/* ---------------------------------------------------------------- the brief */

export async function buildBrief(opts: { lastTasks?: LastMeetingTask[]; today?: string; insights?: boolean; team?: Record<string, TeamContext> } = {}) {
  const today = opts.today || todayEastern();
  const [jobs, members] = await Promise.all([getActiveJobs(500), fetchMembers()]);
  const design = jobs.filter((j: any) => j.customStatus === DESIGN_STATUS);
  const memberName = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const errors: string[] = [];
  const built = (await inBatches(design, 3, async (j: any) => {
    try {
      return await buildJob(j, today, memberName, opts.lastTasks || []);
    } catch (e: any) {
      errors.push(`${j.name}: ${String(e?.message || e).slice(0, 200)}`);
      return null;
    }
  })).filter(Boolean);
  for (const j of built) {
    j.flags = flagsFor(j, today);
    j.agenda = agendaFor(j);
  }
  // Claude's read of each job (best effort; the brief still works without it)
  if (opts.insights !== false) {
    await inBatches(built, 4, async (j: any) => {
      try {
        const ctx = await fetchJobContext(j.id, today);
        j.insight = await jobInsight(j, ctx, j._planText, today, opts.team?.[j.id] || {});
      } catch (e: any) {
        j.insight = null;
        errors.push(`${j.short} review: ${String(e?.message || e).slice(0, 120)}`);
      }
    });
  }
  for (const j of built) delete j._planText;
  built.sort((a, b) => (a.start && b.start ? (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) : a.start ? -1 : b.start ? 1 : Number(a.number) - Number(b.number)));
  return { asOf: today, builtAt: new Date().toISOString(), jobs: built, members, errors };
}

/** One job by id, with flags and agenda (used for testing and single-job refresh). */
export async function buildJobById(jobId: string, opts: { lastTasks?: LastMeetingTask[]; today?: string } = {}) {
  const today = opts.today || todayEastern();
  const [data, members] = await Promise.all([
    pave({ job: { $: { id: jobId }, id: {}, name: {}, number: {} } }),
    fetchMembers(),
  ]);
  const memberName = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const j: any = await buildJob({ ...(data as any).job, customStatus: 'test' }, today, memberName, opts.lastTasks || []);
  j.flags = flagsFor(j, today);
  j.agenda = agendaFor(j);
  return { job: j, members };
}

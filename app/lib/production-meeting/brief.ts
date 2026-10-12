// @ts-nocheck
/**
 * Production Meeting: the Production Brief.
 *
 * Reads every open job at Status "6. In Production" and "6.5 Ongoing / Punch
 * List" (minus the non-client jobs) from JobTread, plus the Hub's nightly money
 * caches, and returns per job what the Monday meeting needs: production
 * milestones with baselines, field tasks, open tasks and roadblocks, decision
 * lines that still need deciding or ordering, last activity, unsigned change
 * orders, and the flags.
 *
 * Rules (agreed with Nathan 2026-10-12; thresholds in PROD_RULES):
 *   RED    Milestone late     an open production milestone past its end date
 *   RED    Behind baseline    an open milestone finishing 5+ days after its baseline
 *   RED    Past finish date   every milestone was due and the job is still at 6
 *   RED    Cost running over  projected margin slipping or cost over budget (money cache)
 *   AMBER  Billing behind, Change order not invoiced, Under-billed (invoicing cache)
 *   AMBER  Decision past due  decision line at Status 0 to 3 past its Decide By
 *   AMBER  No daily log       5 working days without a daily log (jobs at 6 only)
 *   AMBER  Change order unsigned  a priced customer order pending 7+ days
 *   AMBER  Overdue task, Aging ask (same as the planning meeting)
 *   AMBER  Punch jobs: No punch list, Quiet job (14 days), Final invoice
 *   HOUSE  No production milestones, No baseline, No FIELD TASKS, No ACTIVE group,
 *          Task type says done
 * Money detail (dollars) is kept on job.money and stripped by the API for
 * anyone who is not an owner. Flags never carry dollar amounts.
 */
import { pave, getActiveJobs } from '@/app/lib/jobtread';
import { fetchMembers } from '../planning-meeting/brief';
import {
  SELECTION_STATUS_CF_ID, SELECTION_FLAG_CF_ID, PLAN_TAG_CF_ID, DECIDE_BY_CF_ID, isUndecided, DONE_LIKE_TYPES, ANCHOR_NAME, ROADBLOCK_TASK_TYPE_NAME,
  isActiveGroup, isProductionGroup, isFieldGroup, isPlanTodo, isGatesGroup, isMilestonesGroup, normName,
  addDays, daysBetween, fmtDay, shortJobName, todayEastern,
} from '../planning-meeting/constants';
import { PRODUCTION_STATUS, PUNCH_STATUS, EXCLUDED_JOB_NUMBERS, isOngoingJob, PROD_RULES, workingDaysBetween } from './constants';
import { readMoney, moneyFor, moneyFlags } from './money';

/* ---------------------------------------------------------------- JobTread reads */

const isTooBig = (err: any) => /413|too large|cost/i.test(String(err?.message || err));

async function fetchTasks(jobId: string): Promise<any[]> {
  const nodes = {
    id: {}, name: {}, isGroup: {}, isToDo: {}, progress: {}, startDate: {}, endDate: {}, createdAt: {},
    baselineStartDate: {}, baselineEndDate: {},
    parentTask: { id: {} },
    taskType: { id: {}, name: {} },
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

async function fetchExtras(jobId: string) {
  const data: any = await pave({
    job: {
      $: { id: jobId },
      documents: {
        $: { size: 50, where: { and: [['type', '=', 'customerOrder'], ['status', '=', 'pending']] } },
        nodes: { id: {}, name: {}, createdAt: {}, price: {} },
      },
      dailyLogs: { $: { size: 1, sortBy: [{ field: ['date'], order: 'desc' }] }, nodes: { date: {} } },
      comments: { $: { size: 1, sortBy: [{ field: ['createdAt'], order: 'desc' }] }, nodes: { createdAt: {} } },
      timeEntries: { $: { size: 1, sortBy: [{ field: ['startedAt'], order: 'desc' }] }, nodes: { startedAt: {} } },
    },
  });
  const j = data?.job || {};
  return {
    pendingOrders: j.documents?.nodes || [],
    lastLog: j.dailyLogs?.nodes?.[0]?.date || null,
    lastComment: j.comments?.nodes?.[0]?.createdAt || null,
    lastTime: j.timeEntries?.nodes?.[0]?.startedAt || null,
  };
}

/** Every decision line (flagged Selection) with its Status, Decide By and Plan Tag. */
async function fetchDecisionLines(jobId: string) {
  const lines: any[] = [];
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
      const flagged = cf[SELECTION_FLAG_CF_ID] === true || cf[SELECTION_FLAG_CF_ID] === 'true';
      if (!flagged) continue;
      lines.push({
        id: n.id, name: dec(n.name), status: cf[SELECTION_STATUS_CF_ID] || null, tag: cf[PLAN_TAG_CF_ID] || null,
        decideBy: cf[DECIDE_BY_CF_ID] ? String(cf[DECIDE_BY_CF_ID]).slice(0, 10) : null,
      });
    }
    page = conn?.nextPage || null;
    if (!page) break;
  }
  const byDate = (a, b) => ((a.decideBy || '9999') < (b.decideBy || '9999') ? -1 : 1);
  const st = (x) => String(x.status || '');
  return {
    undecided: lines.filter((x) => isUndecided(x.status)).sort(byDate),
    toOrder: lines.filter((x) => /^4\./.test(st(x))).sort(byDate),       // decided, not ordered
    onOrder: lines.filter((x) => /^[56]\./.test(st(x))).sort(byDate),    // ordered, not delivered
    total: lines.length,
  };
}

/* ---------------------------------------------------------------- helpers */

const easternDay = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) : null;
const dueOf = (t: any) => t.endDate || t.startDate || null;
const isOpen = (t: any) => (t.progress ?? 0) < 1;
const firstName = (n: string) => String(n || '').split(' ')[0];
const dec = (s: string | null | undefined) => (s == null ? s : String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
const pct = (p: any) => Math.round(100 * (Number(p) || 0));

async function inBatches<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}

/* ---------------------------------------------------------------- one job */

export interface LastMeetingTask { jt_task_id: string; job_id: string; kind: string; name: string; assignee?: string; due_date?: string }

async function buildJob(job: any, today: string, memberName: Record<string, string>, lastTasks: LastMeetingTask[]) {
  const [tasks, extras, dl] = await Promise.all([
    fetchTasks(job.id),
    fetchExtras(job.id),
    fetchDecisionLines(job.id).catch(() => ({ undecided: [], toOrder: [], onOrder: [], total: 0, failed: true })),
  ]);
  const byId: Record<string, any> = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const kids = (id: string) => tasks.filter((t) => t.parentTask?.id === id);
  const groups = tasks.filter((t) => t.isGroup);
  const who = (t: any) => (t.assignedMemberships?.nodes || []).map((m) => firstName(memberName[m.id] || '')).filter(Boolean);

  const activeGroup = groups.find((g) => !g.isToDo && isActiveGroup(g.name)) || groups.find((g) => isActiveGroup(g.name));
  const prodGroup = groups.find((g) => isProductionGroup(g.name));
  const fieldGroup = groups.find((g) => isFieldGroup(g.name));
  // scaffolding groups (gates, old gate lists, milestone markers, production milestones) never count as punch items or activity
  const scaffold = new Set(groups.filter((g) => isGatesGroup(g.name) || /GATES/.test(normName(g.name)) || isMilestonesGroup(g.name) || isProductionGroup(g.name)).map((g) => g.id));

  // production milestones, with baseline slip in days (positive = later than baseline)
  const milestones = (prodGroup ? kids(prodGroup.id).filter((t) => !t.isGroup && (t.startDate || t.endDate)) : [])
    .map((t) => {
      const end = t.endDate || t.startDate;
      const bEnd = t.baselineEndDate || null;
      return {
        id: t.id, name: dec(t.name), start: t.startDate || end, end, progress: pct(t.progress), done: !isOpen(t),
        bStart: t.baselineStartDate || null, bEnd, slip: bEnd && end ? daysBetween(bEnd, end) : null,
        who: who(t),
      };
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const openMs = milestones.filter((m) => !m.done);
  const current = openMs.filter((m) => m.start <= today);
  const next = openMs.find((m) => m.start > today) || null;
  const finish = milestones.reduce((d, m) => (m.end && (!d || m.end > d) ? m.end : d), null);
  const baselineFinish = milestones.reduce((d, m) => (m.bEnd && (!d || m.bEnd > d) ? m.bEnd : d), null);

  // field tasks (crew plan)
  const fieldTasks = (fieldGroup ? kids(fieldGroup.id).filter((t) => !t.isGroup && isOpen(t)) : []).map((t) => ({
    id: t.id, name: dec(t.name), start: t.startDate || null, end: t.endDate || t.startDate || null, who: who(t),
    overdue: !!(t.endDate || t.startDate) && (t.endDate || t.startDate) < today,
  })).sort((a, b) => ((a.start || a.end || '9999') < (b.start || b.end || '9999') ? -1 : 1));

  // open tasks in ACTIVE plus loose top-level tasks (same as the planning meeting)
  const lastIds = new Set(lastTasks.map((t) => t.jt_task_id));
  const toCard = (t: any, src: string) => {
    const due = dueOf(t);
    const type = t.taskType?.name || null;
    const doneLike = type && DONE_LIKE_TYPES.includes(type);
    const overdue = !!due && due < today && !doneLike;
    return {
      id: t.id, name: dec(t.name), due, type, src, who: who(t),
      overdue, days: overdue ? daysBetween(due, today) : 0, doneLike: !!doneLike,
      created: easternDay(t.createdAt), fromLast: lastIds.has(t.id), roadblock: type === ROADBLOCK_TASK_TYPE_NAME,
    };
  };
  const activeTasks = activeGroup ? kids(activeGroup.id).filter((t) => !t.isGroup && isOpen(t) && t.name !== ANCHOR_NAME) : [];
  // "$ - (Contract: ...)" tasks are Terri's billing triggers, undated on purpose: never commitments
  const isBillingTrigger = (t: any) => /^\$/.test(String(t.name || '').trim());
  const looseTasks = tasks.filter((t) => !t.parentTask && !t.isGroup && isOpen(t) && !isPlanTodo(t.name) && !isBillingTrigger(t));
  const openTasks = [...activeTasks.map((t) => toCard(t, 'ACTIVE')), ...looseTasks.map((t) => toCard(t, 'Not in ACTIVE'))]
    .sort((a, b) => ((a.due || '9999') < (b.due || '9999') ? -1 : 1));

  // every other open item on the job (punch list view): open tasks in any group that is not scaffolding
  const punchItems = tasks
    .filter((t) => !t.isGroup && isOpen(t) && t.name !== ANCHOR_NAME && !isPlanTodo(t.name) && !scaffold.has(t.parentTask?.id))
    .filter((t) => !isBillingTrigger(t) && !/projected time-?line/i.test(String(t.name || '')))
    .map((t) => ({ id: t.id, name: dec(t.name), due: dueOf(t), who: who(t), group: dec(byId[t.parentTask?.id]?.name) || null, overdue: !!dueOf(t) && dueOf(t) < today }))
    .sort((a, b) => ((a.due || '9999') < (b.due || '9999') ? -1 : 1));

  const roadblocks = tasks.filter((t) => !t.isGroup && isOpen(t) && t.taskType?.name === ROADBLOCK_TASK_TYPE_NAME).map((t) => ({
    ...toCard(t, 'Roadblock'), daysOpen: daysBetween(easternDay(t.createdAt) || today, today),
  }));

  const lastMeeting = lastTasks.filter((t) => t.job_id === job.id).map((t) => {
    const live = byId[t.jt_task_id];
    const isDone = live ? !isOpen(live) : true;
    const due = live ? dueOf(live) : t.due_date;
    return { id: t.jt_task_id, name: dec(live?.name) || t.name, kind: t.kind, who: t.assignee, due, status: isDone ? 'done' : due && due < today ? 'late' : 'open', missing: !live };
  });

  const taskDays = tasks.filter((t) => !t.isGroup && t.name !== ANCHOR_NAME && !scaffold.has(t.parentTask?.id)).map((t) => easternDay(t.createdAt)).filter(Boolean);
  const candidates = [
    { date: easternDay(extras.lastComment), what: 'comment' },
    { date: extras.lastLog, what: 'daily log' },
    { date: easternDay(extras.lastTime), what: 'time entry' },
    { date: taskDays.sort().pop() || null, what: 'new task' },
  ].filter((c) => c.date);
  const lastActivity = candidates.sort((a, b) => (a.date > b.date ? -1 : 1))[0] || null;

  const unsignedCOs = extras.pendingOrders
    .filter((d) => Number(d.price || 0) !== 0 && !/selection/i.test(String(d.name || '')))
    .map((d) => ({ name: dec(d.name), created: easternDay(d.createdAt) }));

  const kind = job.customStatus === PRODUCTION_STATUS ? 'production' : 'punch';
  return {
    id: job.id, number: job.number, name: dec(job.name), short: shortJobName(job.name, job.number), status: job.customStatus, kind,
    ongoing: kind === 'punch' && isOngoingJob(job.name),
    pm: job.projectManager || null, priceType: job.priceType || null,
    milestones, prodGroupId: prodGroup?.id || null, msProgress: prodGroup ? pct(prodGroup.progress) : null,
    currentMs: current.map((m) => m.id), nextMs: next?.id || null, finish, baselineFinish,
    hasBaseline: milestones.some((m) => m.bEnd),
    fieldGroupId: fieldGroup?.id || null, fieldTasks,
    activeGroupId: activeGroup?.id || null,
    tasks: openTasks, punchItems, roadblocks, lastMeeting,
    decisions: { ...dl, overdue: (dl.undecided || []).filter((x) => x.decideBy && x.decideBy < today) },
    lastLog: extras.lastLog, lastActivity, unsignedCOs,
  };
}

/* ---------------------------------------------------------------- flags */

function flagsFor(j: any, today: string, money: any) {
  const flags: any[] = [];
  const add = (sev, kind, key, text, owner) => flags.push({ id: `${kind}|${j.id}|${key}`, jobId: j.id, job: j.short, sev, kind, text, owner });
  const pm = j.pm ? firstName(j.pm) : 'Evan';

  if (j.kind === 'production') {
    const open = j.milestones.filter((m) => !m.done);
    if (j.finish && j.finish < today && open.length) {
      add('red', 'Past finish date', 'finish', `Every production milestone was due by ${fmtDay(j.finish)}, and ${open.length} ${open.length === 1 ? 'is' : 'are'} still open: ${open.slice(0, 3).map((m) => `"${m.name}" (${m.progress}%)`).join(', ')}${open.length > 3 ? ', ...' : ''}. Finish and tick them, set new dates, or move the job to 6.5 Punch List.`, pm);
    } else {
      const late = open.filter((m) => m.end && m.end < today);
      if (late.length) {
        add('red', 'Milestone late', 'late', `${late.slice(0, 3).map((m) => `"${m.name}" was due to finish ${fmtDay(m.end)} (${daysBetween(m.end, today)} day${daysBetween(m.end, today) === 1 ? '' : 's'} ago) and is ${m.progress}% done`).join('; ')}${late.length > 3 ? '; ...' : ''}. Tick it if it is finished, or give it a new date with the reason.`, pm);
      }
      const behind = open.filter((m) => m.slip != null && m.slip >= PROD_RULES.behindBaselineDays && !(m.end && m.end < today));
      if (behind.length) {
        const m = behind.sort((a, b) => b.slip - a.slip)[0];
        add('red', 'Behind baseline', 'baseline', `"${m.name}" now finishes ${fmtDay(m.end)}, ${m.slip} days after its baseline (${fmtDay(m.bEnd)})${behind.length > 1 ? `, and ${behind.length - 1} more milestone${behind.length > 2 ? 's are' : ' is'} 5+ days behind` : ''}. What moved it, and does the client know?`, pm);
      }
    }
    if (!j.prodGroupId || !j.milestones.length) {
      add('house', 'No production milestones', 'noms', 'No 🤖 PRODUCTION MILESTONES on this job, so the schedule questions cannot be answered from JobTread. Ask Claude to build them with the production schedule skill, or move the job to 6.5 if it is nearly done.', 'Evan');
    } else if (!j.hasBaseline) {
      add('house', 'No baseline', 'nobase', 'The production milestones have no baseline, so slips cannot be measured. Set the baseline on the Production Schedule page.', 'Evan');
    }
    if (!j.fieldGroupId) add('house', 'No FIELD TASKS', 'nofield', 'No 📋 FIELD TASKS group, so the crew plan for this job is not in JobTread. Add it from the production board review.', 'Josh');
    const lastLog = j.lastLog;
    const wd = lastLog ? workingDaysBetween(lastLog, today) : null;
    if (wd == null || wd > PROD_RULES.noDailyLogWorkingDays) {
      add('amber', 'No daily log', 'log', lastLog ? `Last daily log ${fmtDay(lastLog)} (${wd} working days ago). One log for each day on site: work completed, upcoming work, crews, owner notes.` : 'No daily log on this job yet. One log for each day on site: work completed, upcoming work, crews, owner notes.', pm);
    }
    for (const d of j.unsignedCOs.filter((d) => d.created && daysBetween(d.created, today) >= PROD_RULES.unsignedChangeOrderDays)) {
      add('amber', 'Change order unsigned', `co:${d.created}:${d.name}`, `"${d.name}" sent ${fmtDay(d.created)}, still not signed (${daysBetween(d.created, today)} days). No work on it until it is signed.`, 'Nathan');
    }
  } else {
    if (!j.ongoing && !j.punchItems.length && !j.tasks.length) {
      add('amber', 'No punch list', 'nopunch', 'No open punch items in JobTread. Write the punch list as tasks (one per item, owner and date), or move the job to 7. Final Billing if the work is done.', 'Evan');
    }
    // ongoing service jobs are quiet between calls by design, so only real punch jobs get this flag
    if (!j.ongoing && j.lastActivity && daysBetween(j.lastActivity.date, today) > PROD_RULES.quietPunchDays) {
      add('amber', 'Quiet job', 'quiet', `No daily log, time, comment or new task since ${fmtDay(j.lastActivity.date)} (${daysBetween(j.lastActivity.date, today)} days). What is the next closeout step, and who owns it?`, 'Evan');
    }
  }

  moneyFlags(money, add, { punch: j.kind === 'punch' });

  const od = j.decisions?.overdue || [];
  if (od.length) {
    add('amber', 'Decision past due', 'decide', `${od.length} decision${od.length === 1 ? ' is' : 's are'} past the Decide By date and not decided: ${od.slice(0, 3).map((x) => `"${x.name}"${x.tag ? ' (' + x.tag + ')' : ''} by ${fmtDay(x.decideBy)}`).join(', ')}${od.length > 3 ? ', ...' : ''}. Decide now, or say what the delay does to the schedule.`, 'Heather');
  }

  for (const t of j.tasks) {
    if (t.doneLike) {
      add('house', 'Task type says done', `type:${t.id}`, `"${t.name}" has type ${t.type} but is not ticked complete. Tick it or change the type.`, t.who[0] || 'Heather');
    } else if (t.type === 'Pending') {
      const since = t.due || t.created;
      if (since && daysBetween(since, today) > PROD_RULES.agingAskDays) add('amber', 'Aging ask', `ask:${t.id}`, `"${t.name}" has been waiting since ${fmtDay(since)} (${daysBetween(since, today)} days)${t.who.length ? '' : ', and nobody is assigned'}.`, t.who.join(', ') || 'No owner');
    } else if (t.overdue && !t.roadblock) {
      add('amber', 'Overdue task', `late:${t.id}`, `"${t.name}", ${t.who.join(', ') || 'no one assigned'}, due ${fmtDay(t.due)} (${t.days} day${t.days === 1 ? '' : 's'} late).`, t.who.join(', ') || 'No owner');
    }
  }
  if (!j.activeGroupId && j.kind === 'production') {
    add('house', 'No ACTIVE group', 'noactive', 'No 🔵 ACTIVE group, so new commitments have nowhere to go. The Hub creates it on Confirm, or add it now.', 'Heather');
  }
  return flags;
}

/* ---------------------------------------------------------------- the brief */

export async function buildProductionBrief(opts: { lastTasks?: LastMeetingTask[]; today?: string } = {}) {
  const today = opts.today || todayEastern();
  const [jobs, members, money] = await Promise.all([getActiveJobs(500), fetchMembers(), readMoney()]);
  const picked = jobs.filter((j: any) => (j.customStatus === PRODUCTION_STATUS || j.customStatus === PUNCH_STATUS) && !EXCLUDED_JOB_NUMBERS.includes(String(j.number)));
  const memberName = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const errors: string[] = [];
  const built = (await inBatches(picked, 3, async (j: any) => {
    try {
      return await buildJob(j, today, memberName, opts.lastTasks || []);
    } catch (e: any) {
      errors.push(`${j.name}: ${String(e?.message || e).slice(0, 200)}`);
      return null;
    }
  })).filter(Boolean);
  for (const j of built) {
    const m = money.byJob[j.id];
    j.flags = flagsFor(j, today, m);
    j.money = moneyFor(m);
  }
  const sevRank = (j) => (j.flags.some((f) => f.sev === 'red') ? 0 : j.flags.some((f) => f.sev === 'amber') ? 1 : 2);
  built.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'production' ? -1 : 1) : sevRank(a) - sevRank(b) || Number(a.number) - Number(b.number)));
  return { asOf: today, builtAt: new Date().toISOString(), jobs: built, members, errors, moneyAsOf: { costing: money.costingAt, invoicing: money.invoicingAt, costingStale: money.costingStale, invoicingStale: money.invoicingStale } };
}

/** One job with flags, from a job row as getActiveJobs returns it (for testing and single-job checks). */
export async function buildOneJob(job: any, opts: { today?: string; memberName?: Record<string, string>; money?: any } = {}) {
  const today = opts.today || todayEastern();
  const j: any = await buildJob(job, today, opts.memberName || {}, []);
  j.flags = flagsFor(j, today, opts.money);
  j.money = moneyFor(opts.money);
  return j;
}

/** Remove the dollar detail for anyone who is not an owner. */
export function stripMoney(brief: any) {
  if (!brief) return brief;
  const a = brief.moneyAsOf || {};
  return { ...brief, moneyAsOf: { costingStale: !!a.costingStale, invoicingStale: !!a.invoicingStale }, jobs: (brief.jobs || []).map((j) => ({ ...j, money: null })) };
}

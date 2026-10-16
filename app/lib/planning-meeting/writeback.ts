// @ts-nocheck
/**
 * Planning Meeting: write the confirmed meeting to JobTread.
 *
 * Runs when someone clicks "Confirm and write to JobTread" on the review screen.
 * Every write is recorded in planning_meetings.write_log under a stable key,
 * and a key that already succeeded is skipped, so pressing Confirm again after
 * a partial failure finishes the job without writing anything twice.
 *
 * Per job, in order:
 *   1. 🔵 ACTIVE group (created if the job has none and something goes in it)
 *   2. New commitments and roadblocks -> one task each in 🔵 ACTIVE
 *      (assignee, due date, description; roadblocks get task type Roadblock)
 *   3. Done / New date / Drop on existing tasks (Drop = ticked complete with
 *      "Dropped at the <date> meeting: reason" added to its description; never deleted)
 *   4. Gate checklist ticks (read live, change only the named items)
 *   5. Planning marker dates
 *   5b. Job Plan text edited in the meeting, written to the description of the job's
 *       📋 Project Details budget group (only if JobTread's copy has not changed since
 *       the brief read it; otherwise the step fails and says why)
 *   6. One internal daily log for the meeting with the notes, everything above,
 *      and any corrections to Claude's read made during this meeting
 */
import { pave, createDailyLog } from '@/app/lib/jobtread';
import { PLAN_MAX, findPlanGroup, readPlanText, writePlanText } from './job-plan';
import { ROADBLOCK_TASK_TYPE_ID, ACTIVE_GROUP_NAME, isActiveGroup, fmtDay, meetingNotesText, holdLogLine } from './constants';

type Log = { key: string; ok: boolean; id?: string; error?: string; at: string };

const norm = (t: string) => String(t || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
/** Short stable hash so a re-edited Job Plan gets a new write key. */
function hashText(t: string) {
  let h = 0;
  for (const ch of norm(t)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
/** Lines that are new or changed in the edited Job Plan (for the daily log). */
function changedLines(before: string, after: string) {
  const old = new Set(norm(before).split('\n').map((l) => l.trim()));
  return norm(after).split('\n').map((l) => l.trim()).filter((l) => l && !old.has(l) && !/^\d+\.$/.test(l) && !/:$/.test(l));
}

const MAX_DESC = 4000;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 3) + '...' : s);

async function findActiveGroup(jobId: string): Promise<string | null> {
  const data: any = await pave({
    job: { $: { id: jobId }, tasks: { $: { size: 50, where: { and: [['isGroup', '=', true], ['name', 'like', '%ACTIVE%']] } }, nodes: { id: {}, name: {}, isToDo: {} } } },
  });
  const g = (data?.job?.tasks?.nodes || []).find((t) => !t.isToDo && isActiveGroup(t.name));
  return g?.id || null;
}

async function createActiveGroup(jobId: string): Promise<string> {
  const data: any = await pave({
    createTask: { $: { targetType: 'job', targetId: jobId, name: ACTIVE_GROUP_NAME, isGroup: true, isToDo: false, notify: false }, createdTask: { id: {} } },
  });
  const id = data?.createTask?.createdTask?.id;
  if (!id) throw new Error('Could not create the 🔵 ACTIVE group');
  return id;
}

async function readTask(id: string) {
  const data: any = await pave({ task: { $: { id }, id: {}, name: {}, description: {}, progress: {}, startDate: {}, endDate: {}, subtasks: { name: {}, isComplete: {} } } });
  return data?.task || null;
}

export interface WriteResult { log: Log[]; written: number; failed: number; createdTasks: any[] }

/**
 * @param meeting   planning_meetings row (state, brief, write_log, meeting_date)
 * @param holds     planning_job_holds rows changed during this meeting
 * @param context   planning_job_context rows added during this meeting (still active)
 */
export async function writeMeetingToJobTread(
  meeting: any,
  holds: any[] = [],
  context: any[] = [],
  opts: { label?: string; notesText?: (js: any, job?: any) => string } = {},
): Promise<WriteResult> {
  // label: 'planning meeting' (default) or 'production meeting'; notesText: how one job's answers become text
  const label = opts.label || 'planning meeting';
  const Label = label.charAt(0).toUpperCase() + label.slice(1);
  const notesOf = opts.notesText || meetingNotesText;
  const state = meeting.state || {};
  const brief = meeting.brief || { jobs: [] };
  const dateLabel = fmtDay(meeting.meeting_date, true);
  const prior: Log[] = Array.isArray(meeting.write_log) ? meeting.write_log : [];
  const doneKeys = new Map(prior.filter((l) => l.ok).map((l) => [l.key, l]));
  const log: Log[] = [...prior];
  const createdTasks: any[] = [];
  let written = 0, failed = 0;

  const step = async (key: string, fn: () => Promise<string | void>) => {
    if (doneKeys.has(key)) return doneKeys.get(key).id;
    try {
      const id = (await fn()) || undefined;
      log.push({ key, ok: true, id, at: new Date().toISOString() });
      doneKeys.set(key, { key, ok: true, id, at: '' });
      written++;
      return id;
    } catch (e: any) {
      log.push({ key, ok: false, error: String(e?.message || e).slice(0, 300), at: new Date().toISOString() });
      failed++;
      return undefined;
    }
  };

  // Flags turned into roadblocks become items on their job.
  const itemsByJob: Record<string, any[]> = {};
  for (const [jid, js] of Object.entries(state.jobs || {})) itemsByJob[jid] = [...((js as any).items || [])];
  for (const [fid, r] of Object.entries(state.rb || {})) {
    const rr: any = r;
    if (rr?.act !== 'rb' || !rr.what?.trim()) continue;
    const jid = fid.split('|')[1];
    (itemsByJob[jid] = itemsByJob[jid] || []).push({ uid: 'flag:' + fid, kind: 'roadblock', what: rr.what.trim(), whoId: rr.whoId, whoName: rr.whoName, due: rr.due, details: rr.details, source: 'flag' });
  }

  for (const job of brief.jobs || []) {
    const jid = job.id;
    const js: any = (state.jobs || {})[jid] || {};
    const items = (itemsByJob[jid] || []).filter((i) => i.what?.trim());
    const tri = Object.entries(state.triage || {}).filter(([, t]: any) => t?.jobId === jid && t?.act);
    const needsGroup = items.length > 0 || tri.some(([, t]: any) => t.act === 'move');
    let groupId = job.activeGroupId || null;
    if (needsGroup && !groupId) {
      groupId = await step(`group:${jid}`, async () => (await findActiveGroup(jid)) || (await createActiveGroup(jid)));
    }
    const ticks = Object.entries(js.ticks || {});
    const markers = Object.entries(js.markers || {}).filter(([, d]) => !!d);
    const hold = holds.find((h) => h.job_id === jid);
    const notes = notesOf(js, job);
    const lines: string[] = [];

    // 1 + 2. tasks
    if (items.length) {
      lines.push('New tasks');
      for (const it of items) {
        const isRb = it.kind === 'roadblock';
        const desc = clip([it.details?.trim(), `From the ${label}, ${dateLabel}.`].filter(Boolean).join('\n\n'), MAX_DESC);
        const id = groupId ? await step(`item:${it.uid}`, async () => {
          const data: any = await pave({
            createTask: {
              $: {
                targetType: 'job', targetId: jid, parentTaskId: groupId,
                name: clip(it.what.trim(), 250), description: desc, isToDo: false, isGroup: false, progress: 0, notify: true,
                ...(it.due ? { startDate: it.due, endDate: it.due } : {}),
                ...(it.whoId ? { assignedMembershipIds: [it.whoId] } : {}),
                ...(isRb ? { taskTypeId: ROADBLOCK_TASK_TYPE_ID } : {}),
              },
              createdTask: { id: {} },
            },
          });
          const nid = data?.createTask?.createdTask?.id;
          if (!nid) throw new Error('createTask returned no id');
          return nid;
        }) : undefined;
        if (id) createdTasks.push({ job_id: jid, jt_task_id: id, kind: isRb ? 'roadblock' : 'commitment', name: it.what.trim(), assignee: it.whoName || null, due_date: it.due || null, source: it.source || 'meeting' });
        lines.push(`- ${isRb ? 'Roadblock' : 'Commitment'}: ${it.what.trim()} (${it.whoName || 'no owner'}${it.due ? ', due ' + fmtDay(it.due) : ''})${id ? '' : ' [NOT WRITTEN]'}`);
      }
    }

    // 3. triage
    if (tri.length) {
      lines.push('', 'Task updates');
      for (const [taskId, t] of tri as any) {
        // "Other" carries the typed reason when there is one
        const reason = t.why === 'Other' && String(t.whyText || '').trim() ? String(t.whyText).trim() : t.why;
        const why = reason ? ` Reason: ${reason}.` : '';
        if (t.act === 'done') {
          await step(`tri:${taskId}`, async () => { await pave({ updateTask: { $: { id: taskId, progress: 1, notify: false } } }); });
          lines.push(`- Done: ${t.name}`);
        } else if (t.act === 'date' && t.date) {
          await step(`tri:${taskId}:${t.date}`, async () => { await pave({ updateTask: { $: { id: taskId, startDate: t.date, endDate: t.date, notify: false, updateDependentTasks: false } } }); });
          lines.push(`- New date ${fmtDay(t.date)}: ${t.name}.${why}`);
        } else if (t.act === 'move') {
          if (groupId) await step(`tri:${taskId}:move`, async () => { await pave({ updateTask: { $: { id: taskId, parentTaskId: groupId, notify: false, updateDependentTasks: false } } }); });
          lines.push(`- Moved into 🔵 ACTIVE: ${t.name}`);
        } else if (t.act === 'drop') {
          await step(`tri:${taskId}:drop`, async () => {
            const cur = await readTask(taskId);
            const note = `Dropped at the ${dateLabel} ${label}${reason ? ': ' + reason : ''}.`;
            const description = clip([cur?.description?.trim(), note].filter(Boolean).join('\n\n'), MAX_DESC);
            await pave({ updateTask: { $: { id: taskId, progress: 1, description, notify: false } } });
          });
          lines.push(`- Dropped: ${t.name}.${why}`);
        }
      }
    }

    // 4. gate ticks: group by gate
    if (ticks.length) {
      const byGate: Record<string, [number, boolean][]> = {};
      for (const [k, v] of ticks) {
        const [g, i] = k.split('_').map(Number);
        const gate = job.gates?.[g];
        if (!gate) continue;
        if (!!v === !!gate.items[i]?.[1]) continue; // unchanged
        (byGate[gate.id] = byGate[gate.id] || []).push([i, !!v]);
      }
      const gateLines: string[] = [];
      for (const [gateId, changes] of Object.entries(byGate)) {
        const gate = job.gates.find((x) => x.id === gateId);
        await step(`tick:${gateId}:${changes.map(([i, v]) => i + (v ? '+' : '-')).join(',')}`, async () => {
          const cur = await readTask(gateId);
          const subs = (cur?.subtasks || []).map((s) => ({ name: s.name, isComplete: !!s.isComplete }));
          for (const [i, v] of changes) {
            const name = gate.items[i][0];
            const hit = subs.find((s) => s.name === name) || subs[i];
            if (hit) hit.isComplete = v;
          }
          await pave({ updateTask: { $: { id: gateId, subtasks: subs, notify: false } } });
        });
        for (const [i, v] of changes) gateLines.push(`- ${v ? 'Ticked' : 'Unticked'}: ${gate.name}, ${gate.items[i][0]}`);
      }
      if (gateLines.length) lines.push('', 'Gate checklist', ...gateLines);
    }

    // 5. markers
    if (markers.length) {
      lines.push('', 'Gate dates set');
      for (const [mid, d] of markers as any) {
        const m = (job.markers || []).find((x) => x.id === mid);
        if (m && m.date === d) continue;
        await step(`marker:${mid}:${d}`, async () => { await pave({ updateTask: { $: { id: mid, startDate: d, endDate: d, notify: false, updateDependentTasks: false } } }); });
        lines.push(`- ${(m?.name || 'Marker').split(' (')[0].replace(/due:\s*/, 'due ' + fmtDay(d) + ': ')}`);
      }
      if (lines[lines.length - 1] === 'Gate dates set') lines.pop(), lines.pop();
    }

    // 5b. Job Plan edited in the meeting
    let holdLogForRetry = false;
    // The plan is the description of the 📋 Project Details budget group. A brief built before
    // 16 Oct 2026 carries planTodoId instead of planGroupId; the group is looked up then.
    if (typeof js.plan === 'string' && (job.planGroupId || job.planTodoId) && norm(js.plan) !== norm(js.planBase ?? job.planText ?? '')) {
      const base = js.planBase ?? job.planText ?? '';
      await step(`plan:${jid}:${hashText(js.plan)}`, async () => {
        if (js.plan.length > PLAN_MAX) throw new Error(`The Job Plan edit is ${js.plan.length.toLocaleString()} characters and JobTread allows ${PLAN_MAX.toLocaleString()}. Edit it shorter on the job card, then Confirm again.`);
        const groupId = job.planGroupId || (await findPlanGroup(jid))?.id;
        if (!groupId) throw new Error('This job has no 📋 Project Details group in its budget, so there is nowhere to save the Job Plan. Add it from the Set up a job tab, then Confirm again.');
        const cur = await readPlanText(groupId);
        // already written (for example by an earlier run that lost its log entry)
        if (norm(cur) === norm(js.plan)) return;
        if (norm(cur) !== norm(base)) throw new Error('The Job Plan was changed in JobTread after the meeting started. Refresh from JobTread, start the Job Plan edit again from the new version, then Confirm again.');
        await writePlanText(groupId, js.plan);
      });
      const changed = changedLines(base, js.plan);
      // If the Job Plan could not be written, hold this job's daily log until the retry,
      // so the log never says the plan was updated when it was not.
      if (!doneKeys.has(`plan:${jid}:${hashText(js.plan)}`)) holdLogForRetry = true;
      lines.push('', 'Job Plan updated');
      for (const l of changed.slice(0, 10)) lines.push(`- ${l}`);
      if (changed.length > 10) lines.push(`- and ${changed.length - 10} more lines`);
    }

    const holdLine = holdLogLine(hold, meeting.created_at);
    if (holdLine) lines.push('', holdLine);

    const fixes = context.filter((r) => r.job_id === jid);
    if (fixes.length) {
      lines.push('', "Corrections to Claude's read");
      for (const r of fixes) {
        if (r.kind === 'dismiss') lines.push(`- Not right: "${r.target}"${r.note ? '. ' + r.note : ''}${r.created_by_name ? ' (' + r.created_by_name + ')' : ''}`);
        else lines.push(`- Context: ${r.note}${r.created_by_name ? ' (' + r.created_by_name + ')' : ''}`);
      }
    }

    // 6. daily log
    if ((notes || lines.length) && !holdLogForRetry) {
      const body = [`${Label}, ${dateLabel}`, '', ...(notes ? [notes, ''] : []), ...(lines[0] === '' ? lines.slice(1) : lines)].join('\n').trim();
      await step(`log:${jid}`, async () => {
        const created = await createDailyLog({ jobId: jid, date: meeting.meeting_date, notes: clip(body, 9500), notify: false });
        return created.id;
      });
    }
  }

  return { log, written, failed, createdTasks };
}

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
 *   6. One internal daily log for the meeting with the notes and everything above
 */
import { pave, createDailyLog } from '@/app/lib/jobtread';
import { ROADBLOCK_TASK_TYPE_ID, ACTIVE_GROUP_NAME, isActiveGroup, fmtDay, meetingNotesText, holdLogLine } from './constants';

type Log = { key: string; ok: boolean; id?: string; error?: string; at: string };

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
 */
export async function writeMeetingToJobTread(meeting: any, holds: any[] = []): Promise<WriteResult> {
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
    const notes = meetingNotesText(js);
    const lines: string[] = [];

    // 1 + 2. tasks
    if (items.length) {
      lines.push('New tasks');
      for (const it of items) {
        const isRb = it.kind === 'roadblock';
        const desc = clip([it.details?.trim(), `From the planning meeting, ${dateLabel}.`].filter(Boolean).join('\n\n'), MAX_DESC);
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
        const why = t.why ? ` Reason: ${t.why}.` : '';
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
            const note = `Dropped at the ${dateLabel} planning meeting${t.why ? ': ' + t.why : ''}.`;
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

    const holdLine = holdLogLine(hold, meeting.created_at);
    if (holdLine) lines.push('', holdLine);

    // 6. daily log
    if (notes || lines.length) {
      const body = [`Planning meeting, ${dateLabel}`, '', ...(notes ? [notes, ''] : []), ...lines].join('\n').trim();
      await step(`log:${jid}`, async () => {
        const created = await createDailyLog({ jobId: jid, date: meeting.meeting_date, notes: clip(body, 9500), notify: false });
        return created.id;
      });
    }
  }

  return { log, written, failed, createdTasks };
}

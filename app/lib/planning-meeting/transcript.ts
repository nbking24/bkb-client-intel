// @ts-nocheck
/**
 * Planning Meeting: the transcript step.
 *
 * After the meeting someone pastes the recording transcript. Claude splits it
 * by job and compares it with what was typed in the meeting, then suggests:
 *   - commitments or roadblocks that were said but never became a task
 *   - details missing from a job's notes
 *   - an owner or date that does not match what was said
 * Nothing is written until each suggestion is approved; applyTranscript() then
 * creates the approved tasks in 🔵 ACTIVE and appends a "From the recording"
 * section to that job's meeting daily log.
 */
import Anthropic from '@anthropic-ai/sdk';
import { pave, createDailyLog, updateDailyLog } from '@/app/lib/jobtread';
import { ROADBLOCK_TASK_TYPE_ID, ACTIVE_GROUP_NAME, isActiveGroup, fmtDay, meetingNotesText } from './constants';

const MODEL = 'claude-sonnet-4-6';

function capturedFor(meeting: any) {
  const state = meeting.state || {};
  return (meeting.brief?.jobs || []).map((j) => {
    const js = state.jobs?.[j.id] || {};
    const flagRbs = Object.entries(state.rb || {}).filter(([fid, r]: any) => fid.split('|')[1] === j.id && r?.act === 'rb').map(([, r]: any) => ({ kind: 'roadblock', what: r.what, who: r.whoName, due: r.due }));
    return {
      jobId: j.id,
      job: j.short,
      fullName: j.name,
      notes: meetingNotesText(js),
      tasks: [...(js.items || []).map((i) => ({ kind: i.kind, what: i.what, who: i.whoName, due: i.due })), ...flagRbs],
    };
  });
}

export async function analyzeTranscript(meeting: any, transcript: string, people: string[]) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const captured = capturedFor(meeting);
  const system = `You review the transcript of Brett King Builder's weekly planning meeting, where the team goes job by job through renovation jobs that are in design.
Compare the transcript with what was typed during the meeting and return ONLY suggestions for things that are missing or wrong. Do not repeat anything already captured.
Rules:
- Split by job. Use only jobId values from the job list. Talk that is not about a listed job goes in "general".
- A task is something a named person said they or someone would do. kind "commitment" for an action, "roadblock" for something stopping the job reaching its next gate.
- "who" must be one of these people or null: ${people.join(', ')}.
- "due" is YYYY-MM-DD only if a day was said or is clear from context (the meeting date is ${meeting.meeting_date}); otherwise null.
- "quote" is a short phrase from the transcript (under 20 words) that supports the suggestion.
- Notes are short plain sentences of decisions or facts not already in the typed notes. Never invent anything.
- No em dashes or en dashes anywhere. Use commas or periods.
Return JSON exactly in this shape and nothing else:
{"jobs":[{"jobId":"...","notes":["..."],"tasks":[{"kind":"commitment","what":"...","who":"...","due":null,"details":"...","quote":"..."}],"mismatches":[{"text":"...","quote":"..."}]}],"general":["..."]}`;
  const user = `Meeting date: ${meeting.meeting_date}\n\nJobs and what was typed during the meeting:\n${JSON.stringify(captured, null, 1)}\n\nTranscript:\n${transcript.slice(0, 180000)}`;
  const res = await anthropic.messages.create({ model: MODEL, max_tokens: 8000, system, messages: [{ role: 'user', content: user }] });
  const text = (res.content || []).map((c: any) => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude did not return suggestions');
  const parsed = JSON.parse(m[0]);
  const valid = new Set(captured.map((c) => c.jobId));
  const clean = (s: any) => String(s || '').replace(/[–—]/g, ',');
  let n = 0;
  return {
    jobs: (parsed.jobs || []).filter((j) => valid.has(j.jobId)).map((j) => ({
      jobId: j.jobId,
      notes: (j.notes || []).map((t) => ({ id: `n${n++}`, text: clean(t), approved: false })),
      tasks: (j.tasks || []).map((t) => ({ id: `t${n++}`, kind: t.kind === 'roadblock' ? 'roadblock' : 'commitment', what: clean(t.what), who: people.includes(t.who) ? t.who : null, due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : null, details: clean(t.details), quote: clean(t.quote), approved: false })),
      mismatches: (j.mismatches || []).map((x) => ({ id: `m${n++}`, text: clean(x.text), quote: clean(x.quote) })),
    })).filter((j) => j.notes.length || j.tasks.length || j.mismatches.length),
    general: (parsed.general || []).map(clean),
    analyzedAt: new Date().toISOString(),
  };
}

async function activeGroupFor(jobId: string, known: string | null) {
  if (known) return known;
  const data: any = await pave({ job: { $: { id: jobId }, tasks: { $: { size: 50, where: { and: [['isGroup', '=', true], ['name', 'like', '%ACTIVE%']] } }, nodes: { id: {}, name: {}, isToDo: {} } } } });
  const g = (data?.job?.tasks?.nodes || []).find((t) => !t.isToDo && isActiveGroup(t.name));
  if (g) return g.id;
  const c: any = await pave({ createTask: { $: { targetType: 'job', targetId: jobId, name: ACTIVE_GROUP_NAME, isGroup: true, isToDo: false, notify: false }, createdTask: { id: {} } } });
  return c?.createTask?.createdTask?.id;
}

/**
 * Write the approved suggestions. `result` is transcript_result with approved flags
 * and edited fields; `members` maps names to membership ids.
 */
export async function applyTranscript(meeting: any, result: any, members: { id: string; name: string }[]) {
  const dateLabel = fmtDay(meeting.meeting_date, true);
  const prior = Array.isArray(meeting.write_log) ? meeting.write_log : [];
  const doneKeys = new Map(prior.filter((l) => l.ok).map((l) => [l.key, l]));
  const log = [...prior];
  const createdTasks: any[] = [];
  let written = 0, failed = 0;
  const step = async (key: string, fn: () => Promise<string | void>) => {
    if (doneKeys.has(key)) return doneKeys.get(key).id;
    try {
      const id = (await fn()) || undefined;
      log.push({ key, ok: true, id, at: new Date().toISOString() }); doneKeys.set(key, { id }); written++; return id;
    } catch (e: any) {
      log.push({ key, ok: false, error: String(e?.message || e).slice(0, 300), at: new Date().toISOString() }); failed++; return undefined;
    }
  };
  const memberId = (name: string) => members.find((m) => m.name === name || m.name.split(' ')[0] === name)?.id;

  for (const j of result.jobs || []) {
    const job = (meeting.brief?.jobs || []).find((x) => x.id === j.jobId);
    if (!job) continue;
    const tasks = (j.tasks || []).filter((t) => t.approved && t.what?.trim());
    const notes = (j.notes || []).filter((t) => t.approved && t.text?.trim());
    if (!tasks.length && !notes.length) continue;
    const lines: string[] = [];
    if (tasks.length) {
      const groupId = await step(`tx:group:${j.jobId}`, () => activeGroupFor(j.jobId, job.activeGroupId));
      for (const t of tasks) {
        const whoId = memberId(t.who);
        const id = groupId ? await step(`tx:item:${t.id}`, async () => {
          const data: any = await pave({
            createTask: {
              $: {
                targetType: 'job', targetId: j.jobId, parentTaskId: groupId, name: t.what.trim().slice(0, 250),
                description: [t.details?.trim(), `From the planning meeting recording, ${dateLabel}.`].filter(Boolean).join('\n\n').slice(0, 4000),
                isToDo: false, progress: 0, notify: true,
                ...(t.due ? { startDate: t.due, endDate: t.due } : {}),
                ...(whoId ? { assignedMembershipIds: [whoId] } : {}),
                ...(t.kind === 'roadblock' ? { taskTypeId: ROADBLOCK_TASK_TYPE_ID } : {}),
              },
              createdTask: { id: {} },
            },
          });
          return data?.createTask?.createdTask?.id;
        }) : undefined;
        if (id) createdTasks.push({ job_id: j.jobId, jt_task_id: id, kind: t.kind, name: t.what.trim(), assignee: t.who || null, due_date: t.due || null, source: 'transcript' });
        lines.push(`- ${t.kind === 'roadblock' ? 'Roadblock' : 'Commitment'}: ${t.what.trim()} (${t.who || 'no owner'}${t.due ? ', due ' + fmtDay(t.due) : ''})`);
      }
    }
    const section = ['', 'From the recording', ...notes.map((n) => '- ' + n.text.trim()), ...(lines.length ? ['New tasks from the recording', ...lines] : [])].join('\n');
    const logEntry = prior.find((l) => l.ok && l.key === `log:${j.jobId}`) || log.find((l) => l.ok && l.key === `log:${j.jobId}`);
    await step(`tx:log:${j.jobId}`, async () => {
      if (logEntry?.id) {
        const cur: any = await pave({ dailyLog: { $: { id: logEntry.id }, notes: {} } });
        const notesNow = cur?.dailyLog?.notes || '';
        await updateDailyLog({ id: logEntry.id, notes: (notesNow + '\n' + section).slice(0, 9500) });
        return logEntry.id;
      }
      const created = await createDailyLog({ jobId: j.jobId, date: meeting.meeting_date, notes: (`Planning meeting, ${dateLabel}` + '\n' + section).slice(0, 9500), notify: false });
      return created.id;
    });
  }
  return { log, written, failed, createdTasks };
}

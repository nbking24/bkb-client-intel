// @ts-nocheck
/**
 * Meeting sync: the JobTread side. Finds the client's job, reads the client's
 * phone numbers, and keeps one 📅 task per meeting in the job's 🔵 ACTIVE group.
 */
import { pave } from '@/app/lib/jobtread';
import { ACTIVE_GROUP_NAME, isActiveGroup } from '@/app/lib/planning-meeting/constants';

const ORG = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';
const STOP = new Set(['the', 'and', 'with', 'for', 'call', 'meeting', 'review', 'design', 'kitchen', 'bath', 'bathroom', 'addition', 'renovation', 'project', 'home', 'house', 'garage', 'phone', 'virtual', 'site', 'visit', 'selections', 'budget', 'ongoing', 'mr', 'mrs', 'at', 'on', 'to', 'of']);

const cfv = (nodes: any[], name: string) => (nodes || []).find((n) => n?.customField?.name === name)?.value || '';

/** Internal team: lowercased email -> {id, name} (JT membership). */
export async function teamMemberships(extra: Record<string, any> = {}): Promise<Record<string, { id: string; name: string }>> {
  const out: Record<string, { id: string; name: string }> = {};
  let page: string | null = null;
  for (let i = 0; i < 10; i++) {
    const args: any = { size: 100 };
    if (page) args.page = page;
    const d: any = await pave({ organization: { $: { id: ORG() }, memberships: { $: args, nextPage: {}, nodes: { id: {}, user: { name: {}, emailAddress: {} }, role: { type: {} } } } } });
    const conn = d?.organization?.memberships;
    for (const m of conn?.nodes || []) {
      const e = String(m?.user?.emailAddress || '').toLowerCase();
      if (m?.role?.type === 'internal' && e) out[e] = { id: m.id, name: m.user?.name || '' };
    }
    page = conn?.nextPage || null;
    if (!page) break;
  }
  for (const [e, v] of Object.entries(extra || {})) out[e.toLowerCase()] = typeof v === 'string' ? { id: v, name: '' } : (v as any);
  return out;
}

async function jobsLike(word: string) {
  const like = `%${word.replace(/[%_]/g, '')}%`;
  const d: any = await pave({
    organization: { $: { id: ORG() }, jobs: {
      $: { size: 25, where: { and: [['closedOn', '=', null], { or: [['name', 'like', like], [['location', 'account', 'name'], 'like', like]] }] } },
      nodes: { id: {}, name: {}, number: {}, location: { account: { id: {}, name: {} } } },
    } },
  });
  return d?.organization?.jobs?.nodes || [];
}

/** Client contacts on the job's customer account: [{name, email, phone}]. */
export async function jobContacts(jobId: string) {
  const d: any = await pave({
    job: { $: { id: jobId }, location: { account: { contacts: { $: { size: 25 }, nodes: { name: {}, customFieldValues: { nodes: { value: {}, customField: { name: {} } } } } } } } },
  });
  return (d?.job?.location?.account?.contacts?.nodes || []).map((c: any) => ({
    name: c.name || '',
    email: String(cfv(c.customFieldValues?.nodes, 'Email') || '').toLowerCase(),
    phone: cfv(c.customFieldValues?.nodes, 'Phone') || cfv(c.customFieldValues?.nodes, 'Formatted Phone') || '',
  }));
}

/**
 * Find the open job a meeting belongs to. Candidates come from the words of
 * the title after the trigger word. A guest email that matches a contact on a
 * candidate's account wins. Otherwise one candidate wins only if it is the
 * only one (an "Ongoing" twin loses unless the title says ongoing).
 */
export async function findJob(subject: string, guestEmails: string[]) {
  const words = String(subject || '').split(/[^A-Za-z'\-]+/).map((w) => w.replace(/'s$/i, '')).filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase()));
  const seen = new Map<string, any>();
  // A job number in the title ("Dayton 259") is the surest match.
  for (const n of (String(subject || '').match(/\b\d{3,4}\b/g) || []).slice(0, 2)) {
    const d: any = await pave({ organization: { $: { id: ORG() }, jobs: { $: { size: 2, where: { and: [['closedOn', '=', null], ['number', '=', n]] } }, nodes: { id: {}, name: {}, number: {}, location: { account: { id: {}, name: {} } } } } } });
    const hit = d?.organization?.jobs?.nodes?.[0];
    if (hit) return { job: hit };
  }
  for (const w of words.slice(0, 4)) for (const j of await jobsLike(w)) seen.set(j.id, j);
  let cands = [...seen.values()];
  if (!cands.length) return { job: null, reason: 'No open JobTread job matches the name in the title.' };

  if (guestEmails.length && cands.length > 1) {
    const hits = [];
    for (const j of cands.slice(0, 8)) {
      const cs = await jobContacts(j.id).catch(() => []);
      if (cs.some((c) => c.email && guestEmails.includes(c.email))) hits.push(j);
    }
    if (hits.length === 1) return { job: hits[0] };
    if (hits.length > 1) cands = hits;
  }
  if (cands.length > 1 && !/ongoing/i.test(subject)) {
    const main = cands.filter((j) => !/ongoing/i.test(j.name));
    if (main.length === 1) return { job: main[0] };
  }
  if (cands.length === 1) return { job: cands[0] };
  return { job: null, reason: `More than one open job matches: ${cands.slice(0, 4).map((j) => `${j.name} (${j.number})`).join(', ')}. Put the job number in the title.` };
}

async function activeGroupId(jobId: string): Promise<string> {
  const d: any = await pave({ job: { $: { id: jobId }, tasks: { $: { size: 50, where: ['isGroup', '=', true] }, nodes: { id: {}, name: {}, isToDo: {} } } } });
  const g = (d?.job?.tasks?.nodes || []).find((t: any) => !t.isToDo && isActiveGroup(t.name));
  if (g) return g.id;
  const c: any = await pave({ createTask: { $: { targetType: 'job', targetId: jobId, name: ACTIVE_GROUP_NAME, isGroup: true, isToDo: false, notify: false }, createdTask: { id: {} } } });
  const id = c?.createTask?.createdTask?.id;
  if (!id) throw new Error('Could not create the ACTIVE group');
  return id;
}

export interface TaskShape { name: string; description: string; date: string; startTime: string; endTime: string; membershipIds: string[] }

export async function createMeetingTask(jobId: string, t: TaskShape): Promise<string> {
  const parentTaskId = await activeGroupId(jobId);
  const d: any = await pave({
    createTask: {
      $: {
        targetType: 'job', targetId: jobId, parentTaskId, name: t.name.slice(0, 250), description: t.description.slice(0, 4000),
        isToDo: false, notify: false, progress: 0,
        startDate: t.date, endDate: t.date, startTime: t.startTime, endTime: t.endTime,
        ...(t.membershipIds.length ? { assignedMembershipIds: t.membershipIds.slice(0, 20) } : {}),
      },
      createdTask: { id: {} },
    },
  });
  const id = d?.createTask?.createdTask?.id;
  if (!id) throw new Error('JobTread task was not created');
  return id;
}

export async function updateMeetingTask(taskId: string, t: TaskShape) {
  await pave({
    updateTask: {
      $: {
        id: taskId, name: t.name.slice(0, 250), description: t.description.slice(0, 4000),
        startDate: t.date, endDate: t.date, startTime: t.startTime, endTime: t.endTime,
        assignedMembershipIds: t.membershipIds.slice(0, 20),
      },
    },
  });
}

export async function completeTask(taskId: string) {
  await pave({ updateTask: { $: { id: taskId, progress: 1 } } });
}

export async function deleteTask(taskId: string) {
  await pave({ deleteTask: { $: { id: taskId } } });
}

/** Has someone already deleted or finished the task by hand? */
export async function taskState(taskId: string): Promise<{ exists: boolean; done: boolean }> {
  try {
    const d: any = await pave({ task: { $: { id: taskId }, id: {}, progress: {} } });
    if (!d?.task?.id) return { exists: false, done: false };
    return { exists: true, done: (d.task.progress ?? 0) >= 1 };
  } catch {
    return { exists: false, done: false };
  }
}

/** Open 📅 tasks on a job for one day, to adopt a hand-entered task instead of duplicating it. */
export async function openMeetingTasksOn(jobId: string, date: string) {
  const d: any = await pave({ job: { $: { id: jobId }, tasks: { $: { size: 100, where: ['startDate', '=', date] }, nodes: { id: {}, name: {}, progress: {} } } } });
  return (d?.job?.tasks?.nodes || []).filter((t: any) => String(t.name || '').startsWith('📅') && (t.progress ?? 0) < 1);
}

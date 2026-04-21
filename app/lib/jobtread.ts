// ============================================================
// JobTread PAVE API Service Layer
// Expanded for BKB Operations Platform
//
// PAVE API patterns (verified against live API):
// - Org-level collections are PLURAL: jobs, tasks, documents, memberships, costCodes
// - Single entity by ID is SINGULAR: job, task, document
// - Sub-collections on entities are PLURAL: job.tasks, job.documents, job.files
// - Org-level where: flat array ["field", "op", "value"]
// - Org-level sortBy: not supported on all collections (omit if errors)
// - Task assignees: "assignedMemberships" (not "assignees")
// - Job customer: accessed via location.account (not direct "account")
// - Can't filter tasks by assignedMemberships at org level â fetch all, filter client-side
// - Custom field values: job.customFieldValues { customField { name } value }
// ============================================================

import { getStatusCategory, STANDARD_PHASES, type StatusCategoryKey } from './constants';
import { BKB_STANDARD_TEMPLATE, recommendPhaseForTask, type PhaseTemplate } from './schedule-templates';

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';
const JT_ORG = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';

// -- Core PAVE query helper --
export async function pave(query: Record<string, unknown>) {
  const body = {
    query: {
      $: { grantKey: JT_KEY() },
      ...query,
    },
  };

  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`JT PAVE error ${res.status}: ${text.slice(0, 300)}`);
  }

  const text = await res.text();
  if (!text) return {};
  try {
    const json = JSON.parse(text);
    if (json.errors?.length) {
      throw new Error('JT PAVE: ' + json.errors.map((e: any) => e.message || JSON.stringify(e)).join('; '));
    }
    return json;
  } catch (err: any) {
    if (err?.message?.startsWith('JT PAVE:')) throw err;
    throw new Error(`JT PAVE error: invalid JSON â ${text.slice(0, 200)}`);
  }
}

// -- Org-scoped query helper --
async function orgQuery(collection: string, params: Record<string, unknown>) {
  const data = await pave({
    organization: {
      $: { id: JT_ORG() },
      [collection]: params,
    },
  });
  return (data as any)?.organization?.[collection] || {};
}

// ============================================================
// JOBS
// ============================================================

export interface JTJob {
  id: string;
  name: string;
  number: string;
  status: string;
  createdAt: string;
  closedOn: string | null;
  clientName?: string;
  locationName?: string;
  customStatus?: string | null;       // JT custom "Status" field value
  statusCategory?: StatusCategoryKey | null;  // Derived category for dashboard grouping
  priceType?: string | null;          // Native JT field: "fixed", "costPlus", etc.
}

export async function getActiveJobs(limit = 200): Promise<JTJob[]> {
  // Paginate with direct pave() calls (orgQuery doesn't expose nextPage).
  // PAVE org-level queries cap at 50 per page, so we fetch multiple pages.
  const PAGE_SIZE = 50;
  let allNodes: any[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 5 && allNodes.length < limit; page++) {
    const pageParams: Record<string, unknown> = {
      size: PAGE_SIZE,
      where: ['closedOn', '=', null],
    };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      organization: {
        $: { id: JT_ORG() },
        jobs: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            number: {},
            status: {},
            createdAt: {},
            closedOn: {},
            priceType: {},
            location: {
              id: {},
              name: {},
              account: { id: {}, name: {} },
            },
            customFieldValues: {
              nodes: {
                value: {},
                customField: { name: {} },
              },
            },
          },
        },
      },
    });
    const jobsPage = (data as any)?.organization?.jobs;
    const nodes = jobsPage?.nodes || [];
    allNodes = allNodes.concat(nodes);
    nextPage = jobsPage?.nextPage || null;
    if (!nextPage || nodes.length < PAGE_SIZE) break;
  }

  const jobs = allNodes;
  return jobs.map((j: any) => {
    // Extract the custom "Status" field value
    const statusField = (j.customFieldValues?.nodes || []).find(
      (cfv: any) => cfv.customField?.name === 'Status'
    );
    const customStatus = statusField?.value || null;
    // Extract the "Project Manager" custom field value
    const pmField = (j.customFieldValues?.nodes || []).find(
      (cfv: any) => cfv.customField?.name === 'Project Manager'
    );
    const projectManager = pmField?.value || null;
    return {
      id: j.id,
      name: j.name,
      number: j.number,
      status: j.status,
      createdAt: j.createdAt,
      closedOn: j.closedOn,
      clientName: j.location?.account?.name || '',
      locationName: j.location?.name || '',
      customStatus,
      projectManager,
      statusCategory: getStatusCategory(customStatus),
      priceType: j.priceType || null,
    };
  });
}

export async function getJob(jobId: string) {
  const data = await pave({
    job: {
      $: { id: jobId },
      id: {},
      name: {},
      number: {},
      status: {},
      priceType: {},
      createdAt: {},
      closedOn: {},
      description: {},
      location: {
        id: {},
        name: {},
        account: { id: {}, name: {} },
      },
      customFieldValues: {
        nodes: {
          value: {},
          customField: { name: {} },
        },
      },
    },
  });
  const job = (data as any)?.job;
  if (!job) return null;
  const statusField = (job.customFieldValues?.nodes || []).find(
    (cfv: any) => cfv.customField?.name === 'Status'
  );
  const customStatus = statusField?.value || null;
  return {
    ...job,
    clientName: job.location?.account?.name || '',
    locationName: job.location?.name || '',
    customStatus,
    statusCategory: getStatusCategory(customStatus),
  };
}

// ============================================================
// TASKS (Schedule) - Powers the dashboard "My Open Tasks"
// ============================================================

export interface JTTask {
  id: string;
  name: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  progress: number;
  job: { id: string; name: string } | null;
  assignedMemberships: { nodes: { id: string; user?: { id: string; name: string } }[] };
}

export async function getTasksForJob(jobId: string): Promise<JTTask[]> {
  // Paginate to handle jobs with 100+ tasks (PAVE max page size = 100)
  let allTasks: any[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 5; page++) {  // Max 5 pages = 500 tasks
    const pageParams: Record<string, unknown> = { size: 100 };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        tasks: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            startDate: {},
            endDate: {},
            progress: {},
            parentTask: { id: {} },
            isGroup: {},
          },
        },
      },
    });
    const taskPage = (data as any)?.job?.tasks;
    const nodes = taskPage?.nodes || [];
    allTasks = allTasks.concat(nodes);
    nextPage = taskPage?.nextPage || null;
    if (!nextPage || nodes.length < 100) break;
  }

  return allTasks.map((t: any) => ({ ...t, job: { id: jobId, name: '' } }));
}

// Get ALL open tasks, then filter client-side for a specific membership
// (PAVE doesn't support filtering by assignedMemberships at org level)
export async function getOpenTasksForMember(membershipId: string): Promise<JTTask[]> {
  const allTasks = await getAllOpenTasks();
  return allTasks.filter((t: JTTask) =>
    t.assignedMemberships?.nodes?.some((m: any) => m.id === membershipId)
  );
}

/**
 * Get open/incomplete tasks assigned to a specific member from active (open) jobs only.
 *
 * Queries each active job's tasks with a lightweight payload (IDs + memberships only),
 * then fetches full details for matched tasks. Skips closed jobs entirely.
 *
 * PAVE quirks handled:
 * - progress=null (unstarted tasks) excluded by progress < 1, so we filter client-side
 * - Response too large if user sub-field included, so Pass 1 uses IDs only
 */
export async function getOpenTasksForMemberAcrossJobs(
  membershipId: string,
  activeJobIds: string[],
  firstName?: string
): Promise<JTTask[]> {
  // Pass 1: Scan active jobs for task IDs assigned to this member (lightweight per-job query)
  const matchedTaskIds: string[] = [];

  // Membership-only match. A previous revision also included tasks whose
  // name started with "⏳ <FirstName>:" as a backwards-compat fallback for
  // old Waiting On tasks that didn't have the assignee in
  // assignedMemberships. The /api/dashboard/waiting-on POST flow now
  // always adds both creator and assignee to the task's memberships, so
  // the fallback is no longer needed — and it produced false positives
  // whenever someone manually created or renamed a JT task to use the
  // "⏳ <FirstName>:" prefix without also assigning that person.
  // Any legitimate older task that stops appearing after this change
  // can be fixed by adding the right person to its assignees in JT.
  void firstName; // kept in signature for callers; no longer used

  // Batch jobs to reduce total API calls â query 5 jobs at a time in parallel
  const BATCH_SIZE = 5;
  for (let i = 0; i < activeJobIds.length; i += BATCH_SIZE) {
    const batch = activeJobIds.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (jobId) => {
      try {
        const result = await pave({
          job: {
            $: { id: jobId },
            tasks: {
              $: { size: 100 },
              nodes: {
                id: {},
                name: {},
                progress: {},
                isGroup: {},
                assignedMemberships: { nodes: { id: {} } },
              },
            },
          },
        });
        const nodes = (result as any)?.job?.tasks?.nodes || [];
        for (const t of nodes) {
          if (t.isGroup) continue;
          // Include tasks that are incomplete (progress < 1 or null)
          if (t.progress !== null && t.progress !== undefined && t.progress >= 1) continue;
          const isAssigned = t.assignedMemberships?.nodes?.some(
            (m: any) => m.id === membershipId
          );
          if (isAssigned) {
            matchedTaskIds.push(t.id);
          }
        }
      } catch {
        // Skip jobs that fail (e.g. too large)
      }
    });
    await Promise.all(batchPromises);
  }

  if (matchedTaskIds.length === 0) return [];

  // Pass 2: Fetch full details for matched tasks (parallel, small set)
  const tasks: JTTask[] = [];
  const detailPromises = matchedTaskIds.map(async (taskId) => {
    try {
      const result = await pave({
        task: {
          $: { id: taskId },
          id: {},
          name: {},
          description: {},
          startDate: {},
          endDate: {},
          progress: {},
          isToDo: {},
          job: { id: {}, name: {}, number: {} },
          assignedMemberships: { nodes: { id: {}, user: { name: {} } } },
        },
      });
      const t = (result as any)?.task;
      if (t) tasks.push(t);
    } catch {
      // Skip individual task fetch errors
    }
  });
  await Promise.all(detailPromises);

  return tasks;
}

// Get all open tasks across all active jobs (for Nathan's team workload view)
// Note: uses progress < 1 only â may miss tasks with progress=null.
// For complete results, use getOpenTasksForMemberAcrossJobs which handles null progress.
export async function getAllOpenTasks(): Promise<JTTask[]> {
  const result = await orgQuery('tasks', {
    $: {
      size: 100,
      where: { or: [['progress', '<', 1], ['progress', '=', null]] },
    },
    nodes: {
      id: {},
      name: {},
      startDate: {},
      endDate: {},
      progress: {},
      job: { id: {}, name: {}, number: {} },
      assignedMemberships: {
        nodes: {
          id: {},
        },
      },
    },
  });
  return result.nodes || [];
}

export async function createTask(params: {
  jobId: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  assignedMembershipIds?: string[];
}) {
  const { jobId, name, description, assignedMembershipIds } = params;
  // All new tasks are 1-day tasks: endDate always equals startDate.
  // PAVE requires BOTH startDate and endDate if either is provided.
  let startDate = params.startDate || params.endDate;
  let endDate = startDate; // Force 1-day task

  const data = await pave({
    createTask: {
      $: {
        targetId: jobId,
        targetType: 'job',
        name,
        ...(description ? { description } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(assignedMembershipIds?.length ? { assignedMembershipIds } : {}),
      },
      createdTask: { id: {}, name: {} },
    },
  });
  const created = (data as any)?.createTask?.createdTask;
  if (!created?.id) throw new Error('Task creation failed: ' + JSON.stringify(data));
  return { id: created.id, name: created.name };
}

// ============================================================
// SCHEDULE â Powers the Pre-Construction Tracker
// Task groups (isGroup: true) = phases, child tasks = work items
// Group progress auto-calculates from child task completion (0-1 scale)
// ============================================================

export interface JTScheduleTask {
  id: string;
  name: string;
  description: string | null;
  isGroup: boolean;
  progress: number | null;
  startDate: string | null;
  endDate: string | null;
  parentTask: { id: string; name: string } | null;
  taskType: { id: string; name: string } | null;
  assignedMemberships: { nodes: { id: string; user?: { id: string; name: string } }[] };
  childTasks: { nodes: JTScheduleTask[] };
}

export interface JTJobSchedule {
  id: string;
  name: string;
  number: string;
  clientName: string;
  locationName: string;
  customStatus: string | null;
  statusCategory: StatusCategoryKey | null;
  phases: JTScheduleTask[];
  orphanTasks: JTScheduleTask[];   // Tasks with no parent phase â must be visible!
  totalProgress: number;
}

// Get full schedule tree for a single job
export async function getJobSchedule(jobId: string): Promise<JTJobSchedule | null> {
  // Two lightweight queries instead of one deeply-nested query (avoids 413)

  // 1. Job info (including custom fields)
  const jobData = await pave({
    job: {
      $: { id: jobId },
      id: {},
      name: {},
      number: {},
      location: {
        name: {},
        account: { name: {} },
      },
      customFieldValues: {
        nodes: {
          value: {},
          customField: { name: {} },
        },
      },
    },
  });
  const job = (jobData as any)?.job;
  if (!job) return null;

  const statusField = (job.customFieldValues?.nodes || []).find(
    (cfv: any) => cfv.customField?.name === 'Status'
  );
  const customStatus = statusField?.value || null;

  // 2. Paginate tasks (PAVE max page size = 100)
  let allTasks: any[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 5; page++) {
    const pageParams: Record<string, unknown> = { size: 100 };
    if (nextPage) pageParams.page = nextPage;

    const taskData = await pave({
      job: {
        $: { id: jobId },
        tasks: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            isGroup: {},
            progress: {},
            startDate: {},
            endDate: {},
            parentTask: { id: {} },
          },
        },
      },
    });
    const taskPage = (taskData as any)?.job?.tasks;
    const nodes = taskPage?.nodes || [];
    allTasks = allTasks.concat(nodes);
    nextPage = taskPage?.nextPage || null;
    if (!nextPage || nodes.length < 100) break;
  }

  // 3. Build hierarchy client-side: group children under their parent
  const taskMap = new Map<string, any>();
  for (const t of allTasks) {
    taskMap.set(t.id, { ...t, childTasks: { nodes: [] } });
  }
  for (const t of allTasks) {
    if (t.parentTask?.id && taskMap.has(t.parentTask.id)) {
      taskMap.get(t.parentTask.id).childTasks.nodes.push(taskMap.get(t.id));
    }
  }

  // 4. Top-level groups (phases) = isGroup && no parent
  const phases: JTScheduleTask[] = allTasks
    .filter((t: any) => t.isGroup && !t.parentTask)
    .map((t: any) => taskMap.get(t.id));

  // 5. ORPHAN DETECTION â tasks that have no parent AND are not groups
  //    These were silently dropped before. Now we return them explicitly.
  const phaseIds = new Set(phases.map((p) => p.id));
  const orphanTasks: JTScheduleTask[] = allTasks
    .filter((t: any) => {
      // Not a group, and either:
      // - has no parentTask at all, OR
      // - has a parentTask that doesn't exist in our task map (deleted parent)
      if (t.isGroup) return false;
      if (!t.parentTask) return true;   // no parent at all â orphan
      if (!taskMap.has(t.parentTask.id)) return true;  // parent doesn't exist â orphan
      return false;
    })
    .map((t: any) => taskMap.get(t.id));

  const withProgress = phases.filter((p: JTScheduleTask) => p.progress !== null);
  const totalProgress = withProgress.length
    ? withProgress.reduce((sum: number, p: JTScheduleTask) => sum + (p.progress || 0), 0) / withProgress.length
    : 0;

  return {
    id: job.id,
    name: job.name,
    number: job.number || '',
    clientName: job.location?.account?.name || '',
    locationName: job.location?.name || '',
    customStatus,
    statusCategory: getStatusCategory(customStatus),
    phases,
    orphanTasks,
    totalProgress,
  };
}

// Get schedule overview for ALL active jobs (pre-con grid view)
// Uses a lightweight approach: fetches jobs + all org-level task groups in 2 queries
// instead of N parallel per-job queries (which triggers 413 Request Entity Too Large)
export async function getActiveJobSchedules(): Promise<JTJobSchedule[]> {
  // 1. Get active jobs (now includes customStatus)
  const jobs = await getActiveJobs(50);

  // 2. Get all task groups across org (lightweight â no childTasks to avoid 413)
  const groupResult = await orgQuery('tasks', {
    $: {
      size: 100,
      where: ['isGroup', '=', true],
    },
    nodes: {
      id: {},
      name: {},
      isGroup: {},
      progress: {},
      description: {},
      startDate: {},
      endDate: {},
      parentTask: { id: {} },
      job: { id: {}, name: {} },
    },
  });

  const allGroups = (groupResult.nodes || []) as any[];

  // 3. Build a map of jobId -> top-level phase groups
  const jobPhaseMap: Record<string, any[]> = {};
  for (const group of allGroups) {
    if (!group.job?.id || group.parentTask) continue; // skip orphans and nested groups
    if (!jobPhaseMap[group.job.id]) jobPhaseMap[group.job.id] = [];
    jobPhaseMap[group.job.id].push(group);
  }

  // 4. Assemble schedules
  return jobs.map((job) => {
    const phases = jobPhaseMap[job.id] || [];
    const withProgress = phases.filter((p: any) => p.progress !== null);
    const totalProgress = withProgress.length
      ? withProgress.reduce((sum: number, p: any) => sum + (p.progress || 0), 0) / withProgress.length
      : 0;

    return {
      id: job.id,
      name: job.name,
      number: job.number || '',
      clientName: job.clientName || '',
      locationName: job.locationName || '',
      customStatus: job.customStatus || null,
      statusCategory: job.statusCategory || null,
      phases,
      orphanTasks: [],  // Overview doesn't load orphans (too expensive)
      totalProgress,
    };
  });
}

// ============================================================
// SCHEDULE MUTATIONS
// ============================================================

// Create a phase group (task group) on a job
export async function createPhaseGroup(params: {
  jobId: string;
  name: string;
  description?: string;
}) {
  const { jobId, name, description } = params;
  const data = await pave({
    createTask: {
      $: {
        targetId: jobId,
        targetType: 'job',
        name,
        isGroup: true,
        ...(description ? { description } : {}),
      },
      createdTask: { id: {}, name: {}, isGroup: {} },
    },
  });
  const created = (data as any)?.createTask?.createdTask;
  if (!created?.id) throw new Error('Phase group creation failed: ' + JSON.stringify(data));
  return created;
}

// Create a child task under a phase group
// NOTE: PAVE API has a known limitation where tasks imported from templates
// (created via JT UI template import) cannot accept new children via API.
// When this happens, we fall back to creating the task at the job level
// and return a warning flag so the UI can inform the user.
export async function createPhaseTask(params: {
  jobId: string;
  parentGroupId: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  assignedMembershipIds?: string[];
}): Promise<{ id: string; name: string; parentTask: any; warning?: string }> {
  const { jobId, parentGroupId, name, description, assignedMembershipIds } = params;
  // All new tasks are 1-day tasks: endDate always equals startDate.
  // PAVE requires BOTH startDate and endDate if either is provided.
  let startDate = params.startDate || params.endDate;
  let endDate = startDate; // Force 1-day task

  const optionalFields = {
    ...(description ? { description } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(assignedMembershipIds?.length ? { assignedMembershipIds } : {}),
  };

  // First try: create as a child of the specified phase
  try {
    const data = await pave({
      createTask: {
        $: {
          targetId: jobId,
          targetType: 'job',
          name,
          parentTaskId: parentGroupId,
          ...optionalFields,
        },
        createdTask: { id: {}, name: {}, parentTask: { id: {}, name: {} } },
      },
    });
    const created = (data as any)?.createTask?.createdTask;
    if (created?.id) return created;
  } catch (err: any) {
    // If the error is specifically about the parent task not existing
    // (PAVE limitation with template-imported phases), fall back
    if (err.message?.includes('parent task provided does not exist')) {
      // Fallback: create the task at job level without a parent
      const fallbackData = await pave({
        createTask: {
          $: {
            targetId: jobId,
            targetType: 'job',
            name,
            ...optionalFields,
          },
          createdTask: { id: {}, name: {} },
        },
      });
      const created = (fallbackData as any)?.createTask?.createdTask;
      if (!created?.id) throw new Error('Phase task creation failed (fallback): ' + JSON.stringify(fallbackData));
      return {
        ...created,
        parentTask: null,
        warning: 'This phase was imported from a JobTread template. The task was created at the job level instead. You can drag it into the phase in JobTread.',
      };
    }
    throw err; // Re-throw other errors
  }
  throw new Error('Phase task creation failed: no task returned');
}

// Update task progress (0 = not started, 0.5 = in progress, 1 = complete)
export async function updateTaskProgress(taskId: string, progress: number) {
  await pave({
    updateTask: {
      $: { id: taskId, progress: Math.min(1, Math.max(0, progress)) },
    },
  });
}

// Fetch a single task by ID (used to look up current dates for duration preservation)
export async function getTaskById(taskId: string): Promise<{
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
}> {
  const data = await pave({
    task: {
      $: { id: taskId },
      id: {},
      name: {},
      startDate: {},
      endDate: {},
    },
  });
  const task = (data as any)?.task;
  if (!task?.id) throw new Error('Task not found: ' + taskId);
  return task;
}

// Helper: compute day difference between two YYYY-MM-DD date strings
function dateDiffDays(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
}

// Helper: add days to a YYYY-MM-DD date string
function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// General task update â change name, dates, description, progress, etc.
export async function updateTask(taskId: string, fields: {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  progress?: number;
}) {
  const params: any = { id: taskId };
  if (fields.name !== undefined) params.name = fields.name;
  if (fields.description !== undefined) params.description = fields.description;

  // Duration preservation: when startDate changes but endDate is NOT explicitly set,
  // look up the current task dates and shift endDate to keep the same duration.
  if (fields.startDate !== undefined && fields.endDate === undefined) {
    try {
      const current = await getTaskById(taskId);
      if (current.startDate && current.endDate) {
        const duration = dateDiffDays(current.startDate, current.endDate);
        params.startDate = fields.startDate;
        params.endDate = addDays(fields.startDate, duration);
      } else {
        // No existing dates â treat as 1-day task
        params.startDate = fields.startDate;
        params.endDate = fields.startDate;
      }
    } catch {
      // Fallback: just set both to the same date
      params.startDate = fields.startDate;
      params.endDate = fields.startDate;
    }
  } else {
    if (fields.startDate !== undefined) params.startDate = fields.startDate;
    if (fields.endDate !== undefined) params.endDate = fields.endDate;
  }

  if (fields.progress !== undefined) params.progress = Math.min(1, Math.max(0, fields.progress));
  // pave() now throws on PAVE API errors, so if this succeeds the update went through
  await pave({
    updateTask: { $: params },
  });
  return { success: true, taskId, updatedFields: Object.keys(fields) };
}

// Delete a task (works for both groups and individual tasks)
export async function deleteJTTask(taskId: string) {
  await pave({
    deleteTask: { $: { id: taskId } },
  });
}

// ============================================================
// TEMPLATE APPLICATION â Apply standard BKB schedule to a job
// Creates all 9 phase groups + default tasks with durations
// ============================================================

export async function applyStandardTemplate(jobId: string): Promise<{
  phasesCreated: number;
  tasksCreated: number;
  errors: string[];
}> {
  let phasesCreated = 0;
  let tasksCreated = 0;
  const errors: string[] = [];

  for (const phase of BKB_STANDARD_TEMPLATE) {
    try {
      // Create the phase group
      const group = await createPhaseGroup({
        jobId,
        name: phase.name,
        description: phase.description,
      });
      phasesCreated++;

      // Create default tasks under this phase (unless startsEmpty)
      if (!phase.startsEmpty) {
        for (const task of phase.tasks) {
          try {
            // Calculate start/end dates based on duration
            // For now, just create tasks without dates â Evan will set them
            await createPhaseTask({
              jobId,
              parentGroupId: group.id,
              name: task.name,
              description: task.description,
            });
            tasksCreated++;
          } catch (taskErr: any) {
            errors.push(`Task "${task.name}" in ${phase.name}: ${taskErr.message}`);
          }
        }
      }
    } catch (phaseErr: any) {
      errors.push(`Phase "${phase.name}": ${phaseErr.message}`);
    }
  }

  return { phasesCreated, tasksCreated, errors };
}

// Apply default tasks to a single phase
export async function applyPhaseDefaults(
  jobId: string,
  parentGroupId: string,
  phaseNumber: number
): Promise<{ tasksCreated: number; errors: string[] }> {
  const phase = BKB_STANDARD_TEMPLATE.find((p) => p.phaseNumber === phaseNumber);
  if (!phase) throw new Error(`No template found for phase number ${phaseNumber}`);
  if (phase.startsEmpty) return { tasksCreated: 0, errors: [] };

  let tasksCreated = 0;
  const errors: string[] = [];

  for (const task of phase.tasks) {
    try {
      await createPhaseTask({
        jobId,
        parentGroupId,
        name: task.name,
        description: task.description,
      });
      tasksCreated++;
    } catch (err: any) {
      errors.push(`"${task.name}": ${err.message}`);
    }
  }

  return { tasksCreated, errors };
}

// ============================================================
// SCHEDULE AUDIT â Analyze ALL active jobs for misplaced tasks
// Fetches all non-group tasks across org, maps to their parent phases,
// then runs recommendPhaseForTask on each.
// ============================================================

export interface AuditIssue {
  taskId: string;
  taskName: string;
  taskProgress: number | null;
  startDate: string | null;
  endDate: string | null;
  jobId: string;
  jobName: string;
  jobNumber: string;
  customStatus: string | null;
  statusCategory: StatusCategoryKey | null;
  currentPhaseId: string | null;
  currentPhaseName: string | null;
  recommendedPhaseNumber: number;
  recommendedPhaseName: string;
  confidence: 'high' | 'medium';
  reason: string;
  isOrphan: boolean;
}

export async function getScheduleAudit(): Promise<{
  issues: AuditIssue[];
  stats: {
    totalJobs: number;
    totalTasks: number;
    misplacedTasks: number;
    orphanTasks: number;
    jobsWithIssues: number;
  };
}> {
  // 1. Get active jobs
  const jobs = await getActiveJobs(50);
  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  // 2. Get ALL task groups (phases) across org
  const groupResult = await orgQuery('tasks', {
    $: {
      size: 100,
      where: ['isGroup', '=', true],
    },
    nodes: {
      id: {},
      name: {},
      isGroup: {},
      progress: {},
      parentTask: { id: {} },
      job: { id: {} },
    },
  });
  const allGroups = (groupResult.nodes || []) as any[];

  // Build phase lookup: groupId -> { name, jobId, phaseNumber }
  const phaseMap = new Map<string, { name: string; jobId: string; phaseNumber: number | null }>();
  for (const g of allGroups) {
    if (!g.job?.id || g.parentTask) continue;
    const lower = g.name.toLowerCase().trim();
    let phaseNumber: number | null = null;
    // Match phase name to standard number
    for (const sp of STANDARD_PHASES) {
      if (lower === sp.name.toLowerCase() || lower.includes(sp.short.toLowerCase())) {
        phaseNumber = sp.number;
        break;
      }
    }
    if (phaseNumber === null) {
      if (lower.includes('admin')) phaseNumber = 1;
      else if (lower.includes('conceptual')) phaseNumber = 2;
      else if (lower.includes('design dev') || lower.includes('selections')) phaseNumber = 3;
      else if (lower.includes('contract')) phaseNumber = 4;
      else if (lower.includes('precon') || lower.includes('pre-con')) phaseNumber = 5;
      else if (lower.includes('production')) phaseNumber = 6;
      else if (lower.includes('inspection')) phaseNumber = 7;
      else if (lower.includes('punch')) phaseNumber = 8;
      else if (lower.includes('completion') || lower.includes('closeout')) phaseNumber = 9;
    }
    phaseMap.set(g.id, { name: g.name, jobId: g.job.id, phaseNumber });
  }

  // 3. Get ALL non-group tasks across org (incomplete only for relevance)
  const taskResult = await orgQuery('tasks', {
    $: {
      size: 100,
      where: ['isGroup', '=', false],
    },
    nodes: {
      id: {},
      name: {},
      progress: {},
      startDate: {},
      endDate: {},
      parentTask: { id: {} },
      job: { id: {} },
    },
  });
  const allTasks = (taskResult.nodes || []) as any[];

  // 4. Analyze each task
  const issues: AuditIssue[] = [];
  let totalTasks = 0;

  for (const task of allTasks) {
    if (!task.job?.id) continue;
    const job = jobMap.get(task.job.id);
    if (!job) continue; // not an active job

    totalTasks++;

    const parentId = task.parentTask?.id;
    const phase = parentId ? phaseMap.get(parentId) : null;
    const isOrphan = !parentId || !phase;

    // Get recommendation
    const rec = recommendPhaseForTask(task.name);
    if (!rec || rec.confidence === 'low') continue;

    // If it's in the right phase, skip
    if (!isOrphan && phase && phase.phaseNumber === rec.phaseNumber) continue;

    issues.push({
      taskId: task.id,
      taskName: task.name,
      taskProgress: task.progress,
      startDate: task.startDate,
      endDate: task.endDate,
      jobId: job.id,
      jobName: job.name,
      jobNumber: job.number,
      customStatus: job.customStatus || null,
      statusCategory: job.statusCategory || null,
      currentPhaseId: parentId || null,
      currentPhaseName: phase?.name || null,
      recommendedPhaseNumber: rec.phaseNumber,
      recommendedPhaseName: rec.phaseName,
      confidence: rec.confidence,
      reason: rec.reason,
      isOrphan,
    });
  }

  // Count unique jobs with issues
  const jobsWithIssues = new Set(issues.map((i) => i.jobId)).size;
  const orphanCount = issues.filter((i) => i.isOrphan).length;

  return {
    issues,
    stats: {
      totalJobs: jobs.length,
      totalTasks,
      misplacedTasks: issues.length - orphanCount,
      orphanTasks: orphanCount,
      jobsWithIssues,
    },
  };
}

// Move a task to a different phase (delete + recreate under new parent)
// PAVE API doesn't support reparenting, so we delete the old task and create a new one.
export async function moveTaskToPhase(params: {
  jobId: string;
  taskId: string;
  taskName: string;
  newParentGroupId: string;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<{ newTaskId: string; name: string }> {
  const { jobId, taskId, taskName, newParentGroupId, startDate, endDate } = params;

  // 1. Delete the old task
  await deleteJTTask(taskId);

  // 2. Create under the new phase
  const created = await createPhaseTask({
    jobId,
    parentGroupId: newParentGroupId,
    name: taskName,
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  });

  return { newTaskId: created.id, name: created.name || taskName };
}

// ============================================================
// DOCUMENTS - For document intelligence
// ============================================================

export interface JTDocument {
  id: string;
  name: string;
  subject: string | null;
  status: string;
  type: string;
  description: string;
  number: string;
  price: number | null;
  cost: number | null;
  createdAt: string;
  issueDate: string | null;
  signedAt: string | null;
  // false when "Exclude from Budget" is toggled on in JobTread. Any budget/
  // contract/CO calculation must treat includeInBudget === false as excluded.
  includeInBudget?: boolean;
  // JT-computed outstanding balance. For customerOrders: price minus the
  // sum of prices of linked customerInvoices (draft + pending + approved).
  // For customerInvoices: price minus payments received.
  // Use this as the authoritative "what's left" signal — formulas that
  // derive it from totals cannot tell which invoice was created from which
  // CO and misclassify direct CO-invoicing.
  balance?: number | null;
  job: { id: string; name: string };
}

export async function getDocumentsForJob(jobId: string): Promise<JTDocument[]> {
  // Paginate documents â some jobs (like Bruno) have 100+ documents
  const PAGE_SIZE = 50;
  let allDocs: any[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 10; page++) {
    const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        documents: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            subject: {},
            status: {},
            type: {},
            description: {},
            number: {},
            price: {},
            cost: {},
            balance: {},
            createdAt: {},
            issueDate: {},
            signedAt: {},
            // includeInBudget=false means "Exclude from Budget" is toggled on
            // in JT — all budget/contract/CO calculations must skip these docs.
            includeInBudget: {},
          },
        },
      },
    });

    const docsPage = (data as any)?.job?.documents;
    const nodes = docsPage?.nodes || [];
    allDocs = allDocs.concat(nodes);
    nextPage = docsPage?.nextPage || null;
    if (!nextPage || nodes.length < PAGE_SIZE) break;
  }

  return allDocs.map((d: any) => ({ ...d, job: { id: jobId, name: '' } }));
}

/**
 * Lightweight query: get just document IDs, names, and statuses for a job.
 * Much smaller payload than getDocumentsForJob â used for filtering cost items by approval status.
 */
export async function getDocumentStatusesForJob(jobId: string): Promise<Array<{ id: string; name: string; number: string; status: string; type: string; createdAt?: string; includeInBudget?: boolean }>> {
  const data = await pave({
    job: {
      $: { id: jobId },
      documents: {
        $: { size: 50 },
        nodes: {
          id: {},
          name: {},
          number: {},
          status: {},
          type: {},
          createdAt: {},
          includeInBudget: {},
        },
      },
    },
  });
  return (data as any)?.job?.documents?.nodes || [];
}

export async function getApprovedDocuments(limit = 100): Promise<JTDocument[]> {
  const result = await orgQuery('documents', {
    $: {
      size: limit,
      where: ['status', '=', 'approved'],
    },
    nodes: {
      id: {},
      name: {},
      status: {},
      type: {},
      description: {},
      number: {},
      createdAt: {},
      signedAt: {},
      job: { id: {}, name: {} },
    },
  });
  return result.nodes || [];
}

// ============================================================
// DOCUMENT CONTENT â Read line items inside a document
// ============================================================

export interface JTDocumentContent {
  id: string;
  name: string;
  type: string;
  status: string;
  description: string;
  footer: string;
  costGroups: {
    id: string;
    name: string;
    description?: string;
    costItems: {
      id: string;
      name: string;
      description?: string;
      quantity: number;
      unitCost: number;
      unitPrice: number;
      costCode?: { name: string; number: string } | null;
    }[];
  }[];
  costItems: {
    id: string;
    name: string;
    description?: string;
    quantity: number;
    unitCost: number;
    unitPrice: number;
    costCode?: { name: string; number: string } | null;
  }[];
}

export async function getDocumentContent(documentId: string): Promise<JTDocumentContent | null> {
  try {
    const data = await pave({
      document: {
        $: { id: documentId },
        id: {},
        name: {},
        type: {},
        status: {},
        description: {},
        footer: {},
        cost: {},
        price: {},
        tax: {},
        costGroups: {
          nodes: {
            id: {},
            name: {},
            description: {},
            quantity: {},
            costItems: {
              nodes: {
                id: {},
                name: {},
                description: {},
                quantity: {},
                unitCost: {},
                unitPrice: {},
                unitId: {},
                costCode: { name: {}, number: {} },
              },
            },
          },
        },
        costItems: {
          $: { size: 100 },
          nodes: {
            id: {},
            name: {},
            description: {},
            quantity: {},
            unitCost: {},
            unitPrice: {},
            unitId: {},
            costCode: { name: {}, number: {} },
            costGroup: { id: {}, name: {} },
          },
        },
      },
    });
    const doc = (data as any)?.document;
    if (!doc) return null;
    return {
      id: doc.id,
      name: doc.name || '',
      type: doc.type || '',
      status: doc.status || '',
      description: doc.description || '',
      footer: doc.footer || '',
      costGroups: (doc.costGroups?.nodes || []).map((g: any) => ({
        id: g.id,
        name: g.name || '',
        description: g.description || '',
        costItems: (g.costItems?.nodes || []).map((ci: any) => ({
          id: ci.id,
          name: ci.name || '',
          description: ci.description || '',
          quantity: ci.quantity || 0,
          unitCost: ci.unitCost || 0,
          unitPrice: ci.unitPrice || 0,
          costCode: ci.costCode || null,
        })),
      })),
      costItems: (doc.costItems?.nodes || []).map((ci: any) => ({
        id: ci.id,
        name: ci.name || '',
        description: ci.description || '',
        quantity: ci.quantity || 0,
        unitCost: ci.unitCost || 0,
        unitPrice: ci.unitPrice || 0,
        costCode: ci.costCode || null,
      })),
    };
  } catch (err: any) {
    console.warn('[getDocumentContent] Error reading document content:', documentId, err?.message);
    return null;
  }
}

// ============================================================
// FILES - Job-level files for Tier 2 sync
// ============================================================

export async function getFilesForJob(jobId: string) {
  const data = await pave({
    job: {
      $: { id: jobId },
      files: {
        $: { size: 100 },
        nodes: {
          id: {},
          name: {},
          url: {},
          type: {},
          size: {},
          createdAt: {},
        },
      },
    },
  });
  return (data as any)?.job?.files?.nodes || [];
}

// ============================================================
// MEMBERS
// ============================================================

export interface JTMember {
  id: string;
  user: { id: string; name: string };
}

export async function getMembers(): Promise<JTMember[]> {
  const result = await orgQuery('memberships', {
    $: { size: 100 },
    nodes: {
      id: {},
      user: { id: {}, name: {} },
    },
  });
  return result.nodes || [];
}

// ============================================================
// COST CODES
// ============================================================

export async function getCostCodes() {
  const result = await orgQuery('costCodes', {
    $: { size: 100 },
    nodes: {
      id: {},
      name: {},
      number: {},
    },
  });
  return result.nodes || [];
}

// ============================================================
// BILLS - For billable bills dashboard (Terri & Nathan)
// ============================================================

export async function getBillableDocuments(limit = 100) {
  // Vendor bills that may need billing action
  const result = await orgQuery('documents', {
    $: {
      size: limit,
      where: ['type', '=', 'vendorBill'],
    },
    nodes: {
      id: {},
      name: {},
      status: {},
      type: {},
      description: {},
      number: {},
      createdAt: {},
      job: { id: {}, name: {} },
    },
  });
  return result.nodes || [];
}

// ============================================================
// GRID VIEW â Pre-construction dashboard data
// Returns per-phase task counts for each active job
// ============================================================

export interface GridPhaseData {
  phaseGroupId: string | null;
  phaseName: string;
  completed: number;
  total: number;
  inProgress: number;
  hasOverdue: boolean;
}

export interface GridJobData {
  id: string;
  name: string;
  number: string;
  clientName: string;
  locationName: string;
  customStatus: string | null;
  statusCategory: StatusCategoryKey | null;
  phases: GridPhaseData[];
  hasSchedule: boolean;
  totalCompleted: number;
  totalTasks: number;
  nextDueDate: string | null;
  stalledDays: number | null;
}
// ============================================================
// DAILY LOGS â Job-level daily log entries
// ============================================================

export interface JTDailyLog {
  id: string;
  date: string;
  notes: string;
  createdAt: string;
  assignedMemberships?: { nodes: { id: string; user?: { id: string; name: string } }[] };
}

export async function getDailyLogsForJob(jobId: string, limit = 200): Promise<JTDailyLog[]> {
  const dailyLogNodeFields = {
    id: {},
    date: {},
    notes: {},
    createdAt: {},
    assignedMemberships: {
      nodes: {
        id: {},
        user: { id: {}, name: {} },
      },
    },
  };

  const PAGE_SIZE = 100;

  // Strategy 1: Try job.dailyLogs sub-collection with pagination
  try {
    let allLogs: any[] = [];
    let nextPage: string | null = null;

    for (let page = 0; page < 10; page++) {
      const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
      if (nextPage) pageParams.page = nextPage;

      const data = await pave({
        job: {
          $: { id: jobId },
          dailyLogs: {
            $: pageParams,
            nextPage: {},
            nodes: dailyLogNodeFields,
          },
        },
      });
      const logPage = (data as any)?.job?.dailyLogs;
      const nodes = logPage?.nodes || [];
      allLogs = allLogs.concat(nodes);
      nextPage = logPage?.nextPage || null;

      if (allLogs.length >= limit || !nextPage || nodes.length < PAGE_SIZE) break;
    }

    if (allLogs.length > 0) {
      // Sort by date descending (newest first)
      allLogs.sort((a, b) => {
        const dateA = a.date || a.createdAt || '';
        const dateB = b.date || b.createdAt || '';
        return dateB.localeCompare(dateA);
      });
      return allLogs.slice(0, limit);
    }
  } catch (_err: any) {
    // Sub-collection not supported â fall through
  }

  // Strategy 2: Try organization-level with where filter + pagination
  try {
    let allLogs: any[] = [];
    let nextPage: string | null = null;

    for (let page = 0; page < 10; page++) {
      const pageParams: Record<string, unknown> = {
        size: PAGE_SIZE,
        where: ['jobId', '=', jobId],
      };
      if (nextPage) pageParams.page = nextPage;

      const data = await pave({
        organization: {
          $: { id: JT_ORG() },
          dailyLogs: {
            $: pageParams,
            nextPage: {},
            nodes: dailyLogNodeFields,
          },
        },
      });
      const logPage = (data as any)?.organization?.dailyLogs;
      const nodes = logPage?.nodes || [];
      allLogs = allLogs.concat(nodes);
      nextPage = logPage?.nextPage || null;

      if (allLogs.length >= limit || !nextPage || nodes.length < PAGE_SIZE) break;
    }

    if (allLogs.length > 0) {
      allLogs.sort((a, b) => {
        const dateA = a.date || a.createdAt || '';
        const dateB = b.date || b.createdAt || '';
        return dateB.localeCompare(dateA);
      });
      return allLogs.slice(0, limit);
    }
  } catch (_err2: any) {
    // Org-level with where failed â try without where and filter client-side
  }

  // Strategy 3: Fetch org daily logs without where filter, filter client-side
  try {
    let allLogs: any[] = [];
    let nextPage: string | null = null;

    for (let page = 0; page < 5; page++) {
      const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
      if (nextPage) pageParams.page = nextPage;

      const data = await pave({
        organization: {
          $: { id: JT_ORG() },
          dailyLogs: {
            $: pageParams,
            nextPage: {},
            nodes: {
              ...dailyLogNodeFields,
              job: { id: {} },
            },
          },
        },
      });
      const logPage = (data as any)?.organization?.dailyLogs;
      const nodes = logPage?.nodes || [];
      allLogs = allLogs.concat(nodes);
      nextPage = logPage?.nextPage || null;

      if (!nextPage || nodes.length < PAGE_SIZE) break;
    }

    const filtered = allLogs.filter((log: any) => log?.job?.id === jobId);
    if (filtered.length > 0) {
      filtered.sort((a, b) => {
        const dateA = a.date || a.createdAt || '';
        const dateB = b.date || b.createdAt || '';
        return dateB.localeCompare(dateA);
      });
      return filtered.slice(0, limit);
    }
  } catch (_err3: any) {
    // All strategies failed
  }

  console.warn('[getDailyLogsForJob] All query strategies failed for job:', jobId);
  return [];
}

// Daily Log Type custom field ID â required by BKB's JobTread configuration.
// Options: "Change Order", "Projects Review Meeting", "Client Meeting", "Receipts", "Other"
const DAILY_LOG_TYPE_FIELD_ID = '22P5xZ5QiRLq';

export async function createDailyLog(params: {
  jobId: string;
  date: string;       // YYYY-MM-DD
  notes: string;
  assignees?: string[];  // membership IDs
  notify?: boolean;
  dailyLogType?: string; // defaults to "Other"
}) {
  const { jobId, date, notes, assignees, notify, dailyLogType } = params;
  const data = await pave({
    createDailyLog: {
      $: {
        jobId,
        date,
        notes,
        ...(assignees?.length ? { assignees } : {}),
        ...(notify !== undefined ? { notify } : {}),
        customFieldValues: {
          [DAILY_LOG_TYPE_FIELD_ID]: dailyLogType || 'Other',
        },
      },
      createdDailyLog: { id: {}, date: {}, notes: {} },
    },
  });
  const created = (data as any)?.createDailyLog?.createdDailyLog;
  if (!created?.id) throw new Error('Daily log creation failed: ' + JSON.stringify(data));
  return created;
}

export async function updateDailyLog(params: {
  id: string;
  notes?: string;
  date?: string;
}) {
  const { id, notes, date } = params;
  const updateParams: any = { id };
  if (notes !== undefined) updateParams.notes = notes;
  if (date !== undefined) updateParams.date = date;
  await pave({
    updateDailyLog: { $: updateParams },
  });
  return { success: true, id };
}

export async function deleteDailyLog(id: string) {
  await pave({
    deleteDailyLog: { $: { id } },
  });
}

// ============================================================
// COMMENTS â Comments on any JobTread entity
// ============================================================

export interface JTComment {
  id: string;
  message: string;
  name: string;          // Used as author display name on dashboard-created comments
  createdAt: string;
  isPinned: boolean;
  parentComment?: { id: string } | null;
}

export async function getCommentsForTarget(targetId: string, targetType: string, limit = 200): Promise<JTComment[]> {
  // Paginate to get all comments (default limit raised to 200, supports multi-page fetching)
  // Try querying comments through the parent entity first
  // targetType can be: job, task, document, costItem, etc.

  // Note: 'user' relation does NOT work in sub-collection queries
  // We use the 'name' field to store/display author name on creation
  const commentFieldsBase = {
    id: {},
    message: {},
    name: {},
    createdAt: {},
    isPinned: {},
    parentComment: { id: {} },
  };

  // Strategy 1: Sub-collection query through the parent entity, with pagination
  try {
    let allComments: any[] = [];
    let nextPage: string | null = null;
    const PAGE_SIZE = 100;

    for (let page = 0; page < 10; page++) { // Max 10 pages = 1000 comments
      const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
      if (nextPage) pageParams.page = nextPage;

      const data = await pave({
        [targetType]: {
          $: { id: targetId },
          comments: {
            $: pageParams,
            nextPage: {},
            nodes: commentFieldsBase,
          },
        },
      });
      const commentPage = (data as any)?.[targetType]?.comments;
      const nodes = commentPage?.nodes || [];
      allComments = allComments.concat(nodes);
      nextPage = commentPage?.nextPage || null;

      // Stop if we've hit the requested limit, no more pages, or got fewer than page size
      if (allComments.length >= limit || !nextPage || nodes.length < PAGE_SIZE) break;
    }

    // Sort by createdAt descending (newest first) to ensure recent comments are included
    allComments.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
    return allComments.slice(0, limit);
  } catch (_err: any) {
    // Fall through to org-level query
  }

  // Strategy 2: Fallback â query through organization with targetId filter, with pagination
  let allComments: any[] = [];
  let nextPage: string | null = null;
  const PAGE_SIZE = 100;

  for (let page = 0; page < 10; page++) {
    const pageParams: Record<string, unknown> = {
      size: PAGE_SIZE,
      where: ['targetId', '=', targetId],
    };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      organization: {
        $: { id: JT_ORG() },
        comments: {
          $: pageParams,
          nextPage: {},
          nodes: commentFieldsBase,
        },
      },
    });
    const commentPage = (data as any)?.organization?.comments;
    const nodes = commentPage?.nodes || [];
    allComments = allComments.concat(nodes);
    nextPage = commentPage?.nextPage || null;

    if (allComments.length >= limit || !nextPage || nodes.length < PAGE_SIZE) break;
  }

  // Sort by createdAt descending (newest first)
  allComments.sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });
  return allComments.slice(0, limit);
}

/**
 * Get comments for a task with author names (user field).
 * Uses sub-collection query to get IDs, then fetches user info
 * via individual comment queries in parallel (user field only works at top level).
 */
export async function getTaskCommentsWithUser(taskId: string, limit = 50): Promise<Array<JTComment & { userName?: string }>> {
  // Get comments via sub-collection query (fast, reliable)
  // Note: PAVE doesn't expose a `user` relation on comments, so author name
  // comes from the `name` field (set to poster's name for dashboard-created comments).
  const comments = await getCommentsForTarget(taskId, 'task', limit);
  return comments.map(c => ({ ...c, userName: c.name || undefined }));
}

export async function createComment(params: {
  targetId: string;
  targetType: string;    // 'job' | 'task' | 'document' | etc.
  message: string;
  name?: string;         // Comment author display name
  assignees?: string[];  // membership IDs to notify
  isPinned?: boolean;
  parentCommentId?: string;  // for replies
}) {
  const { targetId, targetType, message, name, assignees, isPinned, parentCommentId } = params;
  const data = await pave({
    createComment: {
      $: {
        targetId,
        targetType,
        message,
        ...(name ? { name } : {}),
        ...(assignees?.length ? { assignees } : {}),
        ...(isPinned !== undefined ? { isPinned } : {}),
        ...(parentCommentId ? { parentCommentId, isReply: true } : {}),
      },
      createdComment: { id: {}, message: {}, name: {}, createdAt: {} },
    },
  });
  const created = (data as any)?.createComment?.createdComment;
  if (!created?.id) throw new Error('Comment creation failed: ' + JSON.stringify(data));
  return created;
}

// ============================================================
// TIME ENTRIES â Track labor hours
// ============================================================

export interface JTTimeEntry {
  id: string;
  startedAt: string;
  endedAt: string;
  notes: string;
  type: string;
  cost?: number;
  user?: { id: string; name: string };
  costItem?: { id: string; name: string; costCode?: { number: string; name: string } | null } | null;
}

export async function getTimeEntriesForJob(jobId: string): Promise<JTTimeEntry[]> {
  const PAGE_SIZE = 100; // PAVE hard cap per query
  const MAX_PAGES = 10;  // Safety cap: 1000 entries max
  const teFields = {
    nodes: {
      id: {},
      startedAt: {},
      endedAt: {},
      notes: {},
      type: {},
      cost: {},
      user: { id: {}, name: {} },
      costItem: { id: {}, name: {}, costCode: { number: {}, name: {} } },
    },
  };

  // Paginated fetch: PAVE caps at 100 per query and returns oldest-first.
  // Jobs with >100 time entries (e.g. Halvorsen with 145) silently lose the
  // newest entries, which are often the CC23 billable hours needed for
  // invoicing health. Paginate using where: ["id", ">", lastId].
  try {
    const allEntries: JTTimeEntry[] = [];
    let lastId: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params: Record<string, unknown> = { size: PAGE_SIZE };
      if (lastId) {
        params.where = ['id', '>', lastId];
      }

      const data = await pave({
        job: {
          $: { id: jobId },
          timeEntries: {
            $: params,
            ...teFields,
          },
        },
      });

      const entries = (data as any)?.job?.timeEntries?.nodes;
      if (!entries || !Array.isArray(entries) || entries.length === 0) break;

      allEntries.push(...entries);
      lastId = entries[entries.length - 1].id;

      // If we got fewer than PAGE_SIZE, we've reached the end
      if (entries.length < PAGE_SIZE) break;
    }

    if (allEntries.length > 0) return allEntries;
  } catch (_err: any) {
    // Sub-collection not supported â fall through to org-level
  }

  // Fallback: Organization-level with where filter (no pagination)
  try {
    const data = await pave({
      organization: {
        $: { id: JT_ORG() },
        timeEntries: {
          $: { size: PAGE_SIZE, where: ['jobId', '=', jobId] },
          ...teFields,
        },
      },
    });
    return (data as any)?.organization?.timeEntries?.nodes || [];
  } catch (_err2: any) {
    console.warn('[getTimeEntriesForJob] All query strategies failed for job:', jobId);
    return [];
  }
}

// ============================================================
// JOB UPDATES â Modify job details
// ============================================================

export async function updateJob(jobId: string, fields: {
  name?: string;
  description?: string;
  specificationsDescription?: string;
  specificationsFooter?: string;
  closedOn?: string | null;
}) {
  const params: any = { id: jobId };
  if (fields.name !== undefined) params.name = fields.name;
  if (fields.description !== undefined) params.description = fields.description;
  if (fields.specificationsDescription !== undefined) params.specificationsDescription = fields.specificationsDescription;
  if (fields.specificationsFooter !== undefined) params.specificationsFooter = fields.specificationsFooter;
  if (fields.closedOn !== undefined) params.closedOn = fields.closedOn;
  await pave({
    updateJob: { $: params },
  });
  return { success: true, jobId, updatedFields: Object.keys(fields) };
}

// ============================================================
// COST ITEMS & SPECIFICATIONS
// ============================================================

export interface JTCostItemFile {
  id: string;
  name: string;
  url: string;
}

export interface JTCostItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  /** Extended cost (qty Ã unitCost, or accumulated from time entries) */
  cost: number;
  /** Extended price (qty Ã unitPrice, or accumulated from time entries) */
  price: number;
  isSpecification: boolean;
  costType?: { id: string; name: string } | null;
  costCode?: { id: string; name: string; number: string } | null;
  costGroup?: { id: string; name: string; description?: string; files?: JTCostItemFile[]; parentCostGroup?: { id: string; name: string; description?: string; files?: JTCostItemFile[] } | null } | null;
  files?: JTCostItemFile[];
  // Document association: null = Estimating, otherwise attached to a proposal/invoice
  document?: { id: string; name: string; type: string; status?: string } | null;
  // Budget item this document cost item is linked to. costCode on the linked
  // budget item is preferred over the line-level costCode for bucket filtering,
  // because the budget link is what drives budget-vs-actual reports.
  jobCostItem?: { id: string; costCode?: { number?: string; name?: string } | null } | null;
  // Custom fields (Status, Internal Notes, Vendor)
  status?: string | null;
  internalNotes?: string | null;
  vendor?: string | null;
}

/**
 * Lightweight cost item fetch for invoicing â only the fields needed
 * for billing analysis. Avoids 413 errors from oversized queries.
 */
export async function getCostItemsForJobLite(jobId: string, limit = 200): Promise<JTCostItem[]> {
  const PAGE_SIZE = 100;
  let allItems: any[] = [];
  let nextPage: string | null = null;
  const maxPages = Math.ceil(limit / PAGE_SIZE);

  for (let page = 0; page < maxPages; page++) {
    const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            quantity: {},
            unitCost: {},
            unitPrice: {},
            cost: {},
            price: {},
            costType: { id: {}, name: {} },
            costCode: { id: {}, name: {}, number: {} },
            document: { id: {}, name: {}, type: {}, status: {} },
          },
        },
      },
    });

    const costItemPage = (data as any)?.job?.costItems;
    const nodes = costItemPage?.nodes || [];
    allItems = allItems.concat(nodes);
    nextPage = costItemPage?.nextPage || null;
    if (!nextPage || nodes.length < PAGE_SIZE) break;
  }

  return allItems;
}

/**
 * Fetch cost items that live on DOCUMENTS (vendor bills, customer invoices, etc.)
 * for a given job. job.costItems only returns budget-level items, but vendor bill
 * line items and invoice line items are document-level cost items.
 * Returns a flat array with each item's parent document type included.
 */
export async function getDocumentCostItemsForJob(jobId: string): Promise<JTCostItem[]> {
  const PAGE_SIZE = 15; // very small to avoid 413 on large jobs
  let allItems: JTCostItem[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 20; page++) {
    const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        documents: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            type: {},
            status: {},
            costItems: {
              $: { size: 100 },
              nodes: {
                id: {},
                name: {},
                cost: {},
                price: {},
                quantity: {},
                costType: { name: {} },
                costCode: { name: {}, number: {} },
                jobCostItem: { id: {}, costCode: { name: {}, number: {} } },
              },
            },
          },
        },
      },
    });

    const docsPage = (data as any)?.job?.documents;
    const docs = docsPage?.nodes || [];

    for (const doc of docs) {
      const docItems = doc.costItems?.nodes || [];
      for (const item of docItems) {
        allItems.push({
          ...item,
          document: { id: doc.id, name: '', type: doc.type, status: doc.status },
        });
      }
    }

    nextPage = docsPage?.nextPage || null;
    if (!nextPage || docs.length < PAGE_SIZE) break;
  }

  return allItems;
}

/**
 * Fetch cost items for a single document by its ID.
 * This is a lightweight query (one document at a time) that avoids 413 errors.
 */
export async function getDocumentCostItemsById(documentId: string): Promise<JTCostItem[]> {
  const data = await pave({
    document: {
      $: { id: documentId },
      costItems: {
        $: { size: 50 },
        nodes: {
          id: {},
          name: {},
          cost: {},
          price: {},
          quantity: {},
          costCode: { number: {}, name: {} },
          costType: { id: {}, name: {} },
          // Fetch the linked budget item's costCode so downstream filters can
          // key off the budget bucket (source of truth) rather than the
          // line-level costCode.
          jobCostItem: { id: {}, costCode: { number: {}, name: {} } },
        },
      },
    },
  });

  const items = (data as any)?.document?.costItems?.nodes || [];
  return items as JTCostItem[];
}

/**
 * Return the effective cost code number for a document cost item.
 *
 * Prefer the cost code of the linked budget item (jobCostItem.costCode.number)
 * because that's what drives budget-vs-actual reports — if the dashboard filters
 * by budget bucket, its numbers will always agree with the budget side.
 *
 * Fall back to the line-level costCode if there's no budget link (some hand-entered
 * rows aren't linked to a budget item) so we don't silently drop coded lines.
 */
export function getEffectiveCostCodeNumber(item: {
  costCode?: { number?: string | null } | null;
  jobCostItem?: { costCode?: { number?: string | null } | null } | null;
}): string | undefined {
  return (
    item.jobCostItem?.costCode?.number ??
    item.costCode?.number ??
    undefined
  );
}

/**
 * Lightweight document cost items query for the Specs agent.
 * Fetches cost items from a specific document with the same fields as getCostItemsLightForJob.
 * Used to pick up Change Order items that don't have a document reference on the budget-level cost item.
 */
export async function getDocumentCostItemsLightById(documentId: string): Promise<any[]> {
  const data = await pave({
    document: {
      $: { id: documentId },
      costItems: {
        $: { size: 50 },
        nodes: {
          id: {},
          name: {},
          description: {},
          isSelected: {},
          costCode: { id: {}, name: {}, number: {} },
          costGroup: {
            id: {}, name: {}, description: {},
            isSelected: {},
            files: { nodes: { id: {}, name: {}, url: {} } },
            parentCostGroup: {
              id: {}, name: {}, description: {},
              files: { nodes: { id: {}, name: {}, url: {} } },
            },
          },
          files: { nodes: { id: {}, name: {}, url: {} } },
          customFieldValues: { nodes: { value: {}, customField: { name: {} } } },
        },
      },
    },
  });

  const nodes = (data as any)?.document?.costItems?.nodes || [];
  return nodes.map((node: any) => {
    // Parse custom field values into named fields (Status, Internal Notes, Vendor)
    const cfvs = node.customFieldValues?.nodes || [];
    let status: string | null = null;
    let internalNotes: string | null = null;
    let vendor: string | null = null;
    for (const cfv of cfvs) {
      const fieldName = cfv.customField?.name;
      const val = cfv.value;
      if (!fieldName || !val) continue;
      if (fieldName === 'Status') status = val;
      else if (fieldName === 'Internal Notes') internalNotes = val;
      else if (fieldName === 'Vendor') vendor = val;
    }
    return {
      ...node,
      customFieldValues: undefined,
      status,
      internalNotes,
      vendor,
      files: node.files?.nodes || [],
      // Inject the document reference since we know which document these came from
      document: { id: documentId },
      // Preserve isSelected from document-level query (false = unselected option)
      isSelected: node.isSelected,
      costGroup: node.costGroup ? {
        ...node.costGroup,
        isSelected: node.costGroup.isSelected,
        files: node.costGroup.files?.nodes || [],
        parentCostGroup: node.costGroup.parentCostGroup ? {
          ...node.costGroup.parentCostGroup,
          files: node.costGroup.parentCostGroup.files?.nodes || [],
        } : null,
      } : null,
    };
  });
}

export async function getCostItemsForJob(jobId: string, limit = 500): Promise<JTCostItem[]> {
  // Paginate through all cost items (jobs can have 200+ items)
  // Page size 50 to avoid 413 errors when customFieldValues are included
  const PAGE_SIZE = 50;
  let allItems: any[] = [];
  let nextPage: string | null = null;
  const maxPages = Math.ceil(limit / PAGE_SIZE);

  for (let page = 0; page < maxPages; page++) {
    const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            quantity: {},
            unitCost: {},
            unitPrice: {},
            cost: {},
            price: {},
            isSpecification: {},
            costType: { id: {}, name: {} },
            costCode: { id: {}, name: {}, number: {} },
            costGroup: { id: {}, name: {}, description: {}, files: { nodes: { id: {}, name: {}, url: {} } }, parentCostGroup: { id: {}, name: {}, description: {}, files: { nodes: { id: {}, name: {}, url: {} } } } },
            files: { nodes: { id: {}, name: {}, url: {} } },
            document: { id: {}, name: {}, type: {} },
            customFieldValues: { nodes: { value: {}, customField: { name: {} } } },
          },
        },
      },
    });

    const costItemPage = (data as any)?.job?.costItems;
    const nodes = costItemPage?.nodes || [];
    // Flatten files.nodes and extract custom fields inline
    const mapped = nodes.map((node: any) => {
      // Parse custom field values into named fields
      const cfvs = node.customFieldValues?.nodes || [];
      let status: string | null = null;
      let internalNotes: string | null = null;
      let vendor: string | null = null;
      for (const cfv of cfvs) {
        const fieldName = cfv.customField?.name;
        const val = cfv.value;
        if (!fieldName || !val) continue;
        if (fieldName === 'Status') status = val;
        else if (fieldName === 'Internal Notes') internalNotes = val;
        else if (fieldName === 'Vendor') vendor = val;
      }
      return {
        ...node,
        files: node.files?.nodes || [],
        costGroup: node.costGroup ? {
          ...node.costGroup,
          files: node.costGroup.files?.nodes || [],
          parentCostGroup: node.costGroup.parentCostGroup ? {
            ...node.costGroup.parentCostGroup,
            files: node.costGroup.parentCostGroup.files?.nodes || [],
          } : null,
        } : null,
        customFieldValues: undefined, // Remove raw CFV data to reduce size
        status,
        internalNotes,
        vendor,
      };
    });
    allItems = allItems.concat(mapped);
    nextPage = costItemPage?.nextPage || null;
    if (!nextPage || nodes.length < PAGE_SIZE) break;
  }

  return allItems;
}


/**
 * Lightweight cost items query for the Specs agent.
 * Uses smaller page sizes and drops pricing/cost fields to avoid PAVE 413 errors.
 * Only fetches fields needed for specification answers: name, description, hierarchy, document, and item-level files.
 */
export async function getCostItemsLightForJob(jobId: string, limit = 200): Promise<any[]> {
  const PAGE_SIZE = 25;
  let allItems: any[] = [];
  let nextPage: string | null = null;
  const maxPages = Math.ceil(limit / PAGE_SIZE);

  for (let page = 0; page < maxPages; page++) {
    const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            costCode: { id: {}, name: {}, number: {} },
            costGroup: {
              id: {}, name: {}, description: {},
              files: { nodes: { id: {}, name: {}, url: {} } },
              parentCostGroup: {
                id: {}, name: {}, description: {},
                files: { nodes: { id: {}, name: {}, url: {} } },
              },
            },
            files: { nodes: { id: {}, name: {}, url: {} } },
            document: { id: {}, name: {}, type: {} },
            customFieldValues: { nodes: { value: {}, customField: { name: {} } } },
          },
        },
      },
    });

    const costItemPage = (data as any)?.job?.costItems;
    const nodes = costItemPage?.nodes || [];
    const mapped = nodes.map((node: any) => {
      // Parse custom field values into named fields (Status, Internal Notes, Vendor)
      const cfvs = node.customFieldValues?.nodes || [];
      let status: string | null = null;
      let internalNotes: string | null = null;
      let vendor: string | null = null;
      for (const cfv of cfvs) {
        const fieldName = cfv.customField?.name;
        const val = cfv.value;
        if (!fieldName || !val) continue;
        if (fieldName === 'Status') status = val;
        else if (fieldName === 'Internal Notes') internalNotes = val;
        else if (fieldName === 'Vendor') vendor = val;
      }
      return {
        ...node,
        customFieldValues: undefined,
        status,
        internalNotes,
        vendor,
        files: node.files?.nodes || [],
        costGroup: node.costGroup ? {
          ...node.costGroup,
          files: node.costGroup.files?.nodes || [],
          parentCostGroup: node.costGroup.parentCostGroup ? {
            ...node.costGroup.parentCostGroup,
            files: node.costGroup.parentCostGroup.files?.nodes || [],
          } : null,
        } : null,
      };
    });
    allItems = allItems.concat(mapped);
    nextPage = costItemPage?.nextPage || null;
    if (!nextPage || nodes.length < PAGE_SIZE) break;
  }

  return allItems;
}

// ============================================================
// COST GROUPS â Hierarchy & Updates (for Contract Spec Writer)
// ============================================================

export interface JTCostGroupItem {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
}

export interface JTCostGroup {
  id: string;
  name: string;
  description?: string;
  parentCostGroup?: { id: string; name: string } | null;
  costItems: JTCostGroupItem[];
}

/**
 * Fetch all cost groups for a job with their hierarchy and child cost items.
 * Used by the Contract Spec Writer to build the budget tree.
 *
 * Note: PAVE API does not support costItems nested under costGroups,
 * so we fetch groups and items separately, then merge by costGroup.id.
 */
export async function getCostGroupsForJob(jobId: string): Promise<JTCostGroup[]> {
  // 1. Fetch all cost groups (without cost items)
  let allGroups: JTCostGroup[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 10; page++) {
    const pageParams: Record<string, unknown> = { size: 100 };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        costGroups: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            parentCostGroup: { id: {}, name: {} },
          },
        },
      },
    });

    const groupPage = (data as any)?.job?.costGroups;
    const nodes = groupPage?.nodes || [];
    const mapped: JTCostGroup[] = nodes.map((node: any) => ({
      id: node.id,
      name: node.name,
      description: node.description || '',
      parentCostGroup: node.parentCostGroup || null,
      costItems: [],
    }));
    allGroups = allGroups.concat(mapped);
    nextPage = groupPage?.nextPage || null;
    if (!nextPage || nodes.length < 100) break;
  }

  // 2. Fetch all cost items at the job level and group by costGroup.id
  let allItems: any[] = [];
  nextPage = null;

  for (let page = 0; page < 20; page++) {
    const pageParams: Record<string, unknown> = { size: 100 };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            quantity: {},
            unitCost: {},
            unitPrice: {},
            costGroup: { id: {} },
          },
        },
      },
    });

    const itemPage = (data as any)?.job?.costItems;
    const nodes = itemPage?.nodes || [];
    allItems = allItems.concat(nodes);
    nextPage = itemPage?.nextPage || null;
    if (!nextPage || nodes.length < 100) break;
  }

  // 3. Merge: attach cost items to their parent cost groups
  const itemsByGroup = new Map<string, JTCostGroupItem[]>();
  for (const item of allItems) {
    const groupId = item.costGroup?.id;
    if (!groupId) continue;
    if (!itemsByGroup.has(groupId)) itemsByGroup.set(groupId, []);
    itemsByGroup.get(groupId)!.push({
      id: item.id,
      name: item.name,
      description: item.description || '',
      quantity: item.quantity || 0,
      unitCost: item.unitCost || 0,
      unitPrice: item.unitPrice || 0,
    });
  }

  for (const group of allGroups) {
    group.costItems = itemsByGroup.get(group.id) || [];
  }

  return allGroups;
}

/**
 * Fetch cost group ordering for a job.
 * Returns groups in the order they appear in JobTread, with their parent hierarchy.
 * Used by the budget route to sort sections and groups correctly.
 */
export async function getCostGroupOrder(jobId: string): Promise<Array<{
  id: string;
  name: string;
  sortOrder: number | null;
  parentId: string | null;
  parentName: string | null;
  parentSortOrder: number | null;
}>> {
  let allGroups: any[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 10; page++) {
    const pageParams: Record<string, unknown> = { size: 100 };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        costGroups: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            parentCostGroup: { id: {}, name: {} },
          },
        },
      },
    });

    const groupPage = (data as any)?.job?.costGroups;
    const nodes = groupPage?.nodes || [];
    allGroups = allGroups.concat(nodes);
    nextPage = groupPage?.nextPage || null;
    if (!nextPage || nodes.length < 100) break;
  }

  // The PAVE API returns cost groups in their display order.
  // We use the array index as the sort order since there's no sortOrder field.
  return allGroups.map((g: any, index: number) => ({
    id: g.id,
    name: g.name,
    sortOrder: index,
    parentId: g.parentCostGroup?.id || null,
    parentName: g.parentCostGroup?.name || null,
    parentSortOrder: null as number | null,
  }));
}

/**
 * Update a cost group's description field (used to write contract specs).
 */
export async function updateCostGroup(groupId: string, fields: {
  description?: string;
  name?: string;
}) {
  const params: any = { id: groupId };
  if (fields.description !== undefined) params.description = fields.description;
  if (fields.name !== undefined) params.name = fields.name;
  await pave({
    updateCostGroup: { $: params },
  });
  return { success: true, groupId, updatedFields: Object.keys(fields) };
}

export async function getSpecificationsForJob(jobId: string): Promise<{
  description: string;
  footer: string;
  items: JTCostItem[];
  groupedItems: Record<string, JTCostItem[]>;
  documents: { id: string; name: string; type: string; status: string }[];
}> {
  // Get job-level spec description + footer
  const jobData = await pave({
    job: {
      $: { id: jobId },
      specificationsDescription: {},
      specificationsFooter: {},
    },
  });
  const job = (jobData as any)?.job;

  // Get ALL cost items with pagination (large jobs can have 500+)
  // The JobTread Specifications view shows ALL cost items grouped by cost group,
  // NOT just items with isSpecification=true (that flag is often unset).
  const allCostItems = await getCostItemsForJob(jobId, 500);

  // Group items by cost group name (matching the Specifications page layout)
  const groupedItems: Record<string, JTCostItem[]> = {};
  for (const item of allCostItems) {
    const groupName = item.costGroup?.name || 'Ungrouped';
    if (!groupedItems[groupName]) groupedItems[groupName] = [];
    groupedItems[groupName].push(item);
  }

  // Also fetch documents for this job (shown in Project Details section of specs page)
  let documents: { id: string; name: string; type: string; status: string }[] = [];
  try {
    const docData = await pave({
      job: {
        $: { id: jobId },
        documents: {
          $: { size: 50 },
          nodes: {
            id: {},
            name: {},
            type: {},
            status: {},
          },
        },
      },
    });
    documents = (docData as any)?.job?.documents?.nodes || [];
  } catch (_err) {
    // Documents fetch is non-critical
  }

  return {
    description: job?.specificationsDescription || '',
    footer: job?.specificationsFooter || '',
    items: allCostItems,
    groupedItems,
    documents,
  };
}

// ============================================================
// EVENTS / CALENDAR
// ============================================================

export interface JTEvent {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  notes: string;
  type: string;
}

export async function getEventsForJob(jobId: string, limit = 50): Promise<JTEvent[]> {
  const eventFields = {
    nodes: {
      id: {},
      name: {},
      startDate: {},
      endDate: {},
      startTime: {},
      endTime: {},
      notes: {},
      type: {},
    },
  };

  // Strategy 1: Try job.events sub-collection
  try {
    const data = await pave({
      job: {
        $: { id: jobId },
        events: {
          $: { size: limit },
          ...eventFields,
        },
      },
    });
    const events = (data as any)?.job?.events?.nodes;
    if (events && Array.isArray(events)) return events;
  } catch (_err: any) {
    // Sub-collection not supported â fall through
  }

  // Strategy 2: Organization-level with where filter
  try {
    const data = await pave({
      organization: {
        $: { id: JT_ORG() },
        events: {
          $: { size: limit, where: ['jobId', '=', jobId] },
          ...eventFields,
        },
      },
    });
    return (data as any)?.organization?.events?.nodes || [];
  } catch (_err2: any) {
    console.warn('[getEventsForJob] All query strategies failed for job:', jobId);
    return [];
  }
}

// ============================================================
// EXPANDED TASK UPDATE â More fields from PAVE API
// ============================================================

export async function updateTaskFull(taskId: string, fields: {
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  progress?: number;
  assignedMembershipIds?: string[];
  parentTaskId?: string;
  taskTypeId?: string;
}) {
  const params: any = { id: taskId };
  if (fields.name !== undefined) params.name = fields.name;
  if (fields.description !== undefined) params.description = fields.description;

  // Duration preservation: when startDate changes but endDate is NOT explicitly set,
  // look up the current task dates and shift endDate to keep the same duration.
  if (fields.startDate !== undefined && fields.endDate === undefined) {
    try {
      const current = await getTaskById(taskId);
      if (current.startDate && current.endDate) {
        const duration = dateDiffDays(current.startDate, current.endDate);
        params.startDate = fields.startDate;
        params.endDate = addDays(fields.startDate, duration);
      } else {
        params.startDate = fields.startDate;
        params.endDate = fields.startDate;
      }
    } catch {
      params.startDate = fields.startDate;
      params.endDate = fields.startDate;
    }
  } else {
    if (fields.startDate !== undefined) params.startDate = fields.startDate;
    if (fields.endDate !== undefined) params.endDate = fields.endDate;
  }

  if (fields.startTime !== undefined) params.startTime = fields.startTime;
  if (fields.endTime !== undefined) params.endTime = fields.endTime;
  if (fields.progress !== undefined) params.progress = Math.min(1, Math.max(0, fields.progress));
  if (fields.assignedMembershipIds !== undefined) params.assignedMembershipIds = fields.assignedMembershipIds;
  if (fields.parentTaskId !== undefined) params.parentTaskId = fields.parentTaskId;
  if (fields.taskTypeId !== undefined) params.taskTypeId = fields.taskTypeId;
  await pave({
    updateTask: { $: params },
  });
  return { success: true, taskId, updatedFields: Object.keys(fields) };
}

// ============================================================
// GRID VIEW â Pre-construction dashboard data
// Returns per-phase task counts for each active job
// ============================================================

export async function getGridScheduleData(): Promise<GridJobData[]> {
  const jobs = await getActiveJobs(50);

  // Fetch tasks PER JOB in batches (avoids 100-task org-wide limit)
  // Old approach fetched only 100 tasks across ALL jobs â most projects got zero
  const BATCH_SIZE = 10;
  const jobTaskMap = new Map<string, any[]>();

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (job) => {
        const data = await pave({
          job: {
            $: { id: job.id },
            tasks: {
              $: { size: 100 },
              nodes: {
                id: {}, name: {}, isGroup: {}, progress: {},
                startDate: {}, endDate: {},
                parentTask: { id: {} },
              },
            },
          },
        });
        return {
          jobId: job.id,
          tasks: ((data as any)?.job?.tasks?.nodes || []) as any[],
        };
      })
    );
    for (const r of results) {
      jobTaskMap.set(r.jobId, r.tasks);
    }
  }

  const today = new Date().toISOString().split('T')[0];

  return jobs.map((job) => {
    const jobTasks = jobTaskMap.get(job.id) || [];
    const groups = jobTasks.filter((t: any) => t.isGroup && !t.parentTask);
    const tasks = jobTasks.filter((t: any) => !t.isGroup);

    // Build map: groupId -> child tasks
    const groupChildren = new Map<string, any[]>();
    for (const g of groups) groupChildren.set(g.id, []);
    for (const t of tasks) {
      if (t.parentTask?.id && groupChildren.has(t.parentTask.id)) {
        groupChildren.get(t.parentTask.id)!.push(t);
      }
    }
    // Build phase data array
    const phases: GridPhaseData[] = groups.map((g: any) => {
      const children = groupChildren.get(g.id) || [];
      return {
        phaseGroupId: g.id,
        phaseName: g.name,
        completed: children.filter((t: any) => t.progress >= 1).length,
        total: children.length,
        inProgress: children.filter((t: any) => t.progress > 0 && t.progress < 1).length,
        hasOverdue: children.some(
          (t: any) => t.endDate && t.endDate < today && t.progress < 1
        ),
      };
    });

    const totalTasks = tasks.length;
    const totalCompleted = tasks.filter((t: any) => t.progress >= 1).length;

    // Next due date = earliest endDate among incomplete tasks
    const incompleteDated = tasks.filter(
      (t: any) => t.progress < 1 && t.endDate
    );
    const nextDueDate = incompleteDated.length
      ? incompleteDated.map((t: any) => t.endDate as string).sort()[0]
      : null;
    // Stall detection: if no future incomplete tasks, how many days since last activity?
    let stalledDays: number | null = null;
    if (!nextDueDate && totalTasks > 0) {
      const completedDated = tasks.filter(
        (t: any) => t.progress >= 1 && t.endDate
      );
      if (completedDated.length) {
        const lastEnd = completedDated
          .map((t: any) => t.endDate as string)
          .sort()
          .pop()!;
        stalledDays = Math.floor(
          (Date.now() - new Date(lastEnd).getTime()) / 86400000
        );
      } else {
        stalledDays = 999; // No dated tasks at all
      }
    }

    return {
      id: job.id,
      name: job.name,
      number: job.number,
      clientName: job.clientName || '',
      locationName: job.locationName || '',
      customStatus: job.customStatus || null,
      statusCategory: job.statusCategory || null,
      phases,
      hasSchedule: jobTasks.length > 0,
      totalCompleted,
      totalTasks,
      nextDueDate,
      stalledDays,
    };
  });
}

// ============================================================
// DATABASE-ONLY READ FUNCTIONS (messages & daily logs)
//
// These read ONLY from the Supabase database â never from the
// live JT API. This prevents duplication. The database is kept
// current by the daily sync cron + on-demand force-sync.
//
// For all other data types (tasks, cost items, time entries, etc.)
// agents continue to use the live API functions above.
// ============================================================

import { readCache, writeCache } from './cache';

/**
 * Get comments/messages for a job from the database.
 * Returns ALL comments (no pagination cap). Falls back to live API
 * only if the database has zero rows (first run before sync).
 */
export async function getCommentsFromDB(
  jobId: string,
  limit = 2000
): Promise<JTComment[]> {
  try {
    const cached = await readCache<any>(
      'jt_comments',
      { job_id: jobId },
      { orderBy: 'created_at', ascending: false, limit }
    );

    if (cached.length > 0) {
      return cached.map((row) => row.raw_data || row);
    }

    // Database empty for this job â fall back to live API as one-time bootstrap
    console.warn(`[db] No cached comments for job ${jobId}, falling back to live API`);
    return getCommentsForTarget(jobId, 'job', limit);
  } catch (err) {
    console.warn('[db] getCommentsFromDB error, falling back to live:', err);
    return getCommentsForTarget(jobId, 'job', limit);
  }
}

/**
 * Get daily logs for a job from the database.
 * Same DB-first pattern with live API fallback for bootstrap.
 */
export async function getDailyLogsFromDB(jobId: string, limit = 2000): Promise<JTDailyLog[]> {
  try {
    const cached = await readCache<any>(
      'jt_daily_logs',
      { job_id: jobId },
      { orderBy: 'date', ascending: false, limit }
    );

    if (cached.length > 0) {
      return cached.map((row) => row.raw_data || row);
    }

    console.warn(`[db] No cached daily logs for job ${jobId}, falling back to live API`);
    return getDailyLogsForJob(jobId, limit);
  } catch (err) {
    console.warn('[db] getDailyLogsFromDB error, falling back to live:', err);
    return getDailyLogsForJob(jobId, limit);
  }
}

// ============================================================
// WRITE-THROUGH HELPERS (messages & daily logs only)
// Write to JT API first, then immediately upsert into the database.
// ============================================================

/**
 * Create a comment and write-through to database.
 */
export async function createCommentWithCache(params: Parameters<typeof createComment>[0]) {
  const result = await createComment(params);

  if (result?.id) {
    writeCache('jt_comments', [{
      id: result.id,
      job_id: params.targetType === 'job' ? params.targetId : null,
      target_id: params.targetId,
      target_type: params.targetType,
      message: params.message,
      name: params.name || 'BKB AI',
      raw_data: result,
    }]).catch(() => {});
  }

  return result;
}

/**
 * Create a daily log and write-through to database.
 */
export async function createDailyLogWithCache(params: Parameters<typeof createDailyLog>[0]) {
  const result = await createDailyLog(params);

  if (result?.id) {
    writeCache('jt_daily_logs', [{
      id: result.id,
      job_id: params.jobId,
      date: params.date,
      notes: params.notes || '',
      raw_data: result,
    }]).catch(() => {});
  }

  return result;
}

// ============================================================
// DOCUMENT CREATION â PAVE mutations for creating invoices
// ============================================================

/**
 * Create a document shell (invoice, estimate, PO, etc.) on a job.
 * Returns the created document ID and metadata.
 */
async function createJTDocument(params: {
  jobId: string;
  type: 'customerInvoice' | 'customerOrder' | 'vendorOrder' | 'vendorBill' | 'bidRequest';
  // For customerInvoice: typically "Invoice" / "Deposit" / "Progress Invoice".
  // For customerOrder: must match a document template name configured in JT
  // (e.g., "Change Order", "Change Order (Cost-Plus)"). Template sets vary
  // per job; see fallbackNamePattern.
  name: string;
  // JT template ID. Optional — when provided, associates the doc with that
  // template. Will be dropped on retry if the primary `name` is rejected
  // and we fall back to another allowed name (the fallback name may belong
  // to a different template).
  documentTemplateId?: string;
  // If the primary `name` is rejected by PAVE with a "Name must be one of ..."
  // error, we parse the allowed names out of the error and retry with the
  // first one matching this pattern. Lets callers on different job template
  // sets auto-resolve (e.g., "Change Order" vs "Change Order (Cost-Plus)").
  fallbackNamePattern?: RegExp;
  fromName: string;
  toName: string;
  toAddress?: string;
  taxRate: string;
  jobLocationName: string;
  jobLocationAddress: string;
  dueDays?: number;
  subject?: string;
  description?: string;
  footer?: string;
}) {
  const {
    jobId, type, name, documentTemplateId, fallbackNamePattern,
    fromName, toName, toAddress, taxRate,
    jobLocationName, jobLocationAddress, dueDays,
    subject, description, footer,
  } = params;

  const buildArgs = (nm: string, tplId?: string) => ({
    jobId,
    type,
    name: nm,
    fromName,
    toName,
    taxRate,
    jobLocationName,
    jobLocationAddress,
    ...(toAddress ? { toAddress } : {}),
    ...(dueDays !== undefined ? { dueDays } : {}),
    ...(subject ? { subject } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(footer !== undefined ? { footer } : {}),
    ...(tplId ? { documentTemplateId: tplId } : {}),
  });

  const runCreate = async (nm: string, tplId?: string) => {
    return pave({
      createDocument: {
        $: buildArgs(nm, tplId),
        createdDocument: {
          id: {},
          name: {},
          number: {},
          status: {},
          type: {},
        },
      },
    });
  };

  let data: any;
  try {
    data = await runCreate(name, documentTemplateId);
  } catch (err: any) {
    // Parse PAVE's "Name must be one of X, Y, Z" error and retry with the
    // first allowed name that matches `fallbackNamePattern`. Different job
    // template sets (e.g., Design-Build vs standard) expose different sets
    // of customerOrder names — we can't hardcode.
    const msg = String(err?.message || '');
    const match = msg.match(/Name must be one of\s+([^$]+?)(?:\s*$)/i);
    if (fallbackNamePattern && match) {
      // Split by comma; strip whitespace. Names themselves may contain
      // parens/underscores (e.g., "Pricing Review _ Selections") but not
      // unescaped commas in BKB's current template set.
      const allowed = match[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // Dedupe while preserving order (PAVE sometimes repeats names).
      const seen = new Set<string>();
      const unique = allowed.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
      const candidate = unique.find((n) => fallbackNamePattern.test(n));
      if (candidate) {
        console.log(
          `[createJTDocument] Primary name '${name}' rejected for job ${jobId}; ` +
          `falling back to '${candidate}' (from allowed: ${unique.join(' | ')})`
        );
        // Drop templateId: it was tied to the primary name's template and
        // likely doesn't match the fallback template.
        data = await runCreate(candidate, undefined);
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  const doc = (data as any)?.createDocument?.createdDocument;
  if (!doc?.id) throw new Error('Document creation failed: ' + JSON.stringify(data));
  return doc as { id: string; name: string; number: string; status: string; type: string };
}

/**
 * Create a cost group on a document (or nested under a parent cost group).
 */
async function createJTCostGroup(params: {
  documentId?: string;
  parentCostGroupId?: string;
  name: string;
  description?: string;
}) {
  const { documentId, parentCostGroupId, name, description } = params;
  if (!documentId && !parentCostGroupId) {
    throw new Error('createJTCostGroup requires documentId or parentCostGroupId');
  }
  const data = await pave({
    createCostGroup: {
      $: {
        ...(documentId ? { documentId } : {}),
        ...(parentCostGroupId ? { parentCostGroupId } : {}),
        name,
        ...(description ? { description } : {}),
      },
      createdCostGroup: {
        id: {},
        name: {},
      },
    },
  });
  const group = (data as any)?.createCostGroup?.createdCostGroup;
  if (!group?.id) throw new Error('Cost group creation failed: ' + JSON.stringify(data));
  return group as { id: string; name: string };
}

/**
 * Create a cost item inside a cost group on a document.
 */
async function createJTCostItem(params: {
  costGroupId: string;
  name: string;
  description?: string;
  costCodeId?: string;
  costTypeId?: string;
  unitId?: string;
  quantity?: number;
  unitCost?: number;
  unitPrice?: number;
  isTaxable?: boolean;
  jobCostItemId?: string;  // Required for customer invoices â links to original budget item
}) {
  const { costGroupId, name, description, costCodeId, costTypeId, unitId, quantity, unitCost, unitPrice, isTaxable, jobCostItemId } = params;
  const data = await pave({
    createCostItem: {
      $: {
        costGroupId,
        name,
        ...(description ? { description } : {}),
        ...(costCodeId ? { costCodeId } : {}),
        ...(costTypeId ? { costTypeId } : {}),
        ...(unitId ? { unitId } : {}),
        ...(quantity !== undefined ? { quantity } : {}),
        ...(unitCost !== undefined ? { unitCost } : {}),
        ...(unitPrice !== undefined ? { unitPrice } : {}),
        ...(isTaxable !== undefined ? { isTaxable } : {}),
        ...(jobCostItemId ? { jobCostItemId } : {}),
      },
      createdCostItem: {
        id: {},
        name: {},
      },
    },
  });
  const item = (data as any)?.createCostItem?.createdCostItem;
  if (!item?.id) throw new Error('Cost item creation failed: ' + JSON.stringify(data));
  return item as { id: string; name: string };
}

// ============================================================
// COST-PLUS DRAFT INVOICE CREATION
// ============================================================

/**
 * Creates a draft customer invoice for a cost-plus job by:
 * 1. Fetching job details + customer info
 * 2. Querying all unbilled budget items (document === null)
 * 3. Creating a document shell (customerInvoice, draft)
 * 4. Grouping unbilled items by cost type category
 * 5. Creating cost groups and items on the document
 *
 * Returns the created document info or throws on failure.
 */

// Helper: validate AI-rewritten description is actual content, not meta-commentary
function isValidAiDescription(text: string): boolean {
  if (!text || text.length < 3) return false;
  const lower = text.toLowerCase();
  const badPatterns = [
    "i'm ready", "i am ready", "i'd be happy", "i can help",
    "i don't see", "i don't have", "no description", "no content",
    "no text", "nothing to rewrite", "please provide", "could you",
    "unfortunately", "it seems", "it appears", "there is no",
    "there are no", "i need", "i cannot", "i can't", "however,",
    "note:", "sorry", "here is", "here's the rewrite",
  ];
  return !badPatterns.some(p => lower.startsWith(p) || lower.includes(p));
}

// Helper: clean markdown formatting artifacts from AI descriptions
// Strips # headers, ** bold **, __ underline __, and leading/trailing whitespace per line
function sanitizeAiDescription(text: string): string {
  return text
    .split('\n')
    .map(line => line
      .replace(/^#{1,6}\s+/, '')       // strip markdown headers (# ## ### etc.)
      .replace(/\*\*(.*?)\*\*/g, '*$1*') // convert double bold **text** to single *text*
      .replace(/__(.*?)__/g, '$1')       // strip underline __text__
      .trim()
    )
    .join('\n')
    .trim();
}

export async function createDraftCostPlusInvoice(jobId: string): Promise<{
  documentId: string;
  documentName: string;
  documentNumber: string;
  itemCount: number;
  totalCost: number;
  totalPrice: number;
}> {
  // ============================================================
  // COST-PLUS INVOICE CREATION â From Vendor Bills + Time Entries
  //
  // This mirrors JT's "Bills and Time" flow: pull uninvoiced vendor
  // bills and time entries onto a customer invoice.
  //
  // The old approach pulled from budget items, which was wrong â
  // Cost-Plus billing in JT is based on actual vendor bills and
  // time entries, not budget estimates.
  //
  // Algorithm:
  // 1. Fetch all vendor bills and their cost items
  // 2. Fetch all non-draft customer invoices and their cost items
  // 3. Use per-budget-item FIFO deduction to find uninvoiced bills
  // 4. Use per-budget-item hour deduction to find uninvoiced time
  // 5. Create invoice with uninvoiced bills + time entries
  // ============================================================

  // 1. Get job details including custom fields (Margin, Hourly Rate)
  const jobData = await pave({
    job: {
      $: { id: jobId },
      id: {}, name: {}, number: {},
      location: {
        id: {}, name: {}, address: {},
        account: { id: {}, name: {} },
      },
      customFieldValues: {
        nodes: { value: {}, customField: { id: {}, name: {} } },
      },
    },
  });
  const job = (jobData as any)?.job;
  if (!job) throw new Error('Job not found: ' + jobId);

  // Read Margin (%) and Hourly Rate ($) from job custom fields — REQUIRED
  const customFields = job.customFieldValues?.nodes || [];
  const marginField = customFields.find((cf: any) => cf.customField?.name === 'Margin');
  const hourlyRateField = customFields.find((cf: any) => cf.customField?.name === 'Hourly Rate');

  if (!marginField || !marginField.value) {
    throw new Error('MISSING_CUSTOM_FIELD: The "Margin" custom field is not set on this job in JobTread. Please add a Margin value (e.g. 25 for 25%) before generating an invoice.');
  }
  if (!hourlyRateField || !hourlyRateField.value) {
    throw new Error('MISSING_CUSTOM_FIELD: The "Hourly Rate" custom field is not set on this job in JobTread. Please add an Hourly Rate value (e.g. 115) before generating an invoice.');
  }

  const marginPercent = parseFloat(marginField.value);
  const hourlyRate = parseFloat(hourlyRateField.value);

  if (isNaN(marginPercent) || marginPercent <= 0 || marginPercent >= 100) {
    throw new Error('MISSING_CUSTOM_FIELD: The "Margin" custom field has an invalid value. It must be a number between 1 and 99 (e.g. 25 for 25%).');
  }
  if (isNaN(hourlyRate) || hourlyRate <= 0) {
    throw new Error('MISSING_CUSTOM_FIELD: The "Hourly Rate" custom field has an invalid value. It must be a positive number (e.g. 115).');
  }

  // Margin = profit as % of selling price (not markup on cost)
  // e.g. 25% margin -> price = cost / (1 - 0.25) = cost x 1.3333
  const marginMultiplier = 1 / (1 - marginPercent / 100);

  const customerName = job.location?.account?.name || 'Client';
  const locationName = job.location?.name || '';
  const locationAddress = job.location?.address || locationName;

  // 2. Fetch all documents for the job
  const docsData = await pave({
    job: {
      $: { id: jobId },
      documents: {
        $: { size: 100 },
        nodes: {
          id: {}, name: {}, type: {}, status: {}, number: {},
          createdAt: {},
          account: { name: {} },
        },
      },
    },
  });
  const allDocs = (docsData as any)?.job?.documents?.nodes || [];
  const vendorBills = allDocs.filter((d: any) => d.type === 'vendorBill' && d.status !== 'denied');
  const nonDraftInvoices = allDocs.filter((d: any) => d.type === 'customerInvoice' && d.status !== 'draft');

  // 3. Collect vendor bill cost items grouped by jobCostItemId (budget item)
  type BillCostEntry = {
    billDocId: string; billName: string; billNumber: string;
    costItemId: string; costItemName: string;
    cost: number; unitCost: number; quantity: number;
    costCodeId?: string; costTypeId?: string;
    jobCostItemId?: string;
    date: string;
  };
  const billsByBudgetItem = new Map<string, BillCostEntry[]>();
  const allBillEntries: BillCostEntry[] = [];

  for (const bill of vendorBills) {
    const billItems = await getDocumentCostItemsById(bill.id);
    for (const item of billItems) {
      const budgetId = (item as any).jobCostItem?.id || item.id;
      const entry: BillCostEntry = {
        billDocId: bill.id,
        billName: bill.account?.name || bill.name || 'Vendor Bill',
        billNumber: bill.number || '',
        costItemId: item.id,
        costItemName: item.name || '',
        cost: item.cost || 0,
        unitCost: (item as any).unitCost || item.cost || 0,
        quantity: item.quantity || 1,
        costCodeId: item.costCode?.id,
        costTypeId: item.costType?.id,
        jobCostItemId: (item as any).jobCostItem?.id,
        date: bill.createdAt || '',
      };
      if (!billsByBudgetItem.has(budgetId)) billsByBudgetItem.set(budgetId, []);
      billsByBudgetItem.get(budgetId)!.push(entry);
      allBillEntries.push(entry);
    }
  }

  // 4. Collect invoiced amounts per budget item from non-draft customer invoices
  const invoicedByBudgetItem = new Map<string, number>();
  const invoicedHoursByBudgetItem = new Map<string, number>();

  for (const inv of nonDraftInvoices) {
    const invItems = await getDocumentCostItemsById(inv.id);
    for (const item of invItems) {
      const budgetId = (item as any).jobCostItem?.id || item.id;
      invoicedByBudgetItem.set(budgetId, (invoicedByBudgetItem.get(budgetId) || 0) + (item.cost || 0));
      invoicedHoursByBudgetItem.set(budgetId, (invoicedHoursByBudgetItem.get(budgetId) || 0) + (item.quantity || 0));
    }
  }

  // 5. FIFO deduction to find uninvoiced bills
  const uninvoicedBills: BillCostEntry[] = [];
  billsByBudgetItem.forEach((bills, budgetId) => {
    bills.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let remaining = invoicedByBudgetItem.get(budgetId) || 0;
    for (const bill of bills) {
      if (remaining >= bill.cost) {
        remaining -= bill.cost;
      } else {
        uninvoicedBills.push(bill);
        remaining = 0;
      }
    }
  });

  // 6. Fetch time entries and find uninvoiced ones
  const teData = await pave({
    job: {
      $: { id: jobId },
      timeEntries: {
        $: { size: 100 },
        nodes: {
          id: {}, startedAt: {}, endedAt: {}, type: {}, cost: {}, notes: {},
          user: { id: {}, name: {} },
          costItem: { id: {}, name: {}, costCode: { number: {}, name: {} } },
        },
      },
    },
  });
  const timeEntries = (teData as any)?.job?.timeEntries?.nodes || [];

  // Group time entries by budget cost item
  type TEInfo = { id: string; user: string; hours: number; cost: number; date: string; costItemId: string; costItemName: string; notes: string };
  const timeByBudgetItem = new Map<string, TEInfo[]>();
  for (const te of timeEntries) {
    if (!te.startedAt || !te.endedAt) continue;
    const hours = (new Date(te.endedAt).getTime() - new Date(te.startedAt).getTime()) / 3600000;
    const budgetId = te.costItem?.id || 'unknown';
    if (!timeByBudgetItem.has(budgetId)) timeByBudgetItem.set(budgetId, []);
    timeByBudgetItem.get(budgetId)!.push({
      id: te.id,
      user: te.user?.name || 'Unknown',
      hours,
      cost: te.cost || 0,
      date: te.startedAt,
      costItemId: te.costItem?.id || '',
      costItemName: te.costItem?.name || '',
      notes: te.notes || '',
    });
  }

  // FIFO hour deduction for time entries
  const uninvoicedTime: TEInfo[] = [];
  timeByBudgetItem.forEach((entries, budgetId) => {
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const totalBillCost = (billsByBudgetItem.get(budgetId) || []).reduce((s, b) => s + b.cost, 0);
    const invoicedHrs = invoicedHoursByBudgetItem.get(budgetId) || 0;
    // If this budget item has vendor bills, invoice hours might cover bills not time
    let remainingHoursCredit = totalBillCost > 0 ? 0 : invoicedHrs;

    for (const entry of entries) {
      if (remainingHoursCredit >= entry.hours) {
        remainingHoursCredit -= entry.hours;
      } else {
        uninvoicedTime.push(entry);
        remainingHoursCredit = 0;
      }
    }
  });

  if (uninvoicedBills.length === 0 && uninvoicedTime.length === 0) {
    throw new Error('No uninvoiced vendor bills or time entries found for this job.');
  }

  // 7. Create the document shell with sequential invoice number
  const existingInvoices = allDocs.filter((d: any) => d.type === 'customerInvoice');
  const invoiceSeq = existingInvoices.length + 1;

  const doc = await createJTDocument({
    jobId,
    type: 'customerInvoice',
    name: 'Invoice',
    fromName: 'Terri (Brett King Builder-Contractor Inc.)',
    toName: customerName,
    toAddress: locationAddress,
    taxRate: '0',
    jobLocationName: locationName,
    jobLocationAddress: locationAddress,
    dueDays: 2,
    subject: `Cost Plus Invoice #${invoiceSeq} - ${job.name}`,
    description: `This invoice reflects charges under a Cost Plus Fee agreement. You are billed for all actual project costs, including materials, subcontractors, labor, insurance, and permits, plus a ${marginPercent}% contractor's fee applied to those costs. Labor is billed at $${hourlyRate}/hr.`,
  });

  // 8. Create cost items from uninvoiced bills (grouped by vendor)
  let totalCost = 0;
  let totalPrice = 0;
  let createdItemCount = 0;

  if (uninvoicedBills.length > 0) {
    const billsGroup = await createJTCostGroup({
      documentId: doc.id,
      name: 'Vendor Bills',
    });

    // Sub-group by vendor (bill account name)
    const byVendor: Record<string, BillCostEntry[]> = {};
    for (const bill of uninvoicedBills) {
      const key = bill.billName;
      if (!byVendor[key]) byVendor[key] = [];
      byVendor[key].push(bill);
    }

    for (const [vendorName, items] of Object.entries(byVendor)) {
      const vendorGroup = await createJTCostGroup({
        parentCostGroupId: billsGroup.id,
        name: vendorName,
      });

      // AI-rewrite vendor group description from original bill cost item descriptions
      const billDocIds = Array.from(new Set(items.map(i => i.billDocId)));
      const allBillDescs: string[] = [];
      for (const billDocId of billDocIds) {
        try {
          const billItemsData = await pave({
            document: {
              $: { id: billDocId },
              costItems: { $: { size: 10 }, nodes: { id: {}, description: {} } },
            },
          });
          const descs = ((billItemsData as any)?.document?.costItems?.nodes || [])
            .map((i: any) => (i.description || '').trim())
            .filter((d: string) => d.length > 0);
          allBillDescs.push(...descs);
        } catch (_e) { /* skip */ }
      }
      if (allBillDescs.length > 0) {
        try {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (apiKey) {
            const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 256,
                messages: [{
                  role: 'user',
                  content: `Rewrite this vendor bill description into a brief, professional, client-facing summary for a renovation invoice. Keep it to 1-2 concise sentences. Do not include pricing. Do not use markdown headers (#) or bold (**) formatting. Just describe the work or materials provided in plain text. Do not mention tools, consumables, or crew supplies (gloves, batteries, cords, blades, tape, rags, trash bags, etc.) — only mention materials that become part of the finished project.\n\nOriginal:\n${allBillDescs.join('\n')}`,
                }],
              }),
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const rewritten = sanitizeAiDescription((aiData.content?.[0]?.text || '').trim());
              if (isValidAiDescription(rewritten)) {
                await updateJTCostGroup(vendorGroup.id, { description: rewritten });
              }
            }
          }
        } catch (_e) { /* skip AI errors */ }
      }

      for (const item of items) {
        await createJTCostItem({
          costGroupId: vendorGroup.id,
          name: item.costItemName || `Bill #${item.billNumber}`,
          description: `Bill ${item.billNumber} - ${vendorName}`,
          costCodeId: item.costCodeId,
          costTypeId: item.costTypeId,
          jobCostItemId: item.jobCostItemId,
          quantity: item.quantity || 1,
          unitCost: item.unitCost || item.cost,
          unitPrice: (item.unitCost || item.cost) * marginMultiplier,
        });
        totalCost += item.cost;
        totalPrice += item.cost * marginMultiplier;
        createdItemCount++;
      }
    }
  }

  // 9. Create cost items from uninvoiced time entries (grouped by worker)
  if (uninvoicedTime.length > 0) {
    const laborGroup = await createJTCostGroup({
      documentId: doc.id,
      name: 'BKB Labor',
    });

    // Build labor date range header so clients know what dates are being billed
    const laborDates = uninvoicedTime.map(te => new Date(te.date)).sort((a, b) => a.getTime() - b.getTime());
    const firstDate = laborDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const lastDate = laborDates[laborDates.length - 1].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const dateHeader = firstDate === lastDate ? `Labor dates: ${firstDate}` : `Labor dates: ${firstDate} \u2013 ${lastDate}`;

    // AI-rewrite labor group description from time entry notes
    const laborNotes: string[] = [];
    for (const te of uninvoicedTime) {
      const note = (te.notes || '').trim();
      if (note && !laborNotes.some((n: string) => n.toLowerCase() === note.toLowerCase())) {
        laborNotes.push(note.charAt(0).toUpperCase() + note.slice(1).replace(/\.\s*$/, ''));
      }
    }
    let laborDescFinal = dateHeader; // default to just the date header
    if (laborNotes.length > 0) {
      let laborDesc = laborNotes.map((n: string) => `• ${n}`).join('\n');
      try {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
          const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 256,
              messages: [{
                role: 'user',
                content: `Rewrite these labor notes into a bullet-point list for a renovation invoice. Each bullet should be a brief, professional, client-facing description. Output ONLY the bullet points (using • character), nothing else. No intro text, no questions, no explanations. Do not use markdown headers (#). For emphasis use single *asterisks* not double **asterisks**.\n\nNotes:\n${laborDesc}`,
              }],
            }),
          });
          if (aiRes.ok) {
            const aiData = await aiRes.json();
            const rewritten = sanitizeAiDescription((aiData.content?.[0]?.text || '').trim());
            if (isValidAiDescription(rewritten)) laborDesc = rewritten;
          }
        }
      } catch (_e) { /* skip AI errors */ }
      // Prepend date range header to the labor description
      laborDescFinal = `${dateHeader}\n\n${laborDesc}`;
    }

    // Create individual line items for each time entry (hidden behind showChildren: false)
    // This preserves a detailed record of every labor item on the invoice for future reference
    const billRate = hourlyRate;
    for (const te of uninvoicedTime) {
      const teDate = new Date(te.date);
      const dateStr = teDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const note = (te.notes || '').trim();
      const itemDescription = note ? `${dateStr} \u2013 ${note}` : dateStr;

      await createJTCostItem({
        costGroupId: laborGroup.id,
        name: `${te.user} \u2013 ${dateStr}`,
        description: itemDescription,
        jobCostItemId: te.costItemId || undefined,
        quantity: Math.round(te.hours * 100) / 100,
        unitCost: billRate,
        unitPrice: billRate,
      });
      totalCost += te.hours * billRate;
      totalPrice += te.hours * billRate;
      createdItemCount++;
    }

    // Set total hours, hide children, and set description (all in one call to avoid overwriting)
    const allLaborHours = uninvoicedTime.reduce((s, e) => s + e.hours, 0);
    await pave({ updateCostGroup: { $: { id: laborGroup.id, quantity: Math.round(allLaborHours * 100) / 100, unitId: '22P5SRxXqzSe', showChildren: false, description: laborDescFinal } } });
  }

  return {
    documentId: doc.id,
    documentName: doc.name,
    documentNumber: doc.number,
    itemCount: createdItemCount,
    totalCost,
    totalPrice,
  };
}

// ============================================================
// Fixed-Price / Contract Billable Change Order Creation
// ============================================================

/**
 * Create a draft Change Order (customerOrder) for a fixed-price (contract) job containing:
 * 1. CC23 (Billable) material & subcontractor costs from vendor bills not yet billed
 * 2. CC23 (Billable) labor hours from time entries not yet billed
 *
 * We create a customerOrder (Change Order) rather than a customerInvoice because on
 * fixed-price jobs we need the new value to flow through JobTread's CO approval →
 * convert-to-invoice workflow so totalContractAndCOValue and invoicedToDate stay aligned.
 * The "Change Order" name in the subject is what the CO detection in invoicing-health.ts
 * and co-tracking.ts keys off of to classify this document as a CO.
 *
 * Cost-plus jobs continue to use direct invoice creation (separate code path).
 */
export async function createDraftBillableInvoice(jobId: string): Promise<{
  documentId: string;
  documentName: string;
  documentNumber: string;
  itemCount: number;
  totalCost: number;
  totalPrice: number;
}> {
  const BILLABLE_COST_CODE_NUMBER = '23';
  // Keep in sync with BILLABLE_COST_TYPE_NAMES in app/lib/invoicing-health.ts.
  // 'Other' is included so mistakenly-coded billable items still get swept into
  // the draft invoice instead of being silently dropped.
  const BILLABLE_COST_TYPE_NAMES = ['Materials', 'Subcontractor', 'Other'];

  // 1. Get job details including location, customer info, and custom fields (Margin, Hourly Rate)
  const jobData = await pave({
    job: {
      $: { id: jobId },
      id: {}, name: {}, number: {},
      location: {
        id: {}, name: {}, address: {},
        account: {
          id: {}, name: {},
          contacts: {
            nodes: {
              name: {},
              customFieldValues: { nodes: { value: {}, customField: { name: {} } } },
            },
          },
        },
      },
      customFieldValues: {
        nodes: { value: {}, customField: { id: {}, name: {} } },
      },
    },
  });
  const job = (jobData as any)?.job;
  if (!job) throw new Error('Job not found: ' + jobId);

  const customerName = job.location?.account?.name || 'Client';
  const locationName = job.location?.name || '';
  const locationAddress = job.location?.address || locationName;

  // Read custom fields: Margin (%) and Hourly Rate ($) — REQUIRED
  const customFields = job.customFieldValues?.nodes || [];
  const marginField = customFields.find((cf: any) => cf.customField?.name === 'Margin');
  const hourlyRateField = customFields.find((cf: any) => cf.customField?.name === 'Hourly Rate');

  if (!marginField || !marginField.value) {
    throw new Error('MISSING_CUSTOM_FIELD: The "Margin" custom field is not set on this job in JobTread. Please add a Margin value (e.g. 25 for 25%) before generating an invoice.');
  }
  if (!hourlyRateField || !hourlyRateField.value) {
    throw new Error('MISSING_CUSTOM_FIELD: The "Hourly Rate" custom field is not set on this job in JobTread. Please add an Hourly Rate value (e.g. 115) before generating an invoice.');
  }

  const marginPercent = parseFloat(marginField.value);
  const hourlyRate = parseFloat(hourlyRateField.value);

  if (isNaN(marginPercent) || marginPercent <= 0 || marginPercent >= 100) {
    throw new Error('MISSING_CUSTOM_FIELD: The "Margin" custom field has an invalid value. It must be a number between 1 and 99 (e.g. 25 for 25%).');
  }
  if (isNaN(hourlyRate) || hourlyRate <= 0) {
    throw new Error('MISSING_CUSTOM_FIELD: The "Hourly Rate" custom field has an invalid value. It must be a positive number (e.g. 115).');
  }

  // Margin = profit as % of selling price (not markup on cost)
  // e.g. 25% margin -> price = cost / (1 - 0.25) = cost x 1.3333
  const marginMultiplier = 1 / (1 - marginPercent / 100);

  // Get customer contact info for toPhone/toEmail
  const contacts = job.location?.account?.contacts?.nodes || [];
  const primaryContact = contacts[0];
  let customerPhone = '';
  let customerEmail = '';
  if (primaryContact) {
    for (const cfv of primaryContact.customFieldValues?.nodes || []) {
      if (cfv.customField?.name === 'Phone') customerPhone = cfv.value || '';
      if (cfv.customField?.name === 'Email') customerEmail = cfv.value || '';
    }
  }

  // 2. Get all documents for the job to identify vendor bills and customer invoices.
  // Paginate: large contract jobs (e.g. Halvorsen with 115+ docs) silently
  // dropped bills past the first page, leading to "no uninvoiced CC23 items"
  // errors even when the dashboard showed thousands of dollars uninvoiced.
  const DOCS_PAGE_SIZE = 50;
  const allDocs: any[] = [];
  let docsNextPage: string | null = null;
  for (let page = 0; page < 10; page++) {
    const pageParams: Record<string, unknown> = { size: DOCS_PAGE_SIZE };
    if (docsNextPage) pageParams.page = docsNextPage;
    const docsData = await pave({
      job: {
        $: { id: jobId },
        documents: {
          $: pageParams,
          nextPage: {},
          // `subject` pulled so same-day "Billable CO MM/DD/YY" detection works
          // — starting 2026-04-21, the billable-items flow stores its date
          // stamp in subject (name is the JT template name like "Change Order").
          nodes: { id: {}, name: {}, subject: {}, type: {}, status: {}, number: {} },
        },
      },
    });
    const docsPage = (docsData as any)?.job?.documents;
    const nodes = docsPage?.nodes || [];
    allDocs.push(...nodes);
    docsNextPage = docsPage?.nextPage || null;
    if (!docsNextPage || nodes.length < DOCS_PAGE_SIZE) break;
  }
  const vendorBills = allDocs.filter(
    (d: any) => d.type === 'vendorBill' && d.status !== 'denied'
  );
  const customerInvoices = allDocs.filter(
    (d: any) => d.type === 'customerInvoice' && d.status !== 'draft'
  );

  // 3. Get CC23 items from vendor bills (costs incurred).
  // Batch to 5 at a time to avoid rate-limit / 413 errors on large contract
  // jobs (Halvorsen has ~95 bills; firing them all in parallel was silently
  // returning empty arrays for some, masking uninvoiced items).
  const BILL_BATCH_SIZE = 5;
  const allVendorBillItems: any[] = [];
  for (let i = 0; i < vendorBills.length; i += BILL_BATCH_SIZE) {
    const batch = vendorBills.slice(i, i + BILL_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (doc: any) => {
        try {
          const data = await pave({
            document: {
              $: { id: doc.id },
              costItems: {
                $: { size: 50 },
                nodes: {
                  id: {}, name: {}, cost: {}, price: {}, quantity: {},
                  unitCost: {}, unitPrice: {},
                  costCode: { id: {}, number: {}, name: {} },
                  costType: { id: {}, name: {} },
                  // Pull the linked budget item's costCode so the CC23 filter
                  // can prefer the budget bucket over the line-level code.
                  jobCostItem: { id: {}, costCode: { number: {}, name: {} } },
                },
              },
            },
          });
          const items = (data as any)?.document?.costItems?.nodes || [];
          return items.map((item: any) => ({
            ...item,
            sourceDoc: { id: doc.id, number: doc.number, name: doc.name },
          }));
        } catch {
          return [];
        }
      })
    );
    for (const items of batchResults) allVendorBillItems.push(...items);
  }
  const cc23VendorBillItems = allVendorBillItems.filter(
    (item: any) => getEffectiveCostCodeNumber(item) === BILLABLE_COST_CODE_NUMBER
  );

  // 4. Get CC23 items already on customer invoices (already billed)
  const customerInvoiceItemResults = await Promise.all(
    customerInvoices.map(async (doc: any) => {
      try {
        const data = await pave({
          document: {
            $: { id: doc.id },
            costItems: {
              $: { size: 50 },
              nodes: {
                id: {}, name: {}, cost: {}, price: {}, quantity: {},
                costCode: { number: {} },
                costType: { name: {} },
                // Pull the linked budget item's costCode so the CC23 filter
                // can prefer the budget bucket over the line-level code.
                jobCostItem: { id: {}, costCode: { number: {} } },
              },
            },
          },
        });
        return (data as any)?.document?.costItems?.nodes || [];
      } catch {
        return [];
      }
    })
  );
  const allCustomerInvoiceItems = customerInvoiceItemResults.flat();
  const cc23InvoicedItems = allCustomerInvoiceItems.filter(
    (item: any) => getEffectiveCostCodeNumber(item) === BILLABLE_COST_CODE_NUMBER
  );

  // 5. FIFO deduction to find uninvoiced CC23 vendor bill items
  // (Same approach as Cost-Plus: multiple vendor bill items can share a budget item,
  // so we can't just check if the budget ID appears on an invoice â we need to
  // deduct invoiced amounts from oldest vendor bill items per budget item)

  // Group CC23 invoiced costs by budget item
  const cc23InvoicedByBudgetItem = new Map<string, number>();
  for (const item of cc23InvoicedItems) {
    const budgetId = item.jobCostItem?.id || item.id;
    cc23InvoicedByBudgetItem.set(budgetId, (cc23InvoicedByBudgetItem.get(budgetId) || 0) + (item.cost || 0));
  }

  // Group CC23 vendor bill items by budget item, sorted by date (FIFO)
  const cc23ByBudgetItem = new Map<string, any[]>();
  for (const item of cc23VendorBillItems) {
    const budgetId = item.jobCostItem?.id || item.id;
    if (!cc23ByBudgetItem.has(budgetId)) cc23ByBudgetItem.set(budgetId, []);
    cc23ByBudgetItem.get(budgetId)!.push(item);
  }

  // FIFO deduction: deduct invoiced amounts from oldest vendor bill items first
  const uninvoicedCC23Items: any[] = [];
  cc23ByBudgetItem.forEach((items, budgetId) => {
    items.sort((a: any, b: any) => {
      const dateA = a.sourceDoc?.number || '0';
      const dateB = b.sourceDoc?.number || '0';
      return parseInt(dateA) - parseInt(dateB);
    });
    let remaining = cc23InvoicedByBudgetItem.get(budgetId) || 0;
    for (const item of items) {
      if (remaining >= (item.cost || 0)) {
        remaining -= (item.cost || 0);
      } else {
        uninvoicedCC23Items.push(item);
        remaining = 0;
      }
    }
  });

  // Separate into materials/subs and other CC23 items
  const uninvoicedMaterialsSubs = uninvoicedCC23Items.filter(
    (item: any) => BILLABLE_COST_TYPE_NAMES.includes(item.costType?.name ?? '')
  );

  // 6. Calculate unbilled CC23 labor hours from time entries.
  // Use the paginated helper — PAVE caps at 100 per query, and Halvorsen has
  // 145+ entries, so a single-page fetch was silently dropping the newest
  // (often the CC23 billables we need to invoice).
  const timeEntries = await getTimeEntriesForJob(jobId);
  const cc23TimeEntries = timeEntries.filter(
    (e: any) => e.costItem?.costCode?.number === BILLABLE_COST_CODE_NUMBER
  );

  // Sum CC23 hours
  let totalCC23Hours = 0;
  for (const entry of cc23TimeEntries) {
    if (entry.startedAt && entry.endedAt) {
      const hours = (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 3600000;
      totalCC23Hours += hours;
    }
  }

  // Subtract hours already billed on customer invoices
  // CC23 items on invoices with "labor" in the name represent billed hours (quantity = hours)
  const cc23LaborOnInvoices = cc23InvoicedItems.filter(
    (item: any) => item.name?.toLowerCase().includes('labor')
  );
  const billedLaborHours = cc23LaborOnInvoices.reduce(
    (sum: number, item: any) => sum + (item.quantity || 0), 0
  );
  const unbilledLaborHours = Math.max(0, totalCC23Hours - billedLaborHours);

  // Check if there's anything to invoice
  if (uninvoicedMaterialsSubs.length === 0 && unbilledLaborHours < 0.1) {
    throw new Error('No uninvoiced CC23 billable items or labor hours found for this job.');
  }

  // 7. Get the CC23 labor budget item ID for linking the labor line item
  // (the budget item that time entries are tagged to)
  let laborBudgetItemId: string | undefined;
  let laborCostCodeId: string | undefined;
  let laborCostTypeId: string | undefined;
  if (unbilledLaborHours >= 0.1 && cc23TimeEntries.length > 0) {
    laborBudgetItemId = cc23TimeEntries[0].costItem?.id;
    // Fetch the budget item's cost code and type IDs
    if (laborBudgetItemId) {
      const laborItemData = await pave({
        costItem: {
          $: { id: laborBudgetItemId },
          costCode: { id: {} },
          costType: { id: {} },
          unitCost: {},
          unitPrice: {},
        },
      });
      const laborItem = (laborItemData as any)?.costItem;
      laborCostCodeId = laborItem?.costCode?.id;
      laborCostTypeId = laborItem?.costType?.id;
    }
  }

  // 8. Create the Change Order (customerOrder) shell with BKB company info.
  //    PAVE requires `name` to match a document template name configured in
  //    the job's template set (e.g., "Change Order" or, on Design-Build jobs,
  //    "Change Order (Cost-Plus)"). `createJTDocument` will fall back to an
  //    allowed CO-like template name if the primary is rejected.
  //
  //    The human-readable "Billable CO MM/DD/YY" identifier goes in `subject`
  //    — that's what CO detection in invoicing-health.ts keys off of to
  //    distinguish billable-items COs from scope COs. Date stamp is immune
  //    to deletion/recreation churn (counts could repeat). Same-day suffix
  //    is added if multiple billable COs are created on the same date.
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  const dateStamp = `${mm}/${dd}/${yy}`;
  const baseCOSubject = `Billable CO ${dateStamp}`;

  // Look across existing CO docs on this job — match both legacy docs where
  // the date stamp lived in `name` and new docs where it lives in `subject`.
  const sameDayCOs = allDocs.filter((d: any) =>
    d.type === 'customerOrder' &&
    ((typeof d.name === 'string' && d.name.startsWith(baseCOSubject)) ||
     (typeof d.subject === 'string' && d.subject.startsWith(baseCOSubject)))
  );
  const coSubject = sameDayCOs.length > 0
    ? `${baseCOSubject} (${sameDayCOs.length + 1})`
    : baseCOSubject;

  const doc = await createJTDocument({
    jobId,
    type: 'customerOrder',
    // Primary: plain "Change Order" template. documentTemplateId 22PKqytScJpC
    // is BKB's "Change Order" template (from: Terri, due: 5 days).
    name: 'Change Order',
    documentTemplateId: '22PKqytScJpC',
    // If the job's template set doesn't include plain "Change Order" (e.g.,
    // Design-Build jobs like Bartholomew only expose "Change Order
    // (Cost-Plus)"), retry with the first allowed name matching /change\s*order/i.
    fallbackNamePattern: /change\s*order/i,
    fromName: 'Terri (Brett King Builder-Contractor Inc.)',
    toName: customerName,
    toAddress: locationAddress,
    taxRate: '0',
    jobLocationName: locationName,
    jobLocationAddress: locationAddress,
    // dueDays required by JT PAVE — must provide either dueDate or dueDays (not both).
    // 14 days gives the customer a reasonable window to review and approve the CO.
    dueDays: 14,
    subject: coSubject,
    description: 'This change order covers additional billable items and labor hours incurred on this project beyond the original contract scope. Once approved in JobTread, convert to an invoice to bill the customer.',
  });

  // Set company address, org name, and hide QTY column
  try {
    await pave({ updateDocument: { $: { id: doc.id, fromAddress: '7843 Richlandtown Rd, Quakertown, PA 18951, USA' } } });
    await pave({ updateDocument: { $: { id: doc.id, fromOrganizationName: 'Brett King Builder-Contractor Inc.' } } });
    await pave({ updateDocument: { $: { id: doc.id, showQuantity: false } } });
  } catch (_e) { /* non-critical if any fail */ }

  let totalCost = 0;
  let totalPrice = 0;
  let createdItemCount = 0;

  // ============================================================
  // 9. Create in BKB format: Billable Items / Materials / BKB Labor
  // with pricing from job custom fields (Margin % and Hourly Rate)
  // ============================================================

  // Classify uninvoiced items into Billable Items (subs) vs Materials
  const uninvoicedSubs = uninvoicedMaterialsSubs.filter(
    (item: any) => item.costType?.name === 'Subcontractor'
  );
  const uninvoicedMaterials = uninvoicedMaterialsSubs.filter(
    (item: any) => item.costType?.name === 'Materials'
  );

  // Helper: create a category group with bill sub-groups, AI descriptions, and hidden line items
  async function createBillCategory(
    categoryName: string,
    items: any[],
    parentDocId: string,
  ): Promise<number> {
    if (items.length === 0) return 0;

    const categoryGroup = await createJTCostGroup({ documentId: parentDocId, name: categoryName });
    let itemCount = 0;

    // Sub-group by vendor bill source
    const byBill: Record<string, { items: any[]; docId: string; docNumber: string }> = {};
    for (const item of items) {
      const key = item.sourceDoc?.id || 'unknown';
      if (!byBill[key]) {
        byBill[key] = {
          items: [],
          docId: item.sourceDoc?.id || '',
          docNumber: item.sourceDoc?.number || '',
        };
      }
      byBill[key].items.push(item);
    }

    // Collect per-bill summaries (vendor + finalized description) to feed
    // the category-level AI prompt. Using the actual bill descriptions keeps
    // the category summary grounded in what's shown below instead of letting
    // the AI hallucinate generic boilerplate from sparse cost-code names.
    const billSummaries: { vendor: string; desc: string }[] = [];

    for (const [_billId, billInfo] of Object.entries(byBill)) {
      // Find the vendor name from the documents list
      const vendorDoc = allDocs.find((d: any) => d.id === billInfo.docId);
      const vendorAccount = vendorDoc?.account?.name || vendorDoc?.name || `Bill #${billInfo.docNumber}`;

      const subGroup = await createJTCostGroup({
        parentCostGroupId: categoryGroup.id,
        name: `${vendorAccount} Bill ${job.number}-${billInfo.docNumber}`,
      });

      // Fetch the original bill's cost item descriptions for AI rewriting
      let billDesc = '';
      try {
        const billItemsData = await pave({
          document: {
            $: { id: billInfo.docId },
            costItems: { $: { size: 10 }, nodes: { id: {}, description: {} } },
          },
        });
        const descs = ((billItemsData as any)?.document?.costItems?.nodes || [])
          .map((i: any) => (i.description || '').trim())
          .filter((d: string) => d.length > 0);
        billDesc = descs.join('\n');
      } catch (_e) { /* skip */ }

      // AI-rewrite the bill description and capture the final version used
      // on the sub-group, so we can reuse it for the category-level summary.
      let finalBillDesc = '';
      if (billDesc) {
        try {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (apiKey) {
            const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 256,
                messages: [{
                  role: 'user',
                  content: `Rewrite this vendor bill description into a brief, professional, client-facing summary for a renovation change order. Keep it to 1-2 concise sentences. Do not include pricing. Do not use markdown headers (#) or bold (**) formatting. Write in plain text. Do not mention tools, consumables, or crew supplies (gloves, batteries, cords, blades, tape, rags, trash bags, etc.) — only mention materials that become part of the finished project.\n\nOriginal:\n${billDesc}`,
                }],
              }),
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const rewritten = sanitizeAiDescription((aiData.content?.[0]?.text || '').trim());
              if (isValidAiDescription(rewritten)) {
                await updateJTCostGroup(subGroup.id, { description: rewritten });
                finalBillDesc = rewritten;
              }
            }
          }
        } catch (_e) { /* skip AI errors */ }
      }

      // Fallback: if AI didn't produce a valid summary, use the first line of
      // the raw bill description so the category summary still has something
      // real to work with.
      if (!finalBillDesc && billDesc) {
        finalBillDesc = billDesc.split('\n')[0].slice(0, 240).trim();
      }
      if (finalBillDesc) {
        billSummaries.push({ vendor: vendorAccount, desc: finalBillDesc });
      }

      // Hide line items on the sub-group
      await pave({ updateCostGroup: { $: { id: subGroup.id, showChildren: false } } });

      // Create cost items with bill reference in description
      for (const item of billInfo.items) {
        await createJTCostItem({
          costGroupId: subGroup.id,
          name: item.name,
          description: `Source: Bill ${job.number}-${billInfo.docNumber} | ${item.costCode?.name || ''}`,
          costCodeId: item.costCode?.id || undefined,
          costTypeId: item.costType?.id || undefined,
          jobCostItemId: item.jobCostItem?.id || undefined,
          quantity: item.quantity ?? 1,
          unitCost: item.unitCost || item.cost || 0,
          unitPrice: item.unitPrice || (item.unitCost || item.cost || 0) * marginMultiplier,
        });
        totalCost += (item.cost ?? 0);
        totalPrice += (item.price || (item.cost || 0) * marginMultiplier);
        itemCount++;
      }
    }

    // Build category-level description that genuinely summarizes the items
    // shown below (instead of feeding the AI sparse cost-code names, which
    // led to hallucinated boilerplate bullets like "Project costs billed to
    // client account").
    if (billSummaries.length > 0) {
      // If there's only one bill in this category, reuse its description
      // directly — no need to ask the AI to "summarize" a single line.
      if (billSummaries.length === 1) {
        await updateJTCostGroup(categoryGroup.id, { description: billSummaries[0].desc });
      } else {
        const rawDesc = billSummaries
          .map(b => `• ${b.vendor}: ${b.desc}`)
          .join('\n');
        try {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (apiKey) {
            const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 256,
                messages: [{
                  role: 'user',
                  content: `You are writing the header description for the "${categoryName}" section of a renovation change order. Summarize the items below into a short, client-facing bullet list that accurately reflects the actual scope — one bullet per distinct type of work or item, at most ${Math.min(billSummaries.length, 4)} bullets total. Do NOT invent items that aren't listed. Do NOT use generic filler like "project costs billed to client" or "third-party vendor costs" — describe the specific scope shown. Output ONLY the bullet points (using • character), nothing else. No intro, no questions. No markdown headers (#). No pricing. For emphasis use single *asterisks* not double **asterisks**.\n\nItems on this change order:\n${rawDesc}`,
                }],
              }),
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const rewritten = sanitizeAiDescription((aiData.content?.[0]?.text || '').trim());
              if (isValidAiDescription(rewritten)) {
                await updateJTCostGroup(categoryGroup.id, { description: rewritten });
              } else {
                // Fallback: use the raw per-bill bullet list if AI output is invalid
                await updateJTCostGroup(categoryGroup.id, { description: rawDesc });
              }
            } else {
              await updateJTCostGroup(categoryGroup.id, { description: rawDesc });
            }
          } else {
            await updateJTCostGroup(categoryGroup.id, { description: rawDesc });
          }
        } catch (_e) {
          // Fallback on any error: show the concrete per-bill bullets
          try { await updateJTCostGroup(categoryGroup.id, { description: rawDesc }); } catch { /* skip */ }
        }
      }
    }

    return itemCount;
  }

  // Get vendor account names for bill sub-group naming
  const docsWithAccounts = await pave({
    job: {
      $: { id: jobId },
      documents: {
        $: { size: 50 },
        nodes: { id: {}, name: {}, type: {}, number: {}, account: { name: {} } },
      },
    },
  });
  const allDocsWithAccounts = (docsWithAccounts as any)?.job?.documents?.nodes || [];
  // Merge account names into allDocs
  for (const d of allDocsWithAccounts) {
    const existing = allDocs.find((e: any) => e.id === d.id);
    if (existing) existing.account = d.account;
  }

  // Create Trade Partners group (subcontractors)
  createdItemCount += await createBillCategory('Billable Items', uninvoicedSubs, doc.id);

  // Create Materials group
  createdItemCount += await createBillCategory('Materials', uninvoicedMaterials, doc.id);

  // 10. Create BKB Labor group with hours (if any)
  if (unbilledLaborHours >= 0.1) {
    const laborGroup = await createJTCostGroup({
      documentId: doc.id,
      name: 'BKB Labor',
    });

    const roundedHours = Math.round(unbilledLaborHours * 100) / 100;

    // Build labor date range header so clients know what dates are being billed
    const cc23LaborDates = cc23TimeEntries
      .filter((e: any) => e.startedAt)
      .map((e: any) => new Date(e.startedAt))
      .sort((a: Date, b: Date) => a.getTime() - b.getTime());
    let cc23DateHeader = '';
    if (cc23LaborDates.length > 0) {
      const cc23First = cc23LaborDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const cc23Last = cc23LaborDates[cc23LaborDates.length - 1].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      cc23DateHeader = cc23First === cc23Last ? `Labor dates: ${cc23First}` : `Labor dates: ${cc23First} \u2013 ${cc23Last}`;
    }

    // Build labor description from time entry notes
    const laborNotes: string[] = [];
    for (const entry of cc23TimeEntries) {
      const note = (entry.notes || '').trim();
      if (note && !laborNotes.some((n: string) => n.toLowerCase() === note.toLowerCase())) {
        laborNotes.push(note.charAt(0).toUpperCase() + note.slice(1).replace(/\.\s*$/, ''));
      }
    }

    // AI-rewrite labor description
    let laborDesc = laborNotes.map((n: string) => `• ${n}`).join('\n');
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey && laborNotes.length > 0) {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            messages: [{
              role: 'user',
              content: `Rewrite these labor notes into a bullet-point list for a renovation invoice. Each bullet should be a brief, professional, client-facing description. Output ONLY the bullet points (using • character), nothing else. No intro text, no questions, no explanations. Do not use markdown headers (#). For emphasis use single *asterisks* not double **asterisks**.\n\nNotes:\n${laborDesc}`,
            }],
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const rewritten = sanitizeAiDescription((aiData.content?.[0]?.text || '').trim());
          if (isValidAiDescription(rewritten)) laborDesc = rewritten;
        }
      }
    } catch (_e) { /* skip */ }

    // Build final description (will be applied in the combined pave call below)
    let cc23LaborDescFinal = '';
    if (laborDesc && cc23DateHeader) {
      cc23LaborDescFinal = `${cc23DateHeader}\n\n${laborDesc}`;
    } else if (laborDesc) {
      cc23LaborDescFinal = laborDesc;
    } else if (cc23DateHeader) {
      cc23LaborDescFinal = cc23DateHeader;
    }

    // Worker breakdown in description (for team reference, hidden from client)
    const workerHours: Record<string, number> = {};
    for (const entry of cc23TimeEntries) {
      const name = entry.user?.name || 'Unknown';
      if (entry.startedAt && entry.endedAt) {
        const hours = (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 3600000;
        workerHours[name] = (workerHours[name] || 0) + hours;
      }
    }
    const workerBreakdown = Object.entries(workerHours)
      .map(([name, hours]) => `${name}: ${Math.round(hours * 10) / 10}h`)
      .join(', ');

    // Use Hourly Rate from job custom field for both cost and price
    const laborUnitCost = hourlyRate;
    const laborUnitPrice = hourlyRate;

    await createJTCostItem({
      costGroupId: laborGroup.id,
      name: '23 Billable Labor',
      description: workerBreakdown || undefined,
      costCodeId: laborCostCodeId || undefined,
      costTypeId: laborCostTypeId || undefined,
      jobCostItemId: laborBudgetItemId || undefined,
      quantity: roundedHours,
      unitCost: laborUnitCost,
      unitPrice: laborUnitPrice,
    });
    totalCost += roundedHours * laborUnitCost;
    totalPrice += roundedHours * laborUnitPrice;
    createdItemCount++;

    // Set total hours, hide children, and set description (all in one call to avoid overwriting)
    const cc23GroupUpdate: any = { id: laborGroup.id, quantity: roundedHours, unitId: '22P5SRxXqzSe', showChildren: false };
    if (cc23LaborDescFinal) cc23GroupUpdate.description = cc23LaborDescFinal;
    await pave({ updateCostGroup: { $: cc23GroupUpdate } });
  }

  return {
    documentId: doc.id,
    documentName: doc.name,
    documentNumber: doc.number,
    itemCount: createdItemCount,
    totalCost,
    totalPrice,
  };
}

// ============================================================
// COST-PLUS INVOICE REORGANIZATION
// After JT creates an invoice from Bills & Time, this function
// reorganizes the items into the BKB 3-group format:
//   1. Permit & Admin Costs (with description)
//   2. Materials (with description)
//   3. BKB Labor (with description from time entry notes)
// Modeled after Invoice 199-15 (Behmlander Stone House Reno).
// ============================================================

async function deleteJTCostGroup(costGroupId: string) {
  await pave({ deleteCostGroup: { $: { id: costGroupId } } });
}

async function updateJTCostGroup(groupId: string, fields: { name?: string; description?: string; parentCostGroupId?: string }) {
  const params: any = { id: groupId };
  if (fields.name !== undefined) params.name = fields.name;
  if (fields.description !== undefined) params.description = fields.description;
  if (fields.parentCostGroupId !== undefined) params.parentCostGroupId = fields.parentCostGroupId;
  await pave({ updateCostGroup: { $: params } });
}

/**
 * Reorganize a Cost-Plus invoice (created via JT's Bills & Time UI) into
 * the BKB 3-group format matching Invoice 199-15 (Behmlander pattern):
 *
 * 1. Permit & Admin Costs â engineering, permits, porta-potty, etc.
 *    Description: bullet list of what admin/permit items are included
 *    Sub-groups: individual vendor bill groups
 *
 * 2. Materials â lumber, hardware, concrete, etc.
 *    Description: bullet list summarizing materials purchased
 *    Sub-groups: individual vendor bill groups
 *
 * 3. BKB Labor â all time entries
 *    Description: bullet list of work performed (from time entry notes)
 *    Sub-groups: individual "Time Cost for [date]" groups (kept as-is)
 */
export async function reorganizeCostPlusInvoice(documentId: string, jobId: string): Promise<{
  success: boolean;
  groupCount: number;
  laborDescription: string;
  materialsDescription: string;
  adminDescription: string;
}> {
  // 1. Read the invoice's current cost groups and items
  const invoiceData = await pave({
    document: {
      $: { id: documentId },
      costGroups: {
        $: { size: 50 },
        nodes: {
          id: {}, name: {}, description: {},
          parentCostGroup: { id: {} },
        },
      },
      costItems: {
        $: { size: 100 },
        nodes: {
          id: {}, name: {}, cost: {}, price: {}, quantity: {},
          costGroup: { id: {}, name: {} },
          costCode: { number: {}, name: {} },
          costType: { id: {}, name: {} },
        },
      },
    },
  });

  const groups = (invoiceData as any)?.document?.costGroups?.nodes || [];
  const items = (invoiceData as any)?.document?.costItems?.nodes || [];

  // 2a. Detect if this invoice was created by our API (not JT's Bills & Time UI).
  // Our API creates "Vendor Bills" and "BKB Labor" parent groups with child items.
  // JT's Bills & Time UI creates flat "Vendor Bill XXX-XX" and "Time Cost for [date]" groups.
  // If we detect our API structure, skip reorganization â it's already in the right format.
  const hasVendorBillsParent = groups.some((g: any) => g.name === 'Vendor Bills' && !g.parentCostGroup?.id);
  const hasBKBLaborParent = groups.some((g: any) => g.name === 'BKB Labor' && !g.parentCostGroup?.id);
  const hasJTTimeGroups = groups.some((g: any) => (g.name || '').toLowerCase().includes('time cost for'));

  if ((hasVendorBillsParent || hasBKBLaborParent) && !hasJTTimeGroups) {
    // Invoice was created by our API â already has the right structure with AI descriptions.
    // Just run the AI category-level rewrite on the existing top-level groups.
    const existingLabor = groups.find((g: any) => g.name === 'BKB Labor' && !g.parentCostGroup?.id);
    const existingVendorBills = groups.find((g: any) => g.name === 'Vendor Bills' && !g.parentCostGroup?.id);

    // Re-categorize vendor sub-groups into Trade Partners / Materials
    const vendorSubGroups = groups.filter((g: any) => g.parentCostGroup?.id === existingVendorBills?.id);
    const adminBills: any[] = [];
    const materialBills: any[] = [];

    for (const g of vendorSubGroups) {
      const groupItems = items.filter((i: any) => i.costGroup?.id === g.id);
      let isAdmin = false;
      for (const item of groupItems) {
        const costTypeName = (item.costType?.name || '').toLowerCase();
        const costCodeNum = parseInt(item.costCode?.number || '0', 10);
        if (costCodeNum === 1 || costCodeNum === 20 || costCodeNum === 21 || costCodeNum === 22) {
          isAdmin = true;
        } else if (costCodeNum === 23 && costTypeName.includes('subcontract')) {
          isAdmin = true;
        } else if (costTypeName.includes('subcontract')) {
          isAdmin = true;
        }
        break;
      }
      if (isAdmin) adminBills.push(g);
      else materialBills.push(g);
    }

    // Rename "Vendor Bills" â "Trade Partners" or "Materials" based on content,
    // or create the proper parent groups if we have both types
    if (adminBills.length > 0 && materialBills.length === 0 && existingVendorBills) {
      // All vendors are trade partners â just rename
      await updateJTCostGroup(existingVendorBills.id, { name: 'Trade Partners' });
      // Build description from admin items
      const adminDescs = items
        .filter((i: any) => adminBills.some((bg: any) => bg.id === i.costGroup?.id))
        .map((i: any) => (i.costCode?.name || i.name || '').replace(/:\d+\s*-\s*(Sub|Materials?)/i, '').replace(/^\d+-/, '').trim())
        .filter((n: string, i: number, arr: string[]) => n && arr.indexOf(n) === i);
      if (adminDescs.length > 0) {
        await updateJTCostGroup(existingVendorBills.id, { description: adminDescs.map((n: string) => `• ${n}`).join('\n') });
      }
      for (const bg of adminBills) {
        await pave({ updateCostGroup: { $: { id: bg.id, showChildren: false } } });
      }
    } else if (materialBills.length > 0 && adminBills.length === 0 && existingVendorBills) {
      // All vendors are materials â just rename
      await updateJTCostGroup(existingVendorBills.id, { name: 'Materials' });
      const matDescs = items
        .filter((i: any) => materialBills.some((bg: any) => bg.id === i.costGroup?.id))
        .map((i: any) => (i.costCode?.name || i.name || '').replace(/:\d+\s*-\s*Materials?/i, '').replace(/^\d+-/, '').trim())
        .filter((n: string, i: number, arr: string[]) => n && arr.indexOf(n) === i);
      if (matDescs.length > 0) {
        await updateJTCostGroup(existingVendorBills.id, { description: matDescs.map((n: string) => `• ${n}`).join('\n') });
      }
      for (const bg of materialBills) {
        await pave({ updateCostGroup: { $: { id: bg.id, showChildren: false } } });
      }
    } else if (adminBills.length > 0 && materialBills.length > 0 && existingVendorBills) {
      // Mixed â need to split into Trade Partners and Materials
      // Rename existing to Trade Partners, create new Materials
      await updateJTCostGroup(existingVendorBills.id, { name: 'Trade Partners' });
      const materialsGroup = await createJTCostGroup({ documentId, name: 'Materials' });
      for (const bg of materialBills) {
        await updateJTCostGroup(bg.id, { parentCostGroupId: materialsGroup.id });
        await pave({ updateCostGroup: { $: { id: bg.id, showChildren: false } } });
      }
      for (const bg of adminBills) {
        await pave({ updateCostGroup: { $: { id: bg.id, showChildren: false } } });
      }
    }

    // AI-rewrite all descriptions
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        // Rewrite top-level group descriptions
        const laborDesc = existingLabor?.description || '';
        const tpGroup = groups.find((g: any) => (g.name === 'Trade Partners' || (g.name === 'Vendor Bills' && !g.parentCostGroup?.id)));
        const matGroup = groups.find((g: any) => g.name === 'Materials' && !g.parentCostGroup?.id);
        const adminDesc = tpGroup?.description || adminBills.map((bg: any) => bg.name).join(', ');
        const matDesc = matGroup?.description || materialBills.map((bg: any) => bg.name).join(', ');

        if (adminDesc || matDesc || laborDesc) {
          const prompt = `You are writing invoice descriptions for a high-end residential renovation company (Brett King Builder-Contractor). Rewrite each section's bullet-point description to be professional, client-facing, and easy to read. Keep bullet points but make each one a polished 1-line description. Do not add items that aren't there. Be concise. Do not use markdown headers (#). For emphasis use single *asterisks* not double **asterisks**.

IMPORTANT for MATERIAL ITEMS: Do NOT include tools, consumables, or supplies purchased for the crew to do the work. Omit items like work gloves, batteries, electrical cords, extension cords, blades, drill bits, tape, rags, trash bags, safety glasses, dust masks, and similar job-site consumables. Only describe materials that become part of the finished project (lumber, tile, fixtures, hardware, paint, drywall, etc.). If all material items are tools/consumables, return an empty string for that key.

PERMIT & ADMIN ITEMS:
${adminDesc || '(none)'}

MATERIAL ITEMS:
${matDesc || '(none)'}

LABOR NOTES (from time entries â describe the work performed):
${laborDesc || '(none)'}

Respond in this exact JSON format:
{"admin": "• bullet1\\n• bullet2", "materials": "• bullet1\\n• bullet2", "labor": "• bullet1\\n• bullet2"}

If a section is "(none)", return empty string for that key.`;

          const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1024,
              messages: [{ role: 'user', content: prompt }],
            }),
          });

          if (aiRes.ok) {
            const aiData = await aiRes.json();
            const aiText = aiData.content?.[0]?.text || '';
            try {
              const jsonMatch = aiText.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const rewritten = JSON.parse(jsonMatch[0]);
                if (rewritten.admin) rewritten.admin = sanitizeAiDescription(rewritten.admin);
                if (rewritten.materials) rewritten.materials = sanitizeAiDescription(rewritten.materials);
                if (rewritten.labor) rewritten.labor = sanitizeAiDescription(rewritten.labor);
                // Update the renamed Vendor Bills / Trade Partners group
                const updatedTP = groups.find((g: any) => g.id === existingVendorBills?.id);
                if (isValidAiDescription(rewritten.admin) && updatedTP && adminBills.length > 0) {
                  await updateJTCostGroup(updatedTP.id, { description: rewritten.admin });
                }
                if (isValidAiDescription(rewritten.materials)) {
                  const mGroup = materialBills.length > 0 && adminBills.length > 0
                    ? groups.find((g: any) => g.name === 'Materials' && !g.parentCostGroup?.id) // newly created
                    : (existingVendorBills?.id ? existingVendorBills : null);
                  // For the newly created materials group, we need to use a fresh lookup
                }
                if (isValidAiDescription(rewritten.labor) && existingLabor) {
                  await updateJTCostGroup(existingLabor.id, { description: rewritten.labor });
                }
              }
            } catch (_e) { /* skip parse errors */ }
          }
        }
      }
    } catch (_e) { /* skip AI errors */ }

    // Preserve labor date range header if it was set during invoice creation
    if (existingLabor) {
      const currentGroup = await pave({ costGroup: { $: { id: existingLabor.id }, description: {} } });
      const currentDesc = ((currentGroup as any)?.costGroup?.description || '').trim();
      // Check if the original description (before AI rewrite) had a date header
      const originalDesc = (existingLabor.description || '').trim();
      const dateMatch = originalDesc.match(/^(Labor dates:[^\n]+)/);
      if (dateMatch && !currentDesc.startsWith('Labor dates:')) {
        // AI rewrite removed the date header — re-add it
        const finalDesc = currentDesc ? `${dateMatch[1]}\n\n${currentDesc}` : dateMatch[1];
        await updateJTCostGroup(existingLabor.id, { description: finalDesc });
      }
    }

    return {
      success: true,
      groupCount: groups.length,
      laborDescription: existingLabor?.description || '',
      materialsDescription: '',
      adminDescription: '',
    };
  }

  // 2. Classify ALL existing groups into categories.
  // JT Bills & Time creates everything FLAT at the top level â no nesting.
  // Bill groups are named like "Vendor Name Bill XXX-XX (ref)"
  // Time groups are named like "Time Cost for Day, Mon DD, YYYY"
  type Category = 'admin' | 'materials' | 'labor';
  const billGroups: Array<{ group: any; category: Category }> = [];
  const timeGroups: Array<{ group: any }> = [];

  for (const g of groups) {
    const name = (g.name || '').toLowerCase();
    if (name.includes('time cost for')) {
      timeGroups.push({ group: g });
    } else {
      // Determine category from the group's items' cost codes/types
      const groupItems = items.filter((i: any) => i.costGroup?.id === g.id);
      let category: Category = 'materials'; // default

      for (const item of groupItems) {
        const costTypeName = (item.costType?.name || '').toLowerCase();
        const costCodeNum = parseInt(item.costCode?.number || '0', 10);

        // Admin: cost codes 1, 20-23 with subcontractor type, or permits/engineering
        if (costCodeNum === 1 || costCodeNum === 20 || costCodeNum === 21 || costCodeNum === 22) {
          category = 'admin';
        } else if (costCodeNum === 23 && costTypeName.includes('subcontract')) {
          category = 'admin';
        } else if (costTypeName.includes('material')) {
          category = 'materials';
        } else if (costTypeName.includes('subcontract')) {
          category = 'admin';
        }
        break; // first item determines category
      }

      billGroups.push({ group: g, category });
    }
  }

  // 3. Fetch time entry notes for the job (for BKB Labor description)
  // Only include notes from time entries whose dates match the invoice's
  // "Time Cost for [date]" groups â not ALL time entries on the job.
  const teData = await pave({
    job: {
      $: { id: jobId },
      timeEntries: {
        $: { size: 100 },
        nodes: {
          id: {}, startedAt: {}, notes: {},
          user: { name: {} },
        },
      },
    },
  });
  const timeEntries = (teData as any)?.job?.timeEntries?.nodes || [];

  // Extract dates from the "Time Cost for [date]" group names on the invoice
  const invoiceDates = new Set<string>();
  for (const tg of timeGroups) {
    // Group names like "Time Cost for Wed, Nov 12, 2025"
    // Extract and normalize the date to match time entry startedAt
    const dateMatch = (tg.group.name || '').match(/Time Cost for \w+,\s+(.+)/);
    if (dateMatch) {
      try {
        const parsed = new Date(dateMatch[1]);
        if (!isNaN(parsed.getTime())) {
          invoiceDates.add(parsed.toISOString().split('T')[0]);
        }
      } catch (e) { /* skip */ }
    }
  }

  // Filter time entries to only those whose date is on the invoice
  const laborNotes: string[] = [];
  for (const te of timeEntries) {
    const teDate = te.startedAt ? te.startedAt.split('T')[0] : '';
    if (!invoiceDates.has(teDate)) continue; // skip entries not on this invoice

    const note = (te.notes || '').trim();
    if (note && !laborNotes.some(n => n.toLowerCase() === note.toLowerCase())) {
      const cleaned = note.charAt(0).toUpperCase() + note.slice(1).replace(/\.\s*$/, '');
      laborNotes.push(cleaned);
    }
  }
  const laborDescription = laborNotes.length > 0
    ? laborNotes.map(n => `• ${n}`).join('\n')
    : '';

  // Build materials description from cost code names on material items
  const materialItemDescriptions = items
    .filter((i: any) => {
      const gid = i.costGroup?.id;
      return billGroups.some(bg => bg.category === 'materials' && bg.group.id === gid);
    })
    .map((i: any) => {
      const codeName = i.costCode?.name || '';
      return codeName.replace(/:\d+\s*-\s*Materials?/i, '').replace(/^\d+-/, '').trim();
    })
    .filter((n: string, i: number, arr: string[]) => n && arr.indexOf(n) === i);
  const materialsDescription = materialItemDescriptions.length > 0
    ? materialItemDescriptions.map((n: string) => `• ${n}`).join('\n')
    : '';

  // Build admin description from admin item names
  const adminItemDescriptions = items
    .filter((i: any) => {
      const gid = i.costGroup?.id;
      return billGroups.some(bg => bg.category === 'admin' && bg.group.id === gid);
    })
    .map((i: any) => {
      const codeName = i.costCode?.name || i.name || '';
      return codeName.replace(/:\d+\s*-\s*(Sub|Materials?)/i, '').replace(/^\d+-/, '').trim();
    })
    .filter((n: string, i: number, arr: string[]) => n && arr.indexOf(n) === i);
  const adminDescription = adminItemDescriptions.length > 0
    ? adminItemDescriptions.map((n: string) => `• ${n}`).join('\n')
    : '';

  // 4. Delete existing category groups from a previous run (idempotency)
  const CATEGORY_NAMES = ['Permit & Admin Costs', 'Trade Partners', 'Materials', 'BKB Labor'];
  for (const g of groups) {
    if (CATEGORY_NAMES.includes(g.name)) {
      try { await deleteJTCostGroup(g.id); } catch (_e) { /* may fail if has children */ }
    }
  }

  // Create category groups ONLY if they have sub-groups to contain (skip empty categories)
  const adminBills = billGroups.filter(bg => bg.category === 'admin');
  const materialBills = billGroups.filter(bg => bg.category === 'materials');

  let adminGroup: { id: string } | null = null;
  let materialsGroup: { id: string } | null = null;
  let laborGroup: { id: string } | null = null;

  if (adminBills.length > 0) {
    adminGroup = await createJTCostGroup({ documentId, name: 'Trade Partners' });
    if (adminDescription) await updateJTCostGroup(adminGroup.id, { description: adminDescription });
  }
  if (materialBills.length > 0) {
    materialsGroup = await createJTCostGroup({ documentId, name: 'Materials' });
    if (materialsDescription) await updateJTCostGroup(materialsGroup.id, { description: materialsDescription });
  }
  if (timeGroups.length > 0) {
    laborGroup = await createJTCostGroup({ documentId, name: 'BKB Labor' });
    if (laborDescription) await updateJTCostGroup(laborGroup.id, { description: laborDescription });
  }

  // 5. Re-parent sub-groups and set showChildren=false (hides line items, matching Behmlander pattern)

  // Collect all bill sub-groups for description rewriting
  const allBillGroups = [...adminBills, ...materialBills];

  for (const bg of adminBills) {
    if (adminGroup) {
      await updateJTCostGroup(bg.group.id, { parentCostGroupId: adminGroup.id });
      await pave({ updateCostGroup: { $: { id: bg.group.id, showChildren: false } } });
    }
  }
  for (const bg of materialBills) {
    if (materialsGroup) {
      await updateJTCostGroup(bg.group.id, { parentCostGroupId: materialsGroup.id });
      await pave({ updateCostGroup: { $: { id: bg.group.id, showChildren: false } } });
    }
  }
  for (const tg of timeGroups) {
    if (laborGroup) {
      await updateJTCostGroup(tg.group.id, { parentCostGroupId: laborGroup.id });
      await pave({ updateCostGroup: { $: { id: tg.group.id, showChildren: false } } });
    }
  }

  // 5b. Fetch vendor bill cost item descriptions and AI-rewrite for each bill sub-group.
  // The bill sub-group names contain bill numbers like "Vendor Bill 170-10 (ref)".
  // We need to look up the original vendor bill document, get its cost items' descriptions,
  // then use AI to rewrite them as client-facing text for the invoice sub-group description.
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      // Get all vendor bill documents for this job
      const jobDocsData = await pave({
        job: {
          $: { id: jobId },
          documents: {
            $: { size: 50 },
            nodes: { id: {}, name: {}, number: {}, type: {}, status: {} },
          },
        },
      });
      const vendorBillDocs = ((jobDocsData as any)?.job?.documents?.nodes || [])
        .filter((d: any) => d.type === 'vendorBill' && d.status !== 'denied');

      for (const bg of allBillGroups) {
        // Extract bill number from group name like "Vendor Bill 170-10 (ref)"
        const billNumMatch = (bg.group.name || '').match(/Bill\s+(\d+-\d+)/);
        if (!billNumMatch) continue;

        // Find the matching vendor bill document
        const billDoc = vendorBillDocs.find((d: any) => String(d.number) === billNumMatch[1].split('-')[1]);
        if (!billDoc) continue;

        // Fetch the bill's cost items for their descriptions
        const billItemsData = await pave({
          document: {
            $: { id: billDoc.id },
            costItems: {
              $: { size: 10 },
              nodes: { id: {}, name: {}, description: {} },
            },
          },
        });
        const billItemDescs = ((billItemsData as any)?.document?.costItems?.nodes || [])
          .map((i: any) => (i.description || '').trim())
          .filter((d: string) => d.length > 0);

        if (billItemDescs.length === 0) continue;

        // AI-rewrite the description to be client-facing
        const rawDesc = billItemDescs.join('\n');
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            messages: [{
              role: 'user',
              content: `Rewrite this vendor bill description into a brief, professional, client-facing summary for a renovation invoice. Keep it to 1-2 concise sentences. Do not include pricing. Do not use markdown headers (#) or bold (**) formatting. Just describe the work or materials provided in plain text. Do not mention tools, consumables, or crew supplies (gloves, batteries, cords, blades, tape, rags, trash bags, etc.) — only mention materials that become part of the finished project.\n\nOriginal description:\n${rawDesc}`,
            }],
          }),
        });

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const rewritten = sanitizeAiDescription((aiData.content?.[0]?.text || '').trim());
          if (isValidAiDescription(rewritten)) {
            await updateJTCostGroup(bg.group.id, { description: rewritten });
          }
        }
      }
    }
  } catch (billDescErr: any) {
    console.warn('[reorganize] Bill description rewriting failed:', billDescErr.message);
  }

  // 6. Use AI to rewrite descriptions as client-facing language
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey && (adminDescription || materialsDescription || laborDescription)) {
      const prompt = `You are writing invoice descriptions for a high-end residential renovation company (Brett King Builder-Contractor). Rewrite each section's bullet-point description to be professional, client-facing, and easy to read. Keep bullet points but make each one a polished 1-line description. Do not add items that aren't there. Be concise. Do not use markdown headers (#). For emphasis use single *asterisks* not double **asterisks**.

IMPORTANT for MATERIAL ITEMS: Do NOT include tools, consumables, or supplies purchased for the crew to do the work. Omit items like work gloves, batteries, electrical cords, extension cords, blades, drill bits, tape, rags, trash bags, safety glasses, dust masks, and similar job-site consumables. Only describe materials that become part of the finished project (lumber, tile, fixtures, hardware, paint, drywall, etc.). If all material items are tools/consumables, return an empty string for that key.

PERMIT & ADMIN ITEMS:
${adminDescription || '(none)'}

MATERIAL ITEMS:
${materialsDescription || '(none)'}

LABOR NOTES (from time entries â describe the work performed):
${laborDescription || '(none)'}

Respond in this exact JSON format:
{"admin": "• bullet1\\n• bullet2", "materials": "• bullet1\\n• bullet2", "labor": "• bullet1\\n• bullet2"}

If a section is "(none)", return empty string for that key.`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        const aiText = aiData.content?.[0]?.text || '';
        try {
          // Extract JSON from response (may be wrapped in markdown code block)
          const jsonMatch = aiText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const rewritten = JSON.parse(jsonMatch[0]);
            if (rewritten.admin) rewritten.admin = sanitizeAiDescription(rewritten.admin);
            if (rewritten.materials) rewritten.materials = sanitizeAiDescription(rewritten.materials);
            if (rewritten.labor) rewritten.labor = sanitizeAiDescription(rewritten.labor);
            if (isValidAiDescription(rewritten.admin) && adminDescription && adminGroup) {
              await updateJTCostGroup(adminGroup.id, { description: rewritten.admin });
            }
            if (isValidAiDescription(rewritten.materials) && materialsDescription && materialsGroup) {
              await updateJTCostGroup(materialsGroup.id, { description: rewritten.materials });
            }
            if (isValidAiDescription(rewritten.labor) && laborDescription && laborGroup) {
              await updateJTCostGroup(laborGroup.id, { description: rewritten.labor });
            }
          }
        } catch (parseErr) {
          console.warn('[reorganize] AI rewrite JSON parse failed, keeping original descriptions');
        }
      }
    }
  } catch (aiErr: any) {
    console.warn('[reorganize] AI rewrite failed, keeping original descriptions:', aiErr.message);
  }

  // Prepend labor date range header to the BKB Labor group description
  // invoiceDates contains YYYY-MM-DD strings for each "Time Cost for [date]" group
  if (laborGroup && invoiceDates.size > 0) {
    const sortedDates = Array.from(invoiceDates).sort();
    const firstDate = new Date(sortedDates[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const lastDate = new Date(sortedDates[sortedDates.length - 1] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const dateHeader = firstDate === lastDate ? `Labor dates: ${firstDate}` : `Labor dates: ${firstDate} \u2013 ${lastDate}`;

    // Re-read the current description (may have been AI-rewritten) and prepend date header
    const currentGroup = await pave({ costGroup: { $: { id: laborGroup.id }, description: {} } });
    const currentDesc = ((currentGroup as any)?.costGroup?.description || '').trim();
    const finalDesc = currentDesc ? `${dateHeader}\n\n${currentDesc}` : dateHeader;
    await updateJTCostGroup(laborGroup.id, { description: finalDesc });
  }

  return {
    success: true,
    groupCount: adminBills.length + materialBills.length + timeGroups.length + (adminGroup ? 1 : 0) + (materialsGroup ? 1 : 0) + (laborGroup ? 1 : 0),
    laborDescription,
    materialsDescription,
    adminDescription,
  };
}

// ============================================================
// Job Activity Summary — for Estimating Tracker
// Fetches recent activity + upcoming tasks for a single job
// ============================================================

export interface ActivityItem {
  type: 'comment' | 'daily_log' | 'task_completed' | 'document';
  date: string;       // ISO date string
  description: string; // Human-readable summary
}

export interface JobActivitySummary {
  lastActivity: ActivityItem | null;
  nextTask: { id: string; name: string; endDate: string | null } | null;
  hasUpcomingTasks: boolean;
  daysSinceActivity: number | null;
}

export async function getJobActivitySummary(jobId: string): Promise<JobActivitySummary> {
  const now = new Date();

  // Fetch all data sources in parallel (with error tolerance)
  const [comments, dailyLogs, tasks, documents] = await Promise.all([
    getCommentsForTarget(jobId, 'job', 10).catch(() => [] as JTComment[]),
    getDailyLogsForJob(jobId, 10).catch(() => [] as JTDailyLog[]),
    getTasksForJob(jobId).catch(() => [] as JTTask[]),
    getDocumentsForJob(jobId).catch(() => [] as JTDocument[]),
  ]);

  // Build unified activity list
  const activities: ActivityItem[] = [];

  // Comments (filter out system/AR-AUTO tags)
  for (const c of comments) {
    if (c.message?.includes('[AR-AUTO]') || c.message?.includes('[AR-HOLD]')) continue;
    activities.push({
      type: 'comment',
      date: c.createdAt,
      description: `Comment: ${(c.message || '').slice(0, 80)}${(c.message || '').length > 80 ? '…' : ''}`,
    });
  }

  // Daily logs
  for (const dl of dailyLogs) {
    activities.push({
      type: 'daily_log',
      date: dl.createdAt || dl.date,
      description: `Daily log: ${(dl.notes || '').slice(0, 80)}${(dl.notes || '').length > 80 ? '…' : ''}`,
    });
  }

  // Completed tasks (progress === 1)
  for (const t of tasks) {
    if (t.progress === 1 && t.endDate) {
      activities.push({
        type: 'task_completed',
        date: t.endDate,
        description: `Completed: ${t.name}`,
      });
    }
  }

  // Documents with notable statuses
  for (const d of documents) {
    if (d.status === 'approved' && d.signedAt) {
      activities.push({
        type: 'document',
        date: d.signedAt,
        description: `${d.type === 'customerOrder' ? 'Estimate' : d.type === 'customerInvoice' ? 'Invoice' : 'Document'} approved: ${d.name || d.number}`,
      });
    } else if (d.status === 'pending' && d.issueDate) {
      activities.push({
        type: 'document',
        date: d.issueDate,
        description: `${d.type === 'customerOrder' ? 'Estimate' : 'Document'} sent: ${d.name || d.number}`,
      });
    } else if (d.status === 'draft' && d.createdAt) {
      activities.push({
        type: 'document',
        date: d.createdAt,
        description: `Draft created: ${d.name || d.number}`,
      });
    }
  }

  // Sort by date descending → most recent first
  activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const lastActivity = activities[0] || null;
  const daysSinceActivity = lastActivity
    ? Math.floor((now.getTime() - new Date(lastActivity.date).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Find next upcoming uncompleted task (sorted by endDate ascending)
  const upcomingTasks = tasks
    .filter((t) => t.progress < 1 && t.endDate)
    .sort((a, b) => new Date(a.endDate!).getTime() - new Date(b.endDate!).getTime());

  const nextTask = upcomingTasks[0]
    ? { id: upcomingTasks[0].id, name: upcomingTasks[0].name, endDate: upcomingTasks[0].endDate }
    : null;

  const hasUpcomingTasks = upcomingTasks.length > 0;

  return { lastActivity, nextTask, hasUpcomingTasks, daysSinceActivity };
}

// ============================================================
// BILL CATEGORIZATION SCANNER
//
// Support for the daily bill-categorization agent (4am cron).
// Helpers to:
//   - pull every vendor bill line on a job with vendor + budget
//     link info in one shot
//   - pull the job's approved budget items (the valid targets)
//   - update a bill line's budget link + cost code when Nathan
//     approves a match from the review card
//
// The line shape is deliberately flat so the matcher module can
// stay dumb about PAVE query shapes.
// ============================================================

export interface JobBillLine {
  /** JT cost item id on the vendor bill */
  costItemId: string;
  lineName: string | null;
  lineDescription: string | null;
  cost: number;
  quantity: number;

  /** Cost code that was stamped on the line itself */
  lineCostCodeId: string | null;
  lineCostCodeNumber: string | null;
  lineCostCodeName: string | null;

  /** Budget bucket the line is linked to (null = orphan / uncategorized) */
  jobCostItemId: string | null;
  budgetCostCodeId: string | null;
  budgetCostCodeNumber: string | null;
  budgetCostCodeName: string | null;
  budgetItemName: string | null;

  /** Document (vendor bill) context */
  documentId: string;
  documentNumber: string | null;
  documentName: string | null;
  documentStatus: string | null;
  documentIssueDate: string | null;

  /** Vendor context (from the issuing organization) */
  vendorAccountId: string | null;
  vendorName: string | null;
}

/**
 * Return every line on every vendor bill for a job, flat, with vendor
 * and budget-link info attached.
 *
 * Uses a small page size (10 documents per page) because each document
 * expansion can balloon quickly and 413s are the common failure mode.
 */
export async function getJobBillLines(jobId: string): Promise<JobBillLine[]> {
  const PAGE_SIZE = 10;
  const out: JobBillLine[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 30; page++) {
    const pageParams: Record<string, unknown> = {
      size: PAGE_SIZE,
      where: ['type', '=', 'vendorBill'],
    };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        documents: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            number: {},
            name: {},
            status: {},
            issueDate: {},
            // Vendor is the "issuer" account on the bill
            issuer: {
              account: { id: {}, name: {} },
            },
            costItems: {
              $: { size: 50 },
              nodes: {
                id: {},
                name: {},
                description: {},
                quantity: {},
                cost: {},
                costCode: { id: {}, number: {}, name: {} },
                jobCostItem: {
                  id: {},
                  name: {},
                  costCode: { id: {}, number: {}, name: {} },
                },
              },
            },
          },
        },
      },
    });

    const docsPage = (data as any)?.job?.documents;
    const docs = docsPage?.nodes || [];

    for (const doc of docs) {
      // Skip denied / voided bills — they shouldn't drive review queue noise
      if (doc.status === 'denied') continue;

      const vendorAcct = doc?.issuer?.account || null;
      const items = doc?.costItems?.nodes || [];

      for (const item of items) {
        out.push({
          costItemId: item.id,
          lineName: item.name || null,
          lineDescription: item.description || null,
          cost: Number(item.cost) || 0,
          quantity: Number(item.quantity) || 0,
          lineCostCodeId: item.costCode?.id || null,
          lineCostCodeNumber: item.costCode?.number || null,
          lineCostCodeName: item.costCode?.name || null,
          jobCostItemId: item.jobCostItem?.id || null,
          budgetCostCodeId: item.jobCostItem?.costCode?.id || null,
          budgetCostCodeNumber: item.jobCostItem?.costCode?.number || null,
          budgetCostCodeName: item.jobCostItem?.costCode?.name || null,
          budgetItemName: item.jobCostItem?.name || null,
          documentId: doc.id,
          documentNumber: doc.number != null ? String(doc.number) : null,
          documentName: doc.name || null,
          documentStatus: doc.status || null,
          documentIssueDate: doc.issueDate || null,
          vendorAccountId: vendorAcct?.id || null,
          vendorName: vendorAcct?.name || null,
        });
      }
    }

    nextPage = docsPage?.nextPage || null;
    if (!nextPage || docs.length < PAGE_SIZE) break;
  }

  return out;
}

export interface JobBudgetItem {
  id: string;                        // jobCostItem id (target for bill links)
  name: string | null;
  description: string | null;
  costCodeId: string | null;
  costCodeNumber: string | null;     // "1002", "1902", etc
  costCodeName: string | null;
  costTypeName: string | null;
  cost: number;                      // approved budget amount
  isSpecification: boolean | null;
}

/**
 * Return the approved budget items for a job. These are job-level cost
 * items where `document` is null (as opposed to document-level items
 * that live on bills or invoices). They are the valid targets for
 * linking a bill line.
 */
export async function getJobBudgetItems(jobId: string): Promise<JobBudgetItem[]> {
  const PAGE_SIZE = 50;
  const out: JobBudgetItem[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 20; page++) {
    const pageParams: Record<string, unknown> = { size: PAGE_SIZE };
    if (nextPage) pageParams.page = nextPage;

    const data = await pave({
      job: {
        $: { id: jobId },
        costItems: {
          $: pageParams,
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            cost: {},
            isSpecification: {},
            costCode: { id: {}, number: {}, name: {} },
            costType: { id: {}, name: {} },
            document: { id: {} },
          },
        },
      },
    });

    const costItemPage = (data as any)?.job?.costItems;
    const nodes = costItemPage?.nodes || [];

    for (const node of nodes) {
      // Only job-level (budget) items — skip any that are doc-scoped.
      if (node.document && node.document.id) continue;
      out.push({
        id: node.id,
        name: node.name || null,
        description: node.description || null,
        costCodeId: node.costCode?.id || null,
        costCodeNumber: node.costCode?.number || null,
        costCodeName: node.costCode?.name || null,
        costTypeName: node.costType?.name || null,
        cost: Number(node.cost) || 0,
        isSpecification: node.isSpecification ?? null,
      });
    }

    nextPage = costItemPage?.nextPage || null;
    if (!nextPage || nodes.length < PAGE_SIZE) break;
  }

  return out;
}

/**
 * Update a document cost item (typically a vendor-bill line) to point
 * at a different budget bucket and/or cost code. Used by the review
 * API when Nathan approves a suggestion.
 *
 * Fields are all optional — pass only what you want to change.
 */
export async function updateDocumentCostItem(
  costItemId: string,
  fields: {
    jobCostItemId?: string | null;
    costCodeId?: string | null;
    name?: string;
    description?: string;
  }
): Promise<{ id: string; name: string | null }> {
  const params: Record<string, unknown> = { id: costItemId };
  if (fields.jobCostItemId !== undefined) params.jobCostItemId = fields.jobCostItemId;
  if (fields.costCodeId !== undefined) params.costCodeId = fields.costCodeId;
  if (fields.name !== undefined) params.name = fields.name;
  if (fields.description !== undefined) params.description = fields.description;

  const data = await pave({
    updateCostItem: {
      $: params,
      updatedCostItem: {
        id: {},
        name: {},
      },
    },
  });

  const updated = (data as any)?.updateCostItem?.updatedCostItem;
  if (!updated?.id) {
    throw new Error('updateCostItem failed: ' + JSON.stringify(data));
  }
  return { id: updated.id, name: updated.name || null };
}

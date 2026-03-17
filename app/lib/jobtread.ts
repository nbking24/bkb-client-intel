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
// - Can't filter tasks by assignedMemberships at org level — fetch all, filter client-side
// - Custom field values: job.customFieldValues { customField { name } value }
// ============================================================

import { getStatusCategory, STANDARD_PHASES, type StatusCategoryKey } from './constants';
import { BKB_STANDARD_TEMPLATE, recommendPhaseForTask, type PhaseTemplate } from './schedule-templates';

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';
const JT_ORG = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';

// -- Core PAVE query helper --
async function pave(query: Record<string, unknown>) {
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
    throw new Error(`JT PAVE error: invalid JSON — ${text.slice(0, 200)}`);
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

export async function getActiveJobs(limit = 50): Promise<JTJob[]> {
  const result = await orgQuery('jobs', {
    $: {
      size: limit,
      where: ['closedOn', '=', null],
    },
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
  });
  const jobs = result.nodes || [];
  return jobs.map((j: any) => {
    // Extract the custom "Status" field value
    const statusField = (j.customFieldValues?.nodes || []).find(
      (cfv: any) => cfv.customField?.name === 'Status'
    );
    const customStatus = statusField?.value || null;
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

// Get all open tasks across all active jobs (for Nathan's team workload view)
export async function getAllOpenTasks(): Promise<JTTask[]> {
  const result = await orgQuery('tasks', {
    $: {
      size: 50,
      where: ['progress', '<', 1],
    },
    nodes: {
      id: {},
      name: {},
      startDate: {},
      endDate: {},
      progress: {},
      job: { id: {}, name: {} },
      assignedMemberships: {
        nodes: {
          id: {},
          user: { id: {}, name: {} },
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
// SCHEDULE — Powers the Pre-Construction Tracker
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
  orphanTasks: JTScheduleTask[];   // Tasks with no parent phase — must be visible!
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

  // 5. ORPHAN DETECTION — tasks that have no parent AND are not groups
  //    These were silently dropped before. Now we return them explicitly.
  const phaseIds = new Set(phases.map((p) => p.id));
  const orphanTasks: JTScheduleTask[] = allTasks
    .filter((t: any) => {
      // Not a group, and either:
      // - has no parentTask at all, OR
      // - has a parentTask that doesn't exist in our task map (deleted parent)
      if (t.isGroup) return false;
      if (!t.parentTask) return true;   // no parent at all — orphan
      if (!taskMap.has(t.parentTask.id)) return true;  // parent doesn't exist — orphan
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

  // 2. Get all task groups across org (lightweight — no childTasks to avoid 413)
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

// General task update — change name, dates, description, progress, etc.
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
        // No existing dates — treat as 1-day task
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
// TEMPLATE APPLICATION — Apply standard BKB schedule to a job
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
            // For now, just create tasks without dates — Evan will set them
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
// SCHEDULE AUDIT — Analyze ALL active jobs for misplaced tasks
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
  signedAt: string | null;
  job: { id: string; name: string };
}

export async function getDocumentsForJob(jobId: string): Promise<JTDocument[]> {
  const data = await pave({
    job: {
      $: { id: jobId },
      documents: {
        $: { size: 100 },
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
          createdAt: {},
          signedAt: {},
        },
      },
    },
  });
  const docs = (data as any)?.job?.documents?.nodes || [];
  return docs.map((d: any) => ({ ...d, job: { id: jobId, name: '' } }));
}

/**
 * Lightweight query: get just document IDs, names, and statuses for a job.
 * Much smaller payload than getDocumentsForJob — used for filtering cost items by approval status.
 */
export async function getDocumentStatusesForJob(jobId: string): Promise<Array<{ id: string; name: string; number: string; status: string; type: string }>> {
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
// DOCUMENT CONTENT — Read line items inside a document
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
// GRID VIEW — Pre-construction dashboard data
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
// DAILY LOGS — Job-level daily log entries
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
    // Sub-collection not supported — fall through
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
    // Org-level with where failed — try without where and filter client-side
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

// Daily Log Type custom field ID — required by BKB's JobTread configuration.
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
// COMMENTS — Comments on any JobTread entity
// ============================================================

export interface JTComment {
  id: string;
  message: string;
  name: string;
  createdAt: string;
  isPinned: boolean;
  parentComment?: { id: string } | null;
}

export async function getCommentsForTarget(targetId: string, targetType: string, limit = 200): Promise<JTComment[]> {
  // Paginate to get all comments (default limit raised to 200, supports multi-page fetching)
  // Try querying comments through the parent entity first
  // targetType can be: job, task, document, costItem, etc.

  const commentFields = {
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
            nodes: commentFields,
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

    if (allComments.length > 0) {
      // Sort by createdAt descending (newest first) to ensure recent comments are included
      allComments.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      return allComments.slice(0, limit);
    }
  } catch (_err: any) {
    // Fall through to org-level query
  }

  // Strategy 2: Fallback — query through organization with targetId filter, with pagination
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
          nodes: commentFields,
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
// TIME ENTRIES — Track labor hours
// ============================================================

export interface JTTimeEntry {
  id: string;
  startedAt: string;
  endedAt: string;
  notes: string;
  type: string;
  user?: { id: string; name: string };
  costItem?: { id: string; name: string; costCode?: { number: string; name: string } | null } | null;
}

export async function getTimeEntriesForJob(jobId: string, limit = 100): Promise<JTTimeEntry[]> {
  const teFields = {
    nodes: {
      id: {},
      startedAt: {},
      endedAt: {},
      notes: {},
      type: {},
      user: { id: {}, name: {} },
      costItem: { id: {}, name: {}, costCode: { number: {}, name: {} } },
    },
  };

  // Strategy 1: Try job.timeEntries sub-collection
  try {
    const data = await pave({
      job: {
        $: { id: jobId },
        timeEntries: {
          $: { size: limit },
          ...teFields,
        },
      },
    });
    const entries = (data as any)?.job?.timeEntries?.nodes;
    if (entries && Array.isArray(entries)) return entries;
  } catch (_err: any) {
    // Sub-collection not supported — fall through
  }

  // Strategy 2: Organization-level with where filter
  try {
    const data = await pave({
      organization: {
        $: { id: JT_ORG() },
        timeEntries: {
          $: { size: limit, where: ['jobId', '=', jobId] },
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
// JOB UPDATES — Modify job details
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
  /** Extended cost (qty × unitCost, or accumulated from time entries) */
  cost: number;
  /** Extended price (qty × unitPrice, or accumulated from time entries) */
  price: number;
  isSpecification: boolean;
  costType?: { id: string; name: string } | null;
  costCode?: { id: string; name: string; number: string } | null;
  costGroup?: { id: string; name: string; description?: string; files?: JTCostItemFile[]; parentCostGroup?: { id: string; name: string; description?: string; files?: JTCostItemFile[] } | null } | null;
  files?: JTCostItemFile[];
  // Document association: null = Estimating, otherwise attached to a proposal/invoice
  document?: { id: string; name: string; type: string } | null;
  // Custom fields (Status, Internal Notes, Vendor)
  status?: string | null;
  internalNotes?: string | null;
  vendor?: string | null;
}

/**
 * Lightweight cost item fetch for invoicing — only the fields needed
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
            document: { id: {}, name: {}, type: {} },
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
  const PAGE_SIZE = 50; // keep document page small to avoid 413
  let allItems: JTCostItem[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 5; page++) {
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
          document: { id: doc.id, name: '', type: doc.type },
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
        },
      },
    },
  });

  const items = (data as any)?.document?.costItems?.nodes || [];
  return items as JTCostItem[];
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
// COST GROUPS — Hierarchy & Updates (for Contract Spec Writer)
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
    // Sub-collection not supported — fall through
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
// EXPANDED TASK UPDATE — More fields from PAVE API
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
// GRID VIEW — Pre-construction dashboard data
// Returns per-phase task counts for each active job
// ============================================================

export async function getGridScheduleData(): Promise<GridJobData[]> {
  const jobs = await getActiveJobs(50);

  // Fetch tasks PER JOB in batches (avoids 100-task org-wide limit)
  // Old approach fetched only 100 tasks across ALL jobs — most projects got zero
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
// These read ONLY from the Supabase database — never from the
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

    // Database empty for this job — fall back to live API as one-time bootstrap
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
// DOCUMENT CREATION — PAVE mutations for creating invoices
// ============================================================

/**
 * Create a document shell (invoice, estimate, PO, etc.) on a job.
 * Returns the created document ID and metadata.
 */
async function createJTDocument(params: {
  jobId: string;
  type: 'customerInvoice' | 'customerOrder' | 'vendorOrder' | 'vendorBill' | 'bidRequest';
  name: string;  // Must be one of: "Deposit", "Invoice", "Progress Invoice"
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
    jobId, type, name, fromName, toName, toAddress, taxRate,
    jobLocationName, jobLocationAddress, dueDays,
    subject, description, footer,
  } = params;
  const data = await pave({
    createDocument: {
      $: {
        jobId,
        type,
        name,
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
      },
      createdDocument: {
        id: {},
        name: {},
        number: {},
        status: {},
        type: {},
      },
    },
  });
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
  jobCostItemId?: string;  // Required for customer invoices — links to original budget item
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
export async function createDraftCostPlusInvoice(jobId: string): Promise<{
  documentId: string;
  documentName: string;
  documentNumber: string;
  itemCount: number;
  totalCost: number;
  totalPrice: number;
}> {
  // 1. Get job details including location for customer name, address, and job number
  const jobData = await pave({
    job: {
      $: { id: jobId },
      id: {}, name: {}, number: {},
      location: {
        id: {}, name: {}, address: {},
        account: { id: {}, name: {} },
      },
    },
  });
  const job = (jobData as any)?.job;
  if (!job) throw new Error('Job not found: ' + jobId);

  const customerName = job.location?.account?.name || 'Client';
  const jobNumber = job.number || '';
  const locationName = job.location?.name || '';
  const locationAddress = job.location?.address || locationName;

  // 2. Get all budget cost items — use lean paginated query to avoid 413 errors
  const PAGE_SIZE = 30;
  let allUnbilled: any[] = [];
  let nextPage: string | null = null;

  for (let page = 0; page < 30; page++) {
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
            costType: { id: {}, name: {} },
            costCode: { id: {}, name: {}, number: {} },
            costGroup: { id: {}, name: {}, description: {} },
            document: { id: {} },
          },
        },
      },
    });

    const costItemPage = (data as any)?.job?.costItems;
    const nodes = costItemPage?.nodes || [];
    // Only keep unbilled items (not on any document)
    for (const node of nodes) {
      if (!node.document) {
        allUnbilled.push(node);
      }
    }
    nextPage = costItemPage?.nextPage || null;
    if (!nextPage || nodes.length < PAGE_SIZE) break;
  }

  // 3. Filter to unbilled items that have actual costs or prices (exclude $0.00 placeholders)
  const unbilledItems = allUnbilled.filter((item) => {
    const cost = item.cost ?? 0;
    const price = item.price ?? 0;
    const unitCost = item.unitCost ?? 0;
    const unitPrice = item.unitPrice ?? 0;
    return cost !== 0 || price !== 0 || unitCost !== 0 || unitPrice !== 0;
  });

  if (unbilledItems.length === 0) {
    throw new Error('No billable cost items found for this job. All unbilled items have $0.00 values.');
  }

  // 4. Categorize items by cost type for grouping on the invoice
  // Matches the BKB pattern from Invoice 199-15: Permit & Admin, Materials, BKB Labor
  // Order: Materials first, then Admin, Subcontractor, Other, and Labor last
  type CategoryKey = 'admin' | 'materials' | 'labor' | 'subcontractor' | 'other';
  const categoryOrder: CategoryKey[] = ['materials', 'admin', 'subcontractor', 'other', 'labor'];
  const categoryNames: Record<CategoryKey, string> = {
    admin: 'Permit & Admin Costs',
    materials: 'Materials',
    labor: 'BKB Labor',
    subcontractor: 'Subcontractor Costs',
    other: 'Other Costs',
  };

  const categorized: Record<CategoryKey, typeof unbilledItems> = {
    admin: [],
    materials: [],
    labor: [],
    subcontractor: [],
    other: [],
  };

  for (const item of unbilledItems) {
    const costTypeName = (item.costType?.name || '').toLowerCase();
    const costCodeNum = parseInt(item.costCode?.number || '0', 10);

    // Categorize based on cost type name and cost code patterns
    if (costTypeName.includes('labor') || costCodeNum === 1 || costCodeNum === 2 || costCodeNum === 3) {
      categorized.labor.push(item);
    } else if (costTypeName.includes('material')) {
      categorized.materials.push(item);
    } else if (costTypeName.includes('subcontract')) {
      categorized.subcontractor.push(item);
    } else if (costCodeNum === 20 || costCodeNum === 21 || costCodeNum === 22) {
      // Cost codes 20-22: Permits, Insurance, Project Management
      categorized.admin.push(item);
    } else {
      categorized.other.push(item);
    }
  }

  // 5. Create the document shell
  // name must be one of: "Deposit", "Invoice", "Progress Invoice"
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
    subject: `Cost Plus Invoice - ${job.name}`,
    description: 'This invoice reflects charges under a Cost Plus Fee agreement. You are billed for all actual project costs—including materials, subcontractors, labor, insurance, and permits - plus a 25% contractor\'s fee applied to those costs. Labor is billed at $115/hr (Master Craftsman) or $55/hr (Journeyman/Administrative).',
  });

  // 6. Create cost groups and items on the document
  let totalCost = 0;
  let totalPrice = 0;
  let createdItemCount = 0;

  // Helper: build a short description for material items matching Behmlander invoice pattern
  // e.g. "03-Concrete, Stone/Block Work:0303 - Materials" from cost code name + group context
  function buildItemDescription(item: any, category: CategoryKey): string | undefined {
    // If item already has a description, use it
    if (item.description) return item.description;
    // For materials, build a description from cost code info
    if (category === 'materials') {
      const codeName = item.costCode?.name;
      const codeNum = item.costCode?.number;
      if (codeName && codeNum) {
        return `${codeNum}-${codeName}`;
      }
      if (codeName) return codeName;
    }
    return undefined;
  }

  // Iterate categories in explicit order: Materials first, Labor last
  for (const category of categoryOrder) {
    const items = categorized[category];
    if (items.length === 0) continue;

    // Create top-level category group on the document
    const categoryGroup = await createJTCostGroup({
      documentId: doc.id,
      name: categoryNames[category],
    });

    // Group items by their budget cost group name (sub-grouping)
    const subGroups: Record<string, typeof items> = {};
    const ungrouped: typeof items = [];

    for (const item of items) {
      const groupName = item.costGroup?.name;
      if (groupName) {
        if (!subGroups[groupName]) subGroups[groupName] = [];
        subGroups[groupName].push(item);
      } else {
        ungrouped.push(item);
      }
    }

    // Create sub-groups and their items
    for (const [subGroupName, subItems] of Object.entries(subGroups)) {
      const subGroup = await createJTCostGroup({
        parentCostGroupId: categoryGroup.id,
        name: subGroupName,
        description: subItems[0]?.costGroup?.description || undefined,
      });

      for (const item of subItems) {
        await createJTCostItem({
          costGroupId: subGroup.id,
          name: item.name,
          description: buildItemDescription(item, category),
          costCodeId: item.costCode?.id || undefined,
          costTypeId: item.costType?.id || undefined,
          jobCostItemId: item.id,  // Link to original budget item
          quantity: item.quantity ?? 1,
          unitCost: item.unitCost ?? 0,
          unitPrice: item.unitPrice ?? 0,
        });
        totalCost += (item.cost ?? 0);
        totalPrice += (item.price ?? 0);
        createdItemCount++;
      }
    }

    // Add ungrouped items directly under the category
    for (const item of ungrouped) {
      await createJTCostItem({
        costGroupId: categoryGroup.id,
        name: item.name,
        description: buildItemDescription(item, category),
        costCodeId: item.costCode?.id || undefined,
        costTypeId: item.costType?.id || undefined,
        jobCostItemId: item.id,  // Link to original budget item
        quantity: item.quantity ?? 1,
        unitCost: item.unitCost ?? 0,
        unitPrice: item.unitPrice ?? 0,
      });
      totalCost += (item.cost ?? 0);
      totalPrice += (item.price ?? 0);
      createdItemCount++;
    }
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
// Fixed-Price / Contract Billable Invoice Creation
// ============================================================

/**
 * Create a draft customer invoice for a fixed-price (contract) job containing:
 * 1. CC23 (Billable) material & subcontractor costs from vendor bills not yet on customer invoices
 * 2. CC23 (Billable) labor hours from time entries not yet billed
 *
 * This mirrors the cost-plus invoice creation but uses the CC23 billable item logic
 * from invoicing-health.ts to identify what needs to be invoiced.
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
  const BILLABLE_COST_TYPE_NAMES = ['Materials', 'Subcontractor'];

  // 1. Get job details including location for customer name, address
  const jobData = await pave({
    job: {
      $: { id: jobId },
      id: {}, name: {}, number: {},
      location: {
        id: {}, name: {}, address: {},
        account: { id: {}, name: {} },
      },
    },
  });
  const job = (jobData as any)?.job;
  if (!job) throw new Error('Job not found: ' + jobId);

  const customerName = job.location?.account?.name || 'Client';
  const locationName = job.location?.name || '';
  const locationAddress = job.location?.address || locationName;

  // 2. Get all documents for the job to identify vendor bills and customer invoices
  const docsData = await pave({
    job: {
      $: { id: jobId },
      documents: {
        $: { size: 50 },
        nodes: { id: {}, name: {}, type: {}, status: {}, number: {} },
      },
    },
  });
  const allDocs = (docsData as any)?.job?.documents?.nodes || [];
  const vendorBills = allDocs.filter(
    (d: any) => d.type === 'vendorBill' && d.status !== 'denied'
  );
  const customerInvoices = allDocs.filter(
    (d: any) => d.type === 'customerInvoice' && d.status !== 'draft'
  );

  // 3. Get CC23 items from vendor bills (costs incurred)
  // These items reference budget items via jobCostItemId
  const vendorBillItemResults = await Promise.all(
    vendorBills.map(async (doc: any) => {
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
                jobCostItem: { id: {} },
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
  const allVendorBillItems = vendorBillItemResults.flat();
  const cc23VendorBillItems = allVendorBillItems.filter(
    (item: any) => item.costCode?.number === BILLABLE_COST_CODE_NUMBER
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
                jobCostItem: { id: {} },
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
    (item: any) => item.costCode?.number === BILLABLE_COST_CODE_NUMBER
  );

  // Build a set of budget item IDs already billed on customer invoices
  const billedBudgetItemIds = new Set<string>();
  for (const item of cc23InvoicedItems) {
    if (item.jobCostItem?.id) {
      billedBudgetItemIds.add(item.jobCostItem.id);
    }
  }

  // 5. Filter to uninvoiced CC23 vendor bill items
  // An item is uninvoiced if its linked budget item (jobCostItem) hasn't appeared on a customer invoice
  const uninvoicedCC23Items = cc23VendorBillItems.filter((item: any) => {
    const budgetItemId = item.jobCostItem?.id;
    if (!budgetItemId) return true;  // If no budget link, include it (conservative)
    return !billedBudgetItemIds.has(budgetItemId);
  });

  // Separate into materials/subs and other CC23 items
  const uninvoicedMaterialsSubs = uninvoicedCC23Items.filter(
    (item: any) => BILLABLE_COST_TYPE_NAMES.includes(item.costType?.name ?? '')
  );

  // 6. Calculate unbilled CC23 labor hours from time entries
  const teData = await pave({
    job: {
      $: { id: jobId },
      timeEntries: {
        $: { size: 200 },
        nodes: {
          id: {}, startedAt: {}, endedAt: {}, notes: {}, type: {},
          user: { name: {} },
          costItem: { id: {}, name: {}, costCode: { number: {} } },
        },
      },
    },
  });
  const timeEntries = (teData as any)?.job?.timeEntries?.nodes || [];
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

  // 8. Create the document shell
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
    subject: `Billable Items Invoice - ${job.name}`,
    description: 'This invoice covers billable items and labor hours incurred on this project.',
  });

  let totalCost = 0;
  let totalPrice = 0;
  let createdItemCount = 0;

  // 9. Create materials/subs group with items (if any)
  if (uninvoicedMaterialsSubs.length > 0) {
    const materialsGroup = await createJTCostGroup({
      documentId: doc.id,
      name: 'Billable Materials & Subcontractors',
    });

    // Sub-group by vendor bill source for clarity
    const byVendorBill: Record<string, any[]> = {};
    const ungrouped: any[] = [];

    for (const item of uninvoicedMaterialsSubs) {
      const billName = item.sourceDoc
        ? `${item.sourceDoc.name} #${item.sourceDoc.number}`
        : null;
      if (billName) {
        if (!byVendorBill[billName]) byVendorBill[billName] = [];
        byVendorBill[billName].push(item);
      } else {
        ungrouped.push(item);
      }
    }

    // Create sub-groups per vendor bill
    for (const [billName, items] of Object.entries(byVendorBill)) {
      const subGroup = await createJTCostGroup({
        parentCostGroupId: materialsGroup.id,
        name: billName,
      });

      for (const item of items) {
        const description = item.costCode?.name
          ? `${item.costCode.number}-${item.costCode.name}`
          : undefined;

        await createJTCostItem({
          costGroupId: subGroup.id,
          name: item.name,
          description,
          costCodeId: item.costCode?.id || undefined,
          costTypeId: item.costType?.id || undefined,
          jobCostItemId: item.jobCostItem?.id || undefined,
          quantity: item.quantity ?? 1,
          unitCost: item.unitCost ?? 0,
          unitPrice: item.unitPrice ?? 0,
        });
        totalCost += (item.cost ?? 0);
        totalPrice += (item.price ?? 0);
        createdItemCount++;
      }
    }

    // Add ungrouped items directly under materials group
    for (const item of ungrouped) {
      await createJTCostItem({
        costGroupId: materialsGroup.id,
        name: item.name,
        description: item.costCode?.name
          ? `${item.costCode.number}-${item.costCode.name}`
          : undefined,
        costCodeId: item.costCode?.id || undefined,
        costTypeId: item.costType?.id || undefined,
        jobCostItemId: item.jobCostItem?.id || undefined,
        quantity: item.quantity ?? 1,
        unitCost: item.unitCost ?? 0,
        unitPrice: item.unitPrice ?? 0,
      });
      totalCost += (item.cost ?? 0);
      totalPrice += (item.price ?? 0);
      createdItemCount++;
    }
  }

  // 10. Create labor group with hours (if any)
  if (unbilledLaborHours >= 0.1) {
    const laborGroup = await createJTCostGroup({
      documentId: doc.id,
      name: 'BKB Billable Labor',
    });

    const roundedHours = Math.round(unbilledLaborHours * 100) / 100;

    // Build a summary of who worked (for the description)
    const workerHours: Record<string, number> = {};
    for (const entry of cc23TimeEntries) {
      const name = entry.user?.name || 'Unknown';
      if (entry.startedAt && entry.endedAt) {
        const hours = (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 3600000;
        workerHours[name] = (workerHours[name] || 0) + hours;
      }
    }
    const laborDescription = Object.entries(workerHours)
      .map(([name, hours]) => `${name}: ${Math.round(hours * 10) / 10}h`)
      .join(', ');

    // Use standard BKB billable labor rate: $85/hr cost, $115/hr price
    const laborUnitCost = 85;
    const laborUnitPrice = 115;

    await createJTCostItem({
      costGroupId: laborGroup.id,
      name: '23 Billable Labor',
      description: laborDescription || undefined,
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

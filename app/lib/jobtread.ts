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
  // Lightweight query — omit description & assignedMemberships to avoid 413
  const data = await pave({
    job: {
      $: { id: jobId },
      tasks: {
        $: { size: 50 },
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
  const tasks = (data as any)?.job?.tasks?.nodes || [];
  return tasks.map((t: any) => ({ ...t, job: { id: jobId, name: '' } }));
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
      size: 100,
      where: ['progress', '<', 100],
    },
    nodes: {
      id: {},
      name: {},
      description: {},
      startDate: {},
      endDate: {},
      progress: {},
      job: { id: {}, name: {} },
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
  const { jobId, name, description, startDate, endDate, assignedMembershipIds } = params;
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

  // 2. Flat list of tasks for this job — minimal fields to avoid 413
  const taskData = await pave({
    job: {
      $: { id: jobId },
      tasks: {
        $: { size: 50 },
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

  const allTasks = ((taskData as any)?.job?.tasks?.nodes || []) as any[];

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
  const { jobId, parentGroupId, name, description, startDate, endDate, assignedMembershipIds } = params;
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
  if (fields.startDate !== undefined) params.startDate = fields.startDate;
  if (fields.endDate !== undefined) params.endDate = fields.endDate;
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
  status: string;
  type: string;
  description: string;
  number: string;
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
          status: {},
          type: {},
          description: {},
          number: {},
          createdAt: {},
          signedAt: {},
        },
      },
    },
  });
  const docs = (data as any)?.job?.documents?.nodes || [];
  return docs.map((d: any) => ({ ...d, job: { id: jobId, name: '' } }));
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

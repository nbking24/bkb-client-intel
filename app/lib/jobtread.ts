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
// ============================================================

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
    return JSON.parse(text);
  } catch {
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
    },
  });
  const jobs = result.nodes || [];
  // Flatten location.account.name into clientName for convenience
  return jobs.map((j: any) => ({
    id: j.id,
    name: j.name,
    number: j.number,
    status: j.status,
    createdAt: j.createdAt,
    closedOn: j.closedOn,
    clientName: j.location?.account?.name || '',
    locationName: j.location?.name || '',
  }));
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
    },
  });
  const job = (data as any)?.job;
  if (!job) return null;
  return {
    ...job,
    clientName: job.location?.account?.name || '',
    locationName: job.location?.name || '',
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
  const data = await pave({
    job: {
      $: { id: jobId },
      tasks: {
        $: { size: 100 },
        nodes: {
          id: {},
          name: {},
          description: {},
          startDate: {},
          endDate: {},
          progress: {},
          assignedMemberships: {
            nodes: {
              id: {},
              user: { id: {}, name: {} },
            },
          },
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
  phases: JTScheduleTask[];
  totalProgress: number;
}

// Get full schedule tree for a single job
export async function getJobSchedule(jobId: string): Promise<JTJobSchedule | null> {
  // Two lightweight queries instead of one deeply-nested query (avoids 413)

  // 1. Job info
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
    },
  });
  const job = (jobData as any)?.job;
  if (!job) return null;

  // 2. Flat list of ALL tasks for this job — minimal fields to avoid 413
  const taskData = await pave({
    job: {
      $: { id: jobId },
      tasks: {
        $: { size: 100 },
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
    phases,
    totalProgress,
  };
}

// Get schedule overview for ALL active jobs (pre-con grid view)
// Uses a lightweight approach: fetches jobs + all org-level task groups in 2 queries
// instead of N parallel per-job queries (which triggers 413 Request Entity Too Large)
export async function getActiveJobSchedules(): Promise<JTJobSchedule[]> {
  // 1. Get active jobs
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
      phases,
      totalProgress,
    };
  });
}

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
export async function createPhaseTask(params: {
  jobId: string;
  parentGroupId: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  assignedMembershipIds?: string[];
}) {
  const { jobId, parentGroupId, name, description, startDate, endDate, assignedMembershipIds } = params;
  const data = await pave({
    createTask: {
      $: {
        targetId: jobId,
        targetType: 'job',
        name,
        parentTaskId: parentGroupId,
        ...(description ? { description } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(assignedMembershipIds?.length ? { assignedMembershipIds } : {}),
      },
      createdTask: { id: {}, name: {}, parentTask: { id: {}, name: {} } },
    },
  });
  const created = (data as any)?.createTask?.createdTask;
  if (!created?.id) throw new Error('Phase task creation failed: ' + JSON.stringify(data));
  return created;
}

// Update task progress (0 = not started, 0.5 = in progress, 1 = complete)
export async function updateTaskProgress(taskId: string, progress: number) {
  await pave({
    updateTask: {
      $: { id: taskId, progress: Math.min(1, Math.max(0, progress)) },
    },
  });
}

// Delete a task (works for both groups and individual tasks)
export async function deleteJTTask(taskId: string) {
  await pave({
    deleteTask: { $: { id: taskId } },
  });
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

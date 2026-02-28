// ============================================================
// JobTread PAVE API Service Layer
// Expanded for BKB Operations Platform
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

  return res.json();
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
  account?: { id: string; name: string };
}

export async function getActiveJobs(limit = 50): Promise<JTJob[]> {
  const result = await orgQuery('jobs', {
    $: {
      size: limit,
      where: [['closedOn', '=', null]],
      sortBy: [['createdAt', 'DESC']],
    },
    nodes: {
      id: {},
      name: {},
      number: {},
      status: {},
      createdAt: {},
      closedOn: {},
      account: { id: {}, name: {} },
    },
  });
  return result.nodes || [];
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
      account: { id: {}, name: {} },
    },
  });
  return (data as any)?.job;
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
  job: { id: string; name: string };
  assignees: { nodes: { id: string; user: { id: string; name: string } }[] };
}

export async function getTasksForJob(jobId: string): Promise<JTTask[]> {
  const data = await pave({
    job: {
      $: { id: jobId },
      tasks: {
        $: { size: 200 },
        nodes: {
          id: {},
          name: {},
          description: {},
          startDate: {},
          endDate: {},
          progress: {},
          assignees: {
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

// Get ALL open tasks across all active jobs for a specific membership
export async function getOpenTasksForMember(membershipId: string): Promise<JTTask[]> {
  // Query org-level tasks assigned to this member that are not complete
  const result = await orgQuery('tasks', {
    $: {
      size: 200,
      where: [
        ['progress', '<', 100],
        ['assignees.id', '=', membershipId],
      ],
      sortBy: [['endDate', 'ASC']],
    },
    nodes: {
      id: {},
      name: {},
      description: {},
      startDate: {},
      endDate: {},
      progress: {},
      job: { id: {}, name: {} },
      assignees: {
        nodes: {
          id: {},
          user: { id: {}, name: {} },
        },
      },
    },
  });
  return result.nodes || [];
}

// Get all tasks across all active jobs (for Nathan's team workload view)
export async function getAllOpenTasks(): Promise<JTTask[]> {
  const result = await orgQuery('tasks', {
    $: {
      size: 500,
      where: [['progress', '<', 100]],
      sortBy: [['endDate', 'ASC']],
    },
    nodes: {
      id: {},
      name: {},
      description: {},
      startDate: {},
      endDate: {},
      progress: {},
      job: { id: {}, name: {} },
      assignees: {
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
  account: { id: string; name: string };
  files: { nodes: { id: string; name: string; url: string; type: string; size: number }[] };
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
          account: { id: {}, name: {} },
          files: {
            nodes: { id: {}, name: {}, url: {}, type: {}, size: {} },
          },
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
      where: [['status', '=', 'approved']],
      sortBy: [['createdAt', 'DESC']],
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
      account: { id: {}, name: {} },
      files: {
        nodes: { id: {}, name: {}, url: {}, type: {}, size: {} },
      },
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
        $: { size: 200 },
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
  user: { id: string; name: string; email: string };
}

export async function getMembers(): Promise<JTMember[]> {
  const result = await orgQuery('memberships', {
    $: { size: 50 },
    nodes: {
      id: {},
      user: { id: {}, name: {}, email: {} },
    },
  });
  return result.nodes || [];
}

// ============================================================
// COST CODES
// ============================================================

export async function getCostCodes() {
  const result = await orgQuery('costCodes', {
    $: { size: 200 },
    nodes: {
      id: {},
      name: {},
      number: {},
      category: { id: {}, name: {} },
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
      where: [['type', '=', 'vendorBill']],
      sortBy: [['createdAt', 'DESC']],
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
      account: { id: {}, name: {} },
    },
  });
  return result.nodes || [];
}

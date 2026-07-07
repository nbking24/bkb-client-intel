// @ts-nocheck
// JobTread API - uses Pave query language (not GraphQL)
// Docs: https://app.jobtread.com/docs
//
// PAVE API patterns:
// - Org-level collections (jobs, tasks, memberships) must be queried
//   under organization: { $: { id: orgId }, collection: {...} }
// - Single entity by ID uses SINGULAR at root: job, task, document
// - Mutations (createTask, etc.) go at the root level

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';
const JT_ORG = '22P5SRwhLaYe';

async function jtQuery(query: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Pave HTTP API requires body wrapped in { query: ... }
  const paveQuery = {
    $: { grantKey: JT_KEY() },
    ...query,
  };

  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: paveQuery }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('JobTread API error ' + res.status + ': ' + text.slice(0, 200));
  }
  return res.json();
}

// Org-scoped query helper — wraps collection under organization
async function orgQuery(collection: string, params: Record<string, unknown>) {
  const data = await jtQuery({
    organization: {
      $: { id: JT_ORG },
      [collection]: params,
    },
  });
  return (data as any)?.organization?.[collection] || {};
}

// Fetch all org members (membership ID + user name)
export async function getMembers(): Promise<{ id: string; name: string }[]> {
  const result = await orgQuery('memberships', {
    nodes: {
      id: {},
      user: { id: {}, name: {} },
    },
  });
  const nodes = result.nodes || [];
  return nodes.map((n: any) => ({ id: n.id, name: n.user?.name || '' }));
}

export async function getActiveJobs(limit = 30) {
  const result = await orgQuery('jobs', {
    $: {
      size: Math.min(limit, 100),
      where: ['closedOn', '=', null],
    },
    nodes: {
      id: {},
      name: {},
      number: {},
      status: {},
      createdAt: {},
    },
  });
  const jobs = result.nodes || [];
  return jobs;
}

// ---------------------------------------------------------------------------
// Marketing Photo Engine helpers
//
// The Cowork/Claude task does the heavy media work. These helpers just let the
// Hub list which jobs are opted in for marketing and compute the folder name
// used on the designer's FTP server. Keep them defensive: JobTread custom-field
// graphs can be missing or shaped oddly, so tolerate that and return [] rather
// than throwing.
// ---------------------------------------------------------------------------

/**
 * Folder name rule: replace the FIRST space in the job name with a hyphen.
 *   "Edwards Pool House" -> "Edwards-Pool House"
 *   "Leonard Kitchen"    -> "Leonard-Kitchen"
 * A name with no space is returned unchanged.
 */
export function folderNameForJob(name: string): string {
  const clean = (name || '').trim();
  return clean.replace(' ', '-');
}

function isTruthyMarketingValue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === 'yes' || v === '1';
  }
  return false;
}

/**
 * Eligible marketing jobs = active jobs (closedOn = null) whose custom field
 * named "Marketing" (case-insensitive) is set truthy ("true"/"yes"/"1"/true).
 *
 * Returns [] on any error rather than throwing, so callers/UI degrade cleanly.
 */
export async function getMarketingJobs(limit = 200): Promise<
  { id: string; name: string; number: string; folderName: string }[]
> {
  try {
    const result = await orgQuery('jobs', {
      $: {
        size: Math.min(limit, 100),
        where: ['closedOn', '=', null],
      },
      nodes: {
        id: {},
        name: {},
        number: {},
        customFieldValues: {
          nodes: { value: {}, customField: { name: {} } },
        },
      },
    });

    const nodes = result.nodes || [];
    const out: { id: string; name: string; number: string; folderName: string }[] = [];

    for (const job of nodes) {
      try {
        const cfvs = job?.customFieldValues?.nodes || [];
        const marketingField = cfvs.find(
          (cfv: any) => (cfv?.customField?.name || '').trim().toLowerCase() === 'marketing'
        );
        if (!marketingField || !isTruthyMarketingValue(marketingField.value)) continue;

        const name = job?.name || '';
        out.push({
          id: job?.id || '',
          name,
          number: job?.number || '',
          folderName: folderNameForJob(name),
        });
      } catch {
        // Skip a single malformed job node rather than failing the whole list.
        continue;
      }
    }

    return out;
  } catch (err: any) {
    console.error('[jobtread] getMarketingJobs failed:', err?.message || err);
    return [];
  }
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

  const data = await jtQuery({
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
                        createdTask: {
                                      id: {},
                                      name: {},
                        },
            },
  });

  const created = (data as any)?.createTask?.createdTask;
        if (!created?.id) {
                  throw new Error('Task creation failed: ' + JSON.stringify(data));
        }
        return { id: created.id, name: created.name };
}

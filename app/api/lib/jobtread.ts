// @ts-nocheck
// JobTread API - uses Pave query language (not GraphQL)
// Docs: https://app.jobtread.com/docs

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';
const JT_ORG = '22P5SRwhLaYe';

async function jtQuery(query: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Pave API: auth via grantKey inside the body (NO query wrapper)
  const body = {
    $: { grantKey: JT_KEY() },
    ...query,
  };

  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('JobTread API error ' + res.status + ': ' + text.slice(0, 200));
  }
  return res.json();
}

export async function getActiveJobs(limit = 30) {
  const data = await jtQuery({
    jobs: {
      $: {
        first: limit,
        where: { closedOn: { eq: null } },
        orderBy: { createdAt: 'DESC' },
      },
      nodes: {
        id: {},
        name: {},
        number: {},
        status: {},
        createdAt: {},
      },
    },
  });
  const jobs = (data as any)?.jobs?.nodes || [];
  return jobs;
}

export async function createTask(params: {
  jobId: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
}) {
  const { jobId, name, description, startDate, endDate } = params;

  const data = await jtQuery({
    createTask: {
      $: {
        targetId: jobId,
        targetType: 'job',
        name,
        ...(description ? { description } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      },
    },
  });

  const created = (data as any)?.createTask;
  if (!created?.id) {
    throw new Error('Task creation failed: ' + JSON.stringify(data));
  }
  return { id: created.id, name: created.name };
}

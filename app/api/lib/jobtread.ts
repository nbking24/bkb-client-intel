// @ts-nocheck
// JobTread API - uses Pave query language (not GraphQL)
// Docs: https://app.jobtread.com/docs

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

// Fetch all org members (membership ID + user name)
export async function getMembers(): Promise<{ id: string; name: string }[]> {
        const data = await jtQuery({
                  memberships: {
                              nodes: {
                                            id: {},
                                            user: { id: {}, name: {} },
                              },
                  },
        });
        const nodes = (data as any)?.memberships?.nodes || [];
        return nodes.map((n: any) => ({ id: n.id, name: n.user?.name || '' }));
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

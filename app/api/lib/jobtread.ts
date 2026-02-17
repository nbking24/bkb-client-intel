const JT_URL = 'https://api.jobtread.com/graphql';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';
const JT_ORG = '22P5SRwhLaYe';

async function jtQuery(query: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + JT_KEY(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(query),
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
      $: { first: limit, filter: { organizationId: { $eq: JT_ORG }, closedOn: { $eq: null } } },
      nodes: { id: true, name: true, number: true, description: true, createdAt: true, status: true },
    },
  });
  const jobs = data as { jobs?: { nodes?: unknown[] } };
  return jobs.jobs?.nodes || [];
}

export async function getTeamMembers() {
  const data = await jtQuery({
    memberships: {
      $: { first: 50, filter: { organizationId: { $eq: JT_ORG } } },
      nodes: { id: true, role: true, user: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
  const result = data as { memberships?: { nodes?: unknown[] } };
  return result.memberships?.nodes || [];
}

export async function getCustomers() {
  const data = await jtQuery({
    accounts: {
      $: { first: 50, filter: { organizationId: { $eq: JT_ORG }, type: { $eq: 'customer' } } },
      nodes: { id: true, name: true, email: true, phone: true },
    },
  });
  const result = data as { accounts?: { nodes?: unknown[] } };
  return result.accounts?.nodes || [];
}

export async function getVendors() {
  const data = await jtQuery({
    accounts: {
      $: { first: 50, filter: { organizationId: { $eq: JT_ORG }, type: { $eq: 'vendor' } } },
      nodes: { id: true, name: true, email: true, phone: true },
    },
  });
  const result = data as { accounts?: { nodes?: unknown[] } };
  return result.accounts?.nodes || [];
}

export async function testConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const data = await jtQuery({
      organizations: {
        $: { filter: { id: { $eq: JT_ORG } } },
        nodes: { id: true, name: true },
      },
    });
    const orgs = data as { organizations?: { nodes?: Array<{ name?: string }> } };
    const name = orgs.organizations?.nodes?.[0]?.name || 'Unknown';
    return { success: true, message: 'Connected to: ' + name };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Unknown error' };
  }
}

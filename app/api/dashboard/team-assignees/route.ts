// GET /api/dashboard/team-assignees
//
// Returns the list of JobTread memberships available as task assignees, sorted
// alphabetically by name. Replaces the hardcoded TEAM_ASSIGNEES array in the
// overview so any new JT user (Allison, future hires, etc.) is immediately
// selectable without a code change.
//
// Cached in-memory for 30 minutes per Vercel function instance. Memberships
// change rarely; the trade-off is fine.
import { NextResponse } from 'next/server';
import { pave } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JT_ORG = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';
const TTL_MS = 30 * 60 * 1000;

interface Assignee {
  id: string;     // JobTread membership id (what we pass to createTask)
  name: string;   // full display name from the linked user
}

let cached: { at: number; data: Assignee[] } | null = null;

async function fetchAllMemberships(): Promise<Assignee[]> {
  const all: Assignee[] = [];
  let nextPage: string | null = null;
  // PAVE org-level connections cap at 100/page; paginate until exhausted.
  for (let page = 0; page < 20; page++) {
    const params: Record<string, unknown> = { size: 100 };
    if (nextPage) params.page = nextPage;
    const out: any = await pave({
      organization: {
        $: { id: JT_ORG() },
        memberships: {
          $: params,
          nextPage: {},
          // user.email is NOT in PAVE's schema; id + name is all we need here.
          nodes: { id: {}, user: { id: {}, name: {} } },
        },
      },
    });
    const conn = out?.organization?.memberships;
    const nodes: any[] = conn?.nodes || [];
    for (const m of nodes) {
      const name = m?.user?.name;
      if (m?.id && typeof name === 'string' && name.trim()) {
        all.push({ id: m.id, name: name.trim() });
      }
    }
    nextPage = conn?.nextPage || null;
    if (!nextPage || nodes.length < 100) break;
  }
  all.sort((a, b) => a.name.localeCompare(b.name));
  return all;
}

export async function GET() {
  try {
    if (cached && Date.now() - cached.at < TTL_MS) {
      return NextResponse.json({ assignees: cached.data, cached: true });
    }
    const data = await fetchAllMemberships();
    cached = { at: Date.now(), data };
    return NextResponse.json({ assignees: data, cached: false });
  } catch (err: any) {
    return NextResponse.json(
      { assignees: [], error: err?.message || 'Failed to load assignees' },
      { status: 200 }
    );
  }
}

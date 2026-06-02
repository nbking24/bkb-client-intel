// GET /api/dashboard/team-assignees
//
// Returns the internal JobTread members available as task assignees, sorted
// alphabetically. We filter by `membership.role.type === 'internal'` so
// Customer/Vendor/Client memberships (~160 of them) are excluded — only staff
// with a JobTread login appear (Nathan, Brett, Evan, Terri, Allison, etc.).
//
// Cached in-memory for 30 minutes per Vercel function instance; memberships
// change rarely so the trade-off is fine.
import { NextResponse } from 'next/server';
import { pave } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JT_ORG = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';
const TTL_MS = 30 * 60 * 1000;

// Internal-role memberships that aren't actual people (integration / bot
// service accounts). Excluded from the assignee picker.
const SERVICE_ACCOUNT_NAMES = new Set<string>(['Loop CRM']);

interface Assignee {
  id: string;     // JobTread membership id (what we pass to createTask)
  name: string;   // full display name from the linked user
}

let cached: { at: number; data: Assignee[] } | null = null;

async function fetchInternalMemberships(): Promise<Assignee[]> {
  const all: Assignee[] = [];
  let nextPage: string | null = null;
  // PAVE org-level connections cap at 100/page; paginate until exhausted.
  // We can't filter server-side on a nested field (role.type), so we pull all
  // memberships and filter client-side. The full set is small (<200) so this
  // is cheap and runs at most twice.
  for (let page = 0; page < 20; page++) {
    const params: Record<string, unknown> = { size: 100 };
    if (nextPage) params.page = nextPage;
    const out: any = await pave({
      organization: {
        $: { id: JT_ORG() },
        memberships: {
          $: params,
          nextPage: {},
          nodes: {
            id: {},
            user: { id: {}, name: {} },
            // role.type === 'internal' marks staff with a JobTread login;
            // Customer / Vendor / Client memberships have type 'external'.
            role: { type: {} },
          },
        },
      },
    });
    const conn = out?.organization?.memberships;
    const nodes: any[] = conn?.nodes || [];
    for (const m of nodes) {
      const isInternal = m?.role?.type === 'internal';
      const name = m?.user?.name;
      if (!isInternal || !m?.id || typeof name !== 'string' || !name.trim()) continue;
      // Skip the Loop CRM service account (it's an internal-role membership
      // used by the GHL/Loop integration, not a person you'd ever assign a
      // task to).
      if (SERVICE_ACCOUNT_NAMES.has(name.trim())) continue;
      all.push({ id: m.id, name: name.trim() });
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
    const data = await fetchInternalMemberships();
    cached = { at: Date.now(), data };
    return NextResponse.json({ assignees: data, cached: false });
  } catch (err: any) {
    return NextResponse.json(
      { assignees: [], error: err?.message || 'Failed to load assignees' },
      { status: 200 }
    );
  }
}

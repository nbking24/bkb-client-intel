// Admin user management API — OWNER ONLY.
//
//   GET    /api/admin/users        -> list all users (+ hasPin flag)
//   POST   /api/admin/users        -> create or update a user + access
//   DELETE /api/admin/users?id=xxx -> remove a user
//
// Access registries (dashboards/features/widgets/presets) are static and read
// directly by the admin UI from app/lib/access-registry.ts — they are not
// returned here.
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import {
  listAppUsers,
  getAppUser,
  upsertAppUser,
  suggestUserId,
  isOwner,
  type UpsertUserInput,
} from '@/app/lib/access';
import {
  ASSIGNABLE_DASHBOARD_IDS,
  ALL_FEATURE_IDS,
  ALL_WIDGET_IDS,
  type AccessRole,
} from '@/app/lib/access-registry';
import { createServerClient } from '@/app/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ROLES: AccessRole[] = ['owner', 'admin', 'field_sup', 'field', 'custom'];
const ID_RE = /^[a-z][a-z0-9_-]{1,30}$/;

async function requireOwner(req: NextRequest): Promise<{ ok: true; userId: string } | { ok: false; res: NextResponse }> {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!(await isOwner(auth.userId))) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden — owner only' }, { status: 403 }) };
  }
  return { ok: true, userId: auth.userId };
}

/** Which user ids currently have a login PIN set (stored in agent_cache). */
async function getPinSet(): Promise<Set<string>> {
  try {
    const supabase = createServerClient();
    const { data } = await supabase.from('agent_cache').select('key').like('key', 'user-pin:%');
    const ids = (data || []).map((r: any) => String(r.key).replace('user-pin:', ''));
    return new Set(ids);
  } catch {
    return new Set();
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireOwner(req);
  if (!gate.ok) return gate.res;

  const [users, pinSet] = await Promise.all([listAppUsers(), getPinSet()]);
  return NextResponse.json({
    users: users.map((u) => ({ ...u, hasPin: pinSet.has(u.id) })),
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireOwner(req);
  if (!gate.ok) return gate.res;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const role: AccessRole = VALID_ROLES.includes(body.role) ? body.role : 'custom';

  // Sanitize access arrays against the registries so the client can't store
  // unknown ids. (owner-only dashboards like 'admin' are never stored — they're
  // granted implicitly to owners by the access layer.)
  const dashboards = Array.isArray(body.dashboards)
    ? body.dashboards.filter((d: string) => ASSIGNABLE_DASHBOARD_IDS.includes(d))
    : [];
  const features = Array.isArray(body.features)
    ? body.features.filter((f: string) => ALL_FEATURE_IDS.includes(f))
    : [];
  const overviewWidgets = Array.isArray(body.overviewWidgets)
    ? body.overviewWidgets.filter((w: string) => ALL_WIDGET_IDS.includes(w))
    : [];

  // Resolve / validate id. For new users, derive a slug from the name unless one
  // was supplied. For existing users, the id is immutable.
  const existing = await listAppUsers();
  const existingIds = existing.map((u) => u.id);
  let id: string = (body.id || '').trim().toLowerCase();
  const isUpdate = !!id && existingIds.includes(id);

  if (!id) {
    id = suggestUserId(name, existingIds);
  } else if (!isUpdate) {
    if (!ID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Login id must be lowercase letters/numbers (start with a letter), 2-31 chars' },
        { status: 400 }
      );
    }
    if (existingIds.includes(id)) {
      return NextResponse.json({ error: `Login id "${id}" already exists` }, { status: 409 });
    }
  }

  // Guard: don't let the owner accidentally lock themselves out by demoting the
  // last owner. (Only relevant on update.)
  if (isUpdate && role !== 'owner') {
    const owners = existing.filter((u) => u.role === 'owner' && u.id !== id);
    if (owners.length === 0) {
      return NextResponse.json({ error: 'Cannot remove the last owner' }, { status: 400 });
    }
  }

  const input: UpsertUserInput = {
    id,
    name,
    initials: (body.initials || '').trim() || undefined,
    title: body.title?.trim() || null,
    role,
    jtMembershipId: body.jtMembershipId?.trim() || null,
    email: body.email?.trim() || null,
    enabled: body.enabled !== false,
    dashboards,
    features,
    overviewWidgets,
  };

  try {
    const saved = await upsertAppUser(input);
    return NextResponse.json({ user: saved, created: !isUpdate });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Save failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireOwner(req);
  if (!gate.ok) return gate.res;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (id === gate.userId) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
  }

  const target = await getAppUser(id);
  if (target?.role === 'owner') {
    return NextResponse.json({ error: 'Cannot delete an owner account' }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    await supabase.from('app_users').delete().eq('id', id);
    // Also clear any stored login PIN for this user.
    await supabase.from('agent_cache').delete().eq('key', `user-pin:${id}`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Delete failed' }, { status: 500 });
  }
}

// GET /api/auth/users
//
// Public (pre-login) list of users for the login screen's "Who are you?" picker.
// Returns only non-sensitive display fields for ENABLED users — no PINs, no
// emails, no access config.
import { NextResponse } from 'next/server';
import { listAppUsers } from '@/app/lib/access';
import { ROLE_LABELS } from '@/app/lib/access-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const users = await listAppUsers();
    const out = users
      .filter((u) => u.enabled)
      .map((u) => ({
        id: u.id,
        name: u.name,
        initials: u.initials,
        // Prefer a custom title; fall back to a friendly role label.
        role: u.title || ROLE_LABELS[u.role] || 'Team Member',
      }));
    return NextResponse.json({ users: out });
  } catch (err: any) {
    return NextResponse.json({ users: [], error: err?.message || 'Failed to load users' }, { status: 200 });
  }
}

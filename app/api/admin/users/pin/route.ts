// POST /api/admin/users/pin   — OWNER ONLY
//   body: { userId: string, pin: string }   set/change a user's login PIN
//   body: { userId: string, pin: '' | null } clear the PIN (forces setup on next login)
//
// PINs are stored base64-encoded in agent_cache under `user-pin:<id>` — the same
// format the login flow reads. This lets the owner manage team PINs from the
// admin console (view is handled by the parent GET /api/admin/users).
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { isOwner, getAppUser } from '@/app/lib/access';
import { createServerClient } from '@/app/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await isOwner(auth.userId))) {
    return NextResponse.json({ error: 'Forbidden — owner only' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const userId = (body.userId || '').trim();
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  if (!(await getAppUser(userId))) {
    return NextResponse.json({ error: 'Unknown user' }, { status: 404 });
  }

  const pin = body.pin == null ? '' : String(body.pin).trim();
  const supabase = createServerClient();

  // Empty pin clears it.
  if (pin === '') {
    await supabase.from('agent_cache').delete().eq('key', `user-pin:${userId}`);
    return NextResponse.json({ success: true, cleared: true });
  }

  if (pin.length < 4) {
    return NextResponse.json({ error: 'PIN must be at least 4 digits' }, { status: 400 });
  }

  const pinHash = Buffer.from(pin).toString('base64');
  const { error } = await supabase.from('agent_cache').upsert(
    {
      key: `user-pin:${userId}`,
      data: { pinHash, updatedAt: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

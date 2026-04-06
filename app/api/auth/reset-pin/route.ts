import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const VALID_USER_IDS = ['nathan', 'terri', 'evan', 'josh'];

// One-time reset token — delete this route after use
const RESET_TOKEN = 'bkb-reset-2026-04-06';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * POST /api/auth/reset-pin
 *
 * One-time PIN reset endpoint. Clears a user's PIN so they can
 * set a new one on next login.
 *
 * Body: { userId: string, token: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, token } = await req.json();

    if (!userId || !VALID_USER_IDS.includes(userId)) {
      return NextResponse.json({ error: 'Invalid user' }, { status: 400 });
    }

    if (!token || token !== RESET_TOKEN) {
      return NextResponse.json({ error: 'Invalid reset token' }, { status: 401 });
    }

    const sb = getSupabase();
    await sb.from('agent_cache').delete().eq('key', `user-pin:${userId}`);

    return NextResponse.json({ message: `PIN cleared for ${userId}. Visit /dashboard/login, select your name, and set a new PIN.` });
  } catch (err: any) {
    console.error('Reset PIN error:', err);
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 });
  }
}

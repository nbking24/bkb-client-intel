import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const VALID_USER_IDS = ['nathan', 'terri', 'evan', 'josh'];

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * POST /api/auth/forgot-pin
 *
 * Self-service PIN reset. Requires the master APP_PIN to verify identity,
 * then clears the user's stored PIN so they can set a new one.
 *
 * Body: { userId: string, masterPin: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, masterPin } = await req.json();

    if (!userId || !VALID_USER_IDS.includes(userId)) {
      return NextResponse.json({ error: 'Invalid user' }, { status: 400 });
    }

    if (!masterPin || masterPin !== process.env.APP_PIN) {
      return NextResponse.json({ error: 'Invalid master PIN' }, { status: 401 });
    }

    const sb = getSupabase();
    await sb.from('agent_cache').delete().eq('key', `user-pin:${userId}`);

    return NextResponse.json({ message: 'PIN cleared. You can now set a new one.' });
  } catch (err: any) {
    console.error('Forgot PIN error:', err);
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 });
  }
}

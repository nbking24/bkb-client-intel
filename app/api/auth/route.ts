import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const VALID_USER_IDS = ['nathan', 'terri', 'evan', 'josh', 'dave_steich'];

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * POST /api/auth
 *
 * Supports three flows:
 * 1. Login:     { userId, pin }           → validates per-user PIN, returns token
 * 2. Setup PIN: { userId, pin, setup: true } → creates/updates PIN for user (requires master PIN or no PIN set yet)
 * 3. Check:     { userId, check: true }   → returns whether user has a PIN set
 *
 * Legacy: { pin } without userId still works against APP_PIN env var
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pin, userId, setup, check, masterPin } = body;

    // --- Flow 3: Check if user has a PIN set ---
    if (check && userId) {
      if (!VALID_USER_IDS.includes(userId)) {
        return NextResponse.json({ error: 'Invalid user' }, { status: 400 });
      }
      const sb = getSupabase();
      const { data } = await sb.from('agent_cache').select('data').eq('key', `user-pin:${userId}`).single();
      return NextResponse.json({ hasPin: !!(data?.data?.pinHash) });
    }

    // --- Flow 2: Setup/create a new PIN ---
    if (setup && userId && pin) {
      if (!VALID_USER_IDS.includes(userId)) {
        return NextResponse.json({ error: 'Invalid user' }, { status: 400 });
      }
      if (!pin || pin.length < 4) {
        return NextResponse.json({ error: 'PIN must be at least 4 digits' }, { status: 400 });
      }

      const sb = getSupabase();
      // Check if user already has a PIN
      const { data: existing } = await sb.from('agent_cache').select('data').eq('key', `user-pin:${userId}`).single();

      if (existing?.data?.pinHash) {
        // User already has a PIN — require master PIN to reset
        if (!masterPin || masterPin !== process.env.APP_PIN) {
          return NextResponse.json({ error: 'Master PIN required to reset an existing PIN' }, { status: 401 });
        }
      }

      // Store the PIN (simple hash — not cryptographic, but sufficient for internal tool)
      const pinHash = Buffer.from(pin).toString('base64');
      await sb.from('agent_cache').upsert({
        key: `user-pin:${userId}`,
        data: { pinHash, updatedAt: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

      // Return a token so user is immediately logged in after setup
      const tokenPayload = `${pin}:${userId}:${Date.now()}`;
      const token = Buffer.from(tokenPayload).toString('base64');
      return NextResponse.json({ token, message: 'PIN created successfully' });
    }

    // --- Flow 1: Login with per-user PIN ---
    if (userId && pin) {
      if (!VALID_USER_IDS.includes(userId)) {
        return NextResponse.json({ error: 'Invalid user' }, { status: 400 });
      }

      const sb = getSupabase();
      const { data } = await sb.from('agent_cache').select('data').eq('key', `user-pin:${userId}`).single();

      if (!data?.data?.pinHash) {
        return NextResponse.json({ error: 'No PIN set for this user. Please set up your PIN first.' }, { status: 401 });
      }

      const storedPin = Buffer.from(data.data.pinHash, 'base64').toString();
      if (pin !== storedPin) {
        return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
      }

      const tokenPayload = `${pin}:${userId}:${Date.now()}`;
      const token = Buffer.from(tokenPayload).toString('base64');
      return NextResponse.json({ token });
    }

    // --- Legacy: shared PIN (no userId) ---
    if (pin && !userId) {
      if (pin !== process.env.APP_PIN) {
        return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
      }
      const tokenPayload = `${pin}:${Date.now()}`;
      const token = Buffer.from(tokenPayload).toString('base64');
      return NextResponse.json({ token });
    }

    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  } catch (err: any) {
    console.error('Auth error:', err);
    return NextResponse.json({ error: 'Auth failed' }, { status: 500 });
  }
}

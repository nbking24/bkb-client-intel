// @ts-nocheck
/**
 * POST /api/public/stash
 *
 * Temporary utility endpoint. Accepts { key: string, data: string } and
 * stores the payload in Supabase's marketing_events.detail so it can be
 * retrieved from a separate machine. Used for one-time data transfers
 * (e.g. exporting a CSV from a browser session into the sandbox). Not
 * authenticated - do not stash anything secret here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { key, data } = body;
  if (!key || typeof key !== 'string' || typeof data !== 'string') {
    return NextResponse.json({ error: 'key and data required' }, { status: 400 });
  }
  const supabase = getSupabase();
  const { error } = await supabase.from('marketing_events').insert({
    agent: 'stash',
    event_type: 'stash_write',
    entity_type: 'stash',
    entity_id: key,
    outcome: 'success',
    detail: { key, data, length: data.length },
  });
  if (error) {
    console.error('[stash] insert failed', error);
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
  return NextResponse.json({ success: true, key, length: data.length });
}

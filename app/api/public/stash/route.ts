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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (!key) {
    return NextResponse.json({ error: 'key query param required' }, { status: 400, headers: cors });
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('marketing_events')
    .select('detail, occurred_at')
    .eq('agent', 'stash')
    .eq('entity_id', key)
    .order('occurred_at', { ascending: false })
    .limit(1);
  if (error) {
    return NextResponse.json({ error: 'fetch failed' }, { status: 500, headers: cors });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: cors });
  }
  const payload = data[0].detail?.data || '';
  return new NextResponse(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

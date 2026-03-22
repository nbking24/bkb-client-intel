/**
 * /api/sync/texts — Receive iMessage data from Nathan's Mac sync script
 *
 * POST /api/sync/texts
 * Headers: { "x-sync-key": "<SYNC_SECRET>" }
 * Body: { messages: [{ id, text, is_from_me, date, contact_id, contact_display }] }
 *
 * Stores messages in agent_cache under key "nathan-recent-texts"
 * so the dashboard briefing can include text message context.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SYNC_SECRET = process.env.TEXT_SYNC_SECRET || 'bkb-text-sync-2026';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    // Validate sync key
    const syncKey = req.headers.get('x-sync-key');
    if (syncKey !== SYNC_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { messages } = body;

    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
    }

    // Store in agent_cache
    const sb = getSupabase();
    const { error } = await sb
      .from('agent_cache')
      .upsert(
        {
          key: 'nathan-recent-texts',
          data: { messages, syncedAt: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );

    if (error) {
      console.error('[sync/texts] Supabase error:', error.message);
      return NextResponse.json({ error: 'Failed to store messages' }, { status: 500 });
    }

    return NextResponse.json({
      status: 'ok',
      messageCount: messages.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[sync/texts] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    );
  }
}

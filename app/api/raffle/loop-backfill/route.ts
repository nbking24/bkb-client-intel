// @ts-nocheck
/**
 * POST /api/raffle/loop-backfill
 *
 * Owner-only.  Re-runs the Loop sync for any raffle_entries row that has an
 * email but no loop_contact_id.  Idempotent — safe to run multiple times.
 *
 * Used to recover entries that were submitted before the Loop sync code was
 * deployed (or any other window where sync was disabled / failed).
 *
 * Returns: { ok: true, processed, synced, failed, results: [...] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { syncRaffleEntryToLoop } from '../../lib/raffle/loop-sync';
import { validateAgentOrUser } from '../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!validateAgentOrUser(req).valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from('raffle_entries')
    .select('id, name, first_name, last_name, phone, email, contact_ok, interests')
    .is('deleted_at', null)
    .is('loop_contact_id', null)
    .not('email', 'is', null)
    .order('created_at', { ascending: true });
  if (error) {
    return NextResponse.json({ error: 'fetch_failed', detail: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; ok: boolean; contactId: string | null; error: string | null }> = [];
  let synced = 0, failed = 0;

  for (const row of rows || []) {
    const sync = await syncRaffleEntryToLoop({
      name:      row.name || '',
      firstName: row.first_name || null,
      lastName:  row.last_name || null,
      email:     row.email,
      phone:     row.phone,
      contactOk: !!row.contact_ok,
      interests: Array.isArray(row.interests) ? row.interests : [],
    });
    await supabase
      .from('raffle_entries')
      .update({
        loop_contact_id: sync.contactId,
        loop_sync_error: sync.error,
        loop_synced_at:  new Date().toISOString(),
      })
      .eq('id', row.id);
    if (sync.contactId && !sync.error) synced++;
    else failed++;
    results.push({ id: row.id, ok: !!sync.contactId, contactId: sync.contactId, error: sync.error });
  }

  return NextResponse.json({
    ok: true,
    processed: (rows || []).length,
    synced,
    failed,
    results,
  });
}

// @ts-nocheck
/**
 * POST /api/raffle/close-blank-contacts
 *
 * Close out the blank-contact raffle group per Nathan's spec
 * ("one email only, then close after 7 days"). Strip the
 * bucks-beautiful-2026-blank-contact tag from every Loop contact
 * in this group, and mark them raffle_complete in the DB.
 *
 * Safe to run multiple times — idempotent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GHL_BASE = 'https://services.leadconnectorhq.com';
const TAGS_TO_STRIP = ['bucks-beautiful-2026-blank-contact'];

function headers() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

async function removeTag(contactId: string, tag: string): Promise<{ ok: boolean; status: number }> {
  try {
    const r = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: 'DELETE',
      headers: headers(),
      body: JSON.stringify({ tags: [tag] }),
    });
    return { ok: r.ok, status: r.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function POST(_req: NextRequest) {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from('raffle_entries')
    .select('id, name, email, loop_contact_id')
    .is('contact_ok', null)
    .not('loop_contact_id', 'is', null)
    .is('deleted_at', null);
  if (error) {
    return NextResponse.json({ error: 'fetch_failed', detail: error.message }, { status: 500 });
  }

  const results: any[] = [];
  let stripped = 0;
  let failed = 0;
  const dbCloseIds: string[] = [];

  for (const row of rows || []) {
    let allOk = true;
    for (const t of TAGS_TO_STRIP) {
      const r = await removeTag(row.loop_contact_id, t);
      if (!r.ok && r.status !== 404 && r.status !== 400) allOk = false;
    }
    if (allOk) { stripped++; dbCloseIds.push(row.id); }
    else failed++;
    results.push({ name: row.name, email: row.email, ok: allOk });
  }

  // Mark in DB as raffle_complete (only for those whose Loop strip succeeded)
  if (dbCloseIds.length) {
    await supabase
      .from('raffle_entries')
      .update({ loop_sync_error: 'raffle_complete_blank_contact' })
      .in('id', dbCloseIds);
  }

  return NextResponse.json({
    ok: true,
    processed: (rows || []).length,
    tag_stripped: stripped,
    failed,
    db_marked: dbCloseIds.length,
    results,
  });
}

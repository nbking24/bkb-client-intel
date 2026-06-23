// @ts-nocheck
/**
 * POST /api/raffle/retag-blank
 *
 * One-shot recovery: finds all raffle_entries where contact_ok IS NULL
 * (blank) and loop_contact_id IS NOT NULL (already in Loop) and adds the
 * bucks-beautiful-2026-blank-contact tag to each, which triggers Workflow C.
 *
 * Used to fix the 28 paper entries that were incorrectly tagged
 * 'bucks-beautiful-2026-raffle-only' before the backfill bug was fixed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAgentOrUser } from '../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GHL_BASE = 'https://services.leadconnectorhq.com';

function headers() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

async function addTags(contactId: string, tags: string[]): Promise<boolean> {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ tags }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function removeTags(contactId: string, tags: string[]): Promise<boolean> {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: 'DELETE',
      headers: headers(),
      body: JSON.stringify({ tags }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!validateAgentOrUser(req).valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from('raffle_entries')
    .select('id, name, email, contact_ok, loop_contact_id')
    .is('contact_ok', null)
    .not('loop_contact_id', 'is', null)
    .is('deleted_at', null);
  if (error) {
    return NextResponse.json({ error: 'fetch_failed', detail: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; name: string; ok: boolean }> = [];
  let added = 0, removed = 0, failed = 0;

  for (const row of rows || []) {
    // Remove the wrong tag first so we don't pollute filters
    const rOk = await removeTags(row.loop_contact_id, ['bucks-beautiful-2026-raffle-only']);
    if (rOk) removed++;
    // Add the correct tag — this triggers Workflow C
    const aOk = await addTags(row.loop_contact_id, ['bucks-beautiful-2026-blank-contact']);
    if (aOk) added++; else failed++;
    results.push({ id: row.id, name: row.name, ok: aOk });
  }

  return NextResponse.json({
    ok: true,
    processed: (rows || []).length,
    added_blank_contact_tag: added,
    removed_raffle_only_tag: removed,
    failed,
    results,
  });
}

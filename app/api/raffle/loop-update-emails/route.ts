// @ts-nocheck
/**
 * POST /api/raffle/loop-update-emails
 *
 * Push the current email value from raffle_entries to the corresponding
 * Loop contact for every entry where loop_contact_id is set. Used after
 * we re-OCR'd the paper sign-up sheets and corrected wrong emails.
 *
 * Body: { ids: string[] }  (raffle_entries.id list)
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

async function updateContactEmail(
  contactId: string,
  email: string,
  firstName: string | null,
  lastName: string | null,
): Promise<{ ok: boolean; status: number; detail?: string }> {
  try {
    const body: any = { email };
    if (firstName) body.firstName = firstName;
    if (lastName) body.lastName = lastName;
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, status: res.status, detail: txt.slice(0, 200) };
    }
    return { ok: true, status: res.status };
  } catch (e: any) {
    return { ok: false, status: 0, detail: e?.message || 'fetch error' };
  }
}

export async function POST(req: NextRequest) {
  if (!validateAgentOrUser(req).valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  if (!ids.length) {
    return NextResponse.json({ error: 'ids[] required' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from('raffle_entries')
    .select('id, name, first_name, last_name, email, loop_contact_id')
    .in('id', ids);
  if (error) {
    return NextResponse.json({ error: 'fetch_failed', detail: error.message }, { status: 500 });
  }

  const results: any[] = [];
  let updated = 0, skipped = 0, failed = 0;
  for (const row of rows || []) {
    if (!row.loop_contact_id || !row.email) {
      skipped++;
      results.push({ name: row.name, email: row.email, ok: false, reason: 'no_loop_id_or_email' });
      continue;
    }
    const r = await updateContactEmail(row.loop_contact_id, row.email, row.first_name, row.last_name);
    if (r.ok) updated++; else failed++;
    results.push({ name: row.name, email: row.email, ...r });
  }
  return NextResponse.json({ ok: true, processed: rows?.length || 0, updated, skipped, failed, results });
}

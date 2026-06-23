// @ts-nocheck
/**
 * POST /api/raffle/cleanup-invalid
 *
 * Strip bucks-beautiful-2026* tags from every Loop contact whose
 * raffle_entries row has loop_sync_error LIKE 'mailbox_invalid:%'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAgentOrUser } from '../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GHL_BASE = 'https://services.leadconnectorhq.com';
const RAFFLE_TAGS = [
  'bucks-beautiful-2026',
  'bucks-beautiful-2026-lead',
  'bucks-beautiful-2026-raffle-only',
  'bucks-beautiful-2026-blank-contact',
];

function headers() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

async function removeTagsOneByOne(contactId: string, tags: string[]): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  for (const t of tags) {
    try {
      const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
        method: 'DELETE',
        headers: headers(),
        body: JSON.stringify({ tags: [t] }),
      });
      if (res.ok) removed++; else failed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}

export async function POST(req: NextRequest) {
  if (!validateAgentOrUser(req).valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from('raffle_entries')
    .select('id, name, email, loop_contact_id, loop_sync_error')
    .like('loop_sync_error', 'mailbox_invalid:%')
    .not('loop_contact_id', 'is', null)
    .is('deleted_at', null);
  if (error) {
    return NextResponse.json({ error: 'fetch_failed', detail: error.message }, { status: 500 });
  }

  const results: Array<{ name: string; email: string; removed: number; failed: number }> = [];
  for (const row of rows || []) {
    const r = await removeTagsOneByOne(row.loop_contact_id, RAFFLE_TAGS);
    results.push({ name: row.name, email: row.email, ...r });
  }

  return NextResponse.json({ ok: true, processed: (rows || []).length, results });
}

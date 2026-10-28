// @ts-nocheck
/**
 * POST /api/dashboard/bill-review/[id]/dismiss
 *
 * Body: { reason?: string, dismissedBy?: string }
 *
 * Dismisses a queue row without changing anything in JT. Used when
 * Nathan looks at the flag and decides the line is actually fine
 * (e.g. intentionally using cost code 23 for billable items).
 *
 * Rows that are auto-dismissed by the scan (because the line was
 * categorized correctly between runs) are marked here too — in that
 * case dismissedBy is 'system'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '../../../../lib/supabase';
import { resolveActorName } from '@/app/lib/actor-name';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // The nightly scan dismisses rows as 'system' through the library, not
  // through this route, so everything arriving here is a person.
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const id = params.id;

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  // Who dismissed it is resolved server-side from the signed-in user, not
  // taken from the request body — the reason line used to be hard-coded to
  // "Nathan marked OK" no matter who clicked it, which made the audit trail
  // wrong the moment anyone else worked the queue.
  const dismissedBy = await resolveActorName(supabase, auth.userId);
  const rawReason = String(body?.reason || '').trim();
  const bulk = body?.bulk === true;
  const reason: string =
    rawReason || (bulk ? `Bulk-dismissed by ${dismissedBy}` : `${dismissedBy} marked OK`);

  const { data: row, error: loadErr } = await supabase
    .from('bill_review_queue')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr || !row) {
    return NextResponse.json({ error: 'Queue row not found' }, { status: 404 });
  }
  // 'flagged' is dismissible too: that is exactly how Nathan clears a row
  // Heather escalated to him.
  if (!['pending', 'failed', 'flagged'].includes(row.status)) {
    return NextResponse.json({ error: `Row is ${row.status}, not pending` }, { status: 409 });
  }

  await supabase
    .from('bill_review_queue')
    .update({
      status: 'dismissed',
      approved_by: dismissedBy,
      approved_at: new Date().toISOString(),
      last_error: reason,
    })
    .eq('id', id);

  return NextResponse.json({ ok: true });
}

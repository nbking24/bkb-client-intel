// @ts-nocheck
/**
 * POST /api/dashboard/bill-review/[id]/flag
 *
 * Body: { note: string }
 *
 * "Flag for Nathan" — Heather's escape hatch on the Bill Review page. She
 * uses it when she can't tell which budget item a line belongs on, or when
 * the picker is empty because the job has no approved budget yet.
 *
 * The row moves to status 'flagged', which:
 *   - takes it out of the pending list and the pending count;
 *   - puts it under the "Flagged for Nathan" filter with the note;
 *   - makes the nightly scan leave it alone (it is neither reset to
 *     pending nor auto-dismissed — see app/lib/bill-categorization.ts).
 *
 * Nothing is written to JobTread. Nathan resolves it from that filter with
 * the normal Apply or Dismiss.
 *
 * The note is required: a flag with no reason is worse than no flag, since
 * whoever picks it up has to redo the research that prompted it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '../../../../lib/supabase';
import { resolveActorName } from '@/app/lib/actor-name';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NOTE = 500;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const id = params.id;

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const note = String(body?.note || '').trim();
  if (!note) {
    return NextResponse.json({ error: 'A short note is required so Nathan knows what to look at.' }, { status: 400 });
  }

  const { data: row, error: loadErr } = await supabase
    .from('bill_review_queue')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr || !row) {
    return NextResponse.json({ error: 'Queue row not found' }, { status: 404 });
  }
  if (!['pending', 'failed', 'flagged'].includes(row.status)) {
    return NextResponse.json({ error: `Row is ${row.status} — nothing left to flag.` }, { status: 409 });
  }

  const flaggedBy = await resolveActorName(supabase, auth.userId);
  const now = new Date().toISOString();

  const { error: updErr } = await supabase
    .from('bill_review_queue')
    .update({
      status: 'flagged',
      flag_note: note.slice(0, MAX_NOTE),
      flagged_by: flaggedBy,
      flagged_at: now,
      updated_at: now,
    })
    .eq('id', id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: 'flagged', flaggedBy, flaggedAt: now });
}

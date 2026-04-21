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
import { getSupabase } from '../../../../lib/supabase';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabase();
  const id = params.id;

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const reason: string | null = body.reason || null;
  const dismissedBy: string = body.dismissedBy || 'nathan';

  const { data: row, error: loadErr } = await supabase
    .from('bill_review_queue')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (loadErr || !row) {
    return NextResponse.json({ error: 'Queue row not found' }, { status: 404 });
  }
  if (row.status !== 'pending' && row.status !== 'failed') {
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

// @ts-nocheck
/**
 * POST /api/raffle/reset
 *
 * Owner/admin-only.  Clears is_winner=false and drawn_at=null on every
 * non-deleted raffle entry.  Used to "rewind" the wheel during testing
 * so the same admin can re-run the spin multiple times without
 * permanently picking a winner.
 *
 * Response:
 *   200 { ok: true, reset_count: N }
 *   401 unauthorized
 *   500 server error
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAuth } from '../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization')).valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('raffle_entries')
    .update({ is_winner: false, drawn_at: null })
    .eq('is_winner', true)
    .is('deleted_at', null)
    .select('id');
  if (error) {
    return NextResponse.json({ error: 'reset_failed', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, reset_count: (data || []).length });
}

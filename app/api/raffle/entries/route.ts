// @ts-nocheck
/**
 * GET /api/raffle/entries
 *
 * Public endpoint — no auth. Returns active (non-deleted) raffle entries
 * as a names-only list for the /raffle/wheel TV display. PII (phone/email)
 * is intentionally NOT returned here.
 *
 * Response:
 *   200 {
 *     entries: Array<{ id: string, name: string, is_winner: boolean }>,
 *     winner: { id: string, name: string, drawn_at: string } | null,
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const supabase = getSupabase();

  const { data: entries, error: entriesErr } = await supabase
    .from('raffle_entries')
    .select('id, name, is_winner')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (entriesErr) {
    return NextResponse.json({ error: 'list_failed', detail: entriesErr.message }, { status: 500 });
  }

  const winner = (entries || []).find((e: any) => e.is_winner);
  let winnerDetail: any = null;
  if (winner) {
    const { data: w } = await supabase
      .from('raffle_entries')
      .select('id, name, drawn_at')
      .eq('id', winner.id)
      .maybeSingle();
    if (w) winnerDetail = { id: w.id, name: w.name, drawn_at: w.drawn_at };
  }

  return NextResponse.json({
    entries: entries || [],
    winner: winnerDetail,
  });
}

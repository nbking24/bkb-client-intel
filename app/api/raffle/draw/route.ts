// @ts-nocheck
/**
 * POST /api/raffle/draw
 *
 * Owner/admin-only. Picks a random non-deleted, non-winner raffle entry,
 * marks is_winner=true, drawn_at=now(). Returns the winner row.
 *
 * Body (optional):
 *   { override?: boolean }   // bypass the drawing-time gate (for testing)
 *
 * Drawing time: 2026-06-14 16:00 America/New_York. Until then, the endpoint
 * returns 425 Too Early unless `override: true` is sent.
 *
 * Response:
 *   200 { ok: true, winner: { id, name, drawn_at } }
 *   404 no_entries
 *   409 winner_already_drawn (with existing winner attached)
 *   425 too_early (with seconds_until_drawing)
 *   500 server error
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAuth } from '../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 2026-06-14 16:00:00 in America/New_York — that's UTC 20:00 (EDT, UTC-4)
const DRAWING_TIME_MS = Date.parse('2026-06-14T20:00:00Z');

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const override = body?.override === true;

  const now = Date.now();
  if (!override && now < DRAWING_TIME_MS) {
    return NextResponse.json(
      { error: 'too_early', seconds_until_drawing: Math.ceil((DRAWING_TIME_MS - now) / 1000) },
      { status: 425 },
    );
  }

  const supabase = getSupabase();

  // 1) Refuse if a winner has already been drawn
  const { data: existingWinner, error: winErr } = await supabase
    .from('raffle_entries')
    .select('id, name, drawn_at')
    .eq('is_winner', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (winErr) {
    return NextResponse.json({ error: 'check_winner_failed', detail: winErr.message }, { status: 500 });
  }
  if (existingWinner) {
    return NextResponse.json({ error: 'winner_already_drawn', winner: existingWinner }, { status: 409 });
  }

  // 2) Pull all eligible entries
  const { data: pool, error: poolErr } = await supabase
    .from('raffle_entries')
    .select('id, name')
    .eq('is_winner', false)
    .is('deleted_at', null);
  if (poolErr) {
    return NextResponse.json({ error: 'pool_failed', detail: poolErr.message }, { status: 500 });
  }
  if (!pool || pool.length === 0) {
    return NextResponse.json({ error: 'no_entries' }, { status: 404 });
  }

  // 3) Pick at random
  const idx = Math.floor(Math.random() * pool.length);
  const pick = pool[idx];
  const drawn_at = new Date().toISOString();

  const { data: updated, error: updErr } = await supabase
    .from('raffle_entries')
    .update({ is_winner: true, drawn_at })
    .eq('id', pick.id)
    .select('id, name, drawn_at')
    .single();
  if (updErr) {
    return NextResponse.json({ error: 'crown_failed', detail: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, winner: updated });
}

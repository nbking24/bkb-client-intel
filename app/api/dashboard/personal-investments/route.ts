// @ts-nocheck
/**
 * GET /api/dashboard/personal-investments
 *
 * Nathan-only. Serves the Personal & Investments snapshot that the monthly
 * close (a scheduled Cowork task reading Stessa) writes into
 * personal_investments_snapshot. key='current' is the latest close; one row
 * per closed month (key='YYYY-MM') is kept as history.
 *
 * Stricter than the other owner pages on purpose: this holds personal
 * finances, so the request must come from user 'nathan' AND the PIN inside
 * the token must match the PIN stored at login. A token that only claims to
 * be Nathan is refused.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_USER = 'nathan';

async function isNathan(req: NextRequest): Promise<boolean> {
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return false;
  let parts: string[] = [];
  try {
    parts = Buffer.from(h.slice(7), 'base64').toString().split(':');
  } catch {
    return false;
  }
  if (parts.length < 3) return false;
  const [pin, userId] = parts;
  if (userId !== ALLOWED_USER || !pin) return false;
  try {
    const { data } = await getSupabase()
      .from('agent_cache')
      .select('data')
      .eq('key', `user-pin:${ALLOWED_USER}`)
      .maybeSingle();
    const stored = data?.data?.pinHash ? Buffer.from(data.data.pinHash, 'base64').toString() : null;
    return !!stored && stored === pin;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!(await isNathan(req))) {
    return NextResponse.json({ error: 'This page is private.' }, { status: 403 });
  }
  const sb = getSupabase();
  const { data: rows, error } = await sb
    .from('personal_investments_snapshot')
    .select('key, payload, computed_at, source')
    .order('key', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const current = (rows || []).find((r: any) => r.key === 'current') || null;
  const history = (rows || [])
    .filter((r: any) => /^\d{4}-\d{2}$/.test(r.key))
    .map((r: any) => ({ period: r.key, computedAt: r.computed_at }));

  return NextResponse.json({
    hasSnapshot: !!current,
    snapshot: current?.payload || null,
    computedAt: current?.computed_at || null,
    source: current?.source || null,
    closedMonths: history,
  });
}

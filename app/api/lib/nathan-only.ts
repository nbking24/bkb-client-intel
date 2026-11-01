// @ts-nocheck
/**
 * Nathan-only gate for personal-finance endpoints.
 *
 * Stricter than the owner-role check other pages use: the request must come
 * from user 'nathan' AND the PIN inside the token must match the PIN stored
 * at login. A token that only claims to be Nathan is refused.
 */
import { NextRequest } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';

const ALLOWED_USER = 'nathan';

export async function isNathan(req: NextRequest): Promise<boolean> {
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

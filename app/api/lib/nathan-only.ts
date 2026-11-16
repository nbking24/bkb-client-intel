// @ts-nocheck
/**
 * Nathan-only gate for personal-finance endpoints.
 *
 * Stricter than the owner-role check other pages use: the request must come
 * from user 'nathan' with a server-signed token. The shared master PIN does
 * not open these endpoints.
 */
import { NextRequest } from 'next/server';
import { verifyToken } from '@/app/api/lib/auth-token';

const ALLOWED_USER = 'nathan';

export async function isNathan(req: NextRequest): Promise<boolean> {
  const h = req.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ')) return false;
  return verifyToken(h.slice(7)) === ALLOWED_USER;
}

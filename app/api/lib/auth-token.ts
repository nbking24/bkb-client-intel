import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed session tokens.
 *
 * Token = base64("s:<userId>:<issuedMs>:<sig>"), sig = HMAC-SHA256 over
 * "<userId>:<issuedMs>" with a server-only secret. The shape keeps the
 * client's decodeToken() working (parts[1] is still the userId) while the
 * server can prove the token was issued by /api/auth. The PIN is no longer
 * carried inside the token.
 */
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function secret(): string | null {
  return process.env.AUTH_TOKEN_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function issueToken(userId: string): string {
  const key = secret();
  if (!key) throw new Error('No auth signing secret configured');
  const ts = Date.now();
  const sig = sign(`${userId}:${ts}`, key);
  return Buffer.from(`s:${userId}:${ts}:${sig}`).toString('base64');
}

/** Returns the userId when the token is a valid, unexpired signed token. */
export function verifyToken(token: string): string | null {
  const key = secret();
  if (!key) return null;
  let parts: string[];
  try {
    parts = Buffer.from(token, 'base64').toString().split(':');
  } catch {
    return null;
  }
  if (parts.length !== 4 || parts[0] !== 's') return null;
  const [, userId, tsStr, sig] = parts;
  const ts = Number(tsStr);
  if (!userId || !Number.isFinite(ts)) return null;
  if (Date.now() - ts > MAX_AGE_MS || ts - Date.now() > 5 * 60 * 1000) return null;
  const expected = Buffer.from(sign(`${userId}:${ts}`, key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return userId;
}

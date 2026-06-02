// HMAC-signed state parameter for the Google OAuth round-trip.
//
// The /api/auth/google-connect endpoint embeds the target userId in the
// `state` query param sent to Google. Google echoes that back on the callback,
// where we must trust that it really came from us (otherwise anyone could
// trigger a connect-callback for an arbitrary userId and link their own
// Google account to someone else's profile). The signature stops that.
import crypto from 'crypto';

function stateSecret(): string {
  return (
    process.env.GOOGLE_STATE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.APP_PIN ||
    'bkb-dev-fallback-secret'
  );
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/** Sign a state payload for OAuth. Default TTL = 15 minutes. */
export function signOauthState(userId: string, ttlMs = 15 * 60 * 1000): string {
  const payload = JSON.stringify({ userId, exp: Date.now() + ttlMs });
  const body = b64url(Buffer.from(payload, 'utf8'));
  const sig = b64url(crypto.createHmac('sha256', stateSecret()).update(body).digest());
  return `${body}.${sig}`;
}

/** Verify a signed state. Returns the embedded userId or null if invalid/expired. */
export function verifyOauthState(state: string | null | undefined): { userId: string } | null {
  if (!state || !state.includes('.')) return null;
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', stateSecret()).update(body).digest());
  // Constant-time compare
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8'));
    if (typeof payload.userId !== 'string') return null;
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

// GET /api/auth/google-callback?code=...&state=<signed>
//
// Google redirects here after a user grants consent on Google's side. We
// verify the signed state (it embeds the BKB userId we're linking), exchange
// the auth code for tokens, fetch the linked Google account's email for
// display, and persist the refresh token on that user's app_users row.
import { NextRequest, NextResponse } from 'next/server';
import { setUserGoogleLink, getAppUser } from '@/app/lib/access';
import { verifyOauthState } from '@/app/lib/google-oauth-state';
import { clearGoogleTokenCache } from '@/app/lib/google-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function htmlPage(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!DOCTYPE html><html><head><title>${title}</title>
<style>
  body{font-family:system-ui;max-width:560px;margin:60px auto;padding:24px;color:#1a1a1a}
  h1{font-size:20px;color:#c88c00;margin:0 0 12px}
  .ok h1{color:#15803d}.bad h1{color:#c45c4c}
  p{color:#5a5550;line-height:1.5}
  code{background:#f0ede8;padding:2px 6px;border-radius:4px;font-size:13px}
  .btn{display:inline-block;margin-top:18px;padding:10px 16px;background:#c88c00;color:#fff;border-radius:8px;text-decoration:none;font-weight:600}
</style></head><body>${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html' } }
  );
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return htmlPage('Google connect cancelled',
      `<div class="bad"><h1>Connection cancelled</h1><p>Google returned: <code>${error}</code></p><a class="btn" href="/dashboard/admin">Back to Admin</a></div>`);
  }
  if (!code || !state) {
    return htmlPage('Google connect — invalid',
      `<div class="bad"><h1>Missing code or state</h1><p>This URL must be reached via the admin <em>Connect Google</em> flow.</p></div>`, 400);
  }

  const verified = verifyOauthState(state);
  if (!verified) {
    return htmlPage('Google connect — invalid',
      `<div class="bad"><h1>Invalid or expired state</h1><p>Please restart the connection from the admin dashboard.</p><a class="btn" href="/dashboard/admin">Back to Admin</a></div>`, 400);
  }

  const target = await getAppUser(verified.userId);
  if (!target) {
    return htmlPage('Google connect — invalid',
      `<div class="bad"><h1>Unknown user</h1><p>The user referenced in this connection link no longer exists.</p></div>`, 404);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return htmlPage('Google connect — server',
      `<div class="bad"><h1>Server misconfigured</h1><p>GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing on the server.</p></div>`, 500);
  }

  const redirectUri = `${req.nextUrl.origin}/api/auth/google-callback`;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();

    if (tokens.error || !tokens.refresh_token) {
      // The most common cause is "refresh_token not returned" — this happens
      // when the user previously authorised the same OAuth client and Google
      // skips issuing a new one. The connect route already sends
      // prompt=consent specifically to avoid this, but if it still happens
      // the user must revoke our app at myaccount.google.com and re-try.
      return htmlPage('Google connect — failed',
        `<div class="bad"><h1>Couldn't get a refresh token</h1>
         <p>${tokens.error_description || tokens.error || 'No refresh_token in Google\'s response.'}</p>
         <p>If this is a re-link, please revoke the BKB Hub at
         <a href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a> and try again.</p>
         <a class="btn" href="/dashboard/admin">Back to Admin</a></div>`, 400);
    }

    // Fetch the linked account's email (display only — proves which account was linked).
    let linkedEmail: string | null = null;
    try {
      const ui = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (ui.ok) {
        const info = await ui.json();
        linkedEmail = info.email || null;
      }
    } catch { /* non-fatal */ }

    await setUserGoogleLink(verified.userId, tokens.refresh_token, linkedEmail);
    // Drop any cached access token for this user so the next Google API call
    // refreshes off the just-saved token instead of the old one.
    clearGoogleTokenCache(verified.userId);

    return htmlPage('Google connected', `<div class="ok">
      <h1>Google account linked</h1>
      <p>${target.name}${linkedEmail ? ` is now connected to <code>${linkedEmail}</code>` : ' is now connected'}. Their dashboard will pull from this account's Calendar and Gmail.</p>
      <a class="btn" href="/dashboard/admin">Back to Admin</a>
    </div>`);
  } catch (err: any) {
    return htmlPage('Google connect — error',
      `<div class="bad"><h1>Error</h1><p>${err?.message || String(err)}</p></div>`, 500);
  }
}

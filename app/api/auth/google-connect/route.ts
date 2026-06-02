// GET /api/auth/google-connect?userId=<id>&token=<owner-bearer-token>
//
// Owner-only. Kicks off the Google OAuth consent flow for the target user,
// embedding a signed state so the callback can safely save the issued refresh
// token to *that* user's row.
//
// The auth token is passed as a query param (instead of a header) because the
// admin UI opens this URL via window.open() — browsers don't attach headers
// to top-level navigations. We re-use the same Bearer token validateAuth reads.
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getAppUser, isOwner } from '@/app/lib/access';
import { signOauthState } from '@/app/lib/google-oauth-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function htmlError(message: string, status = 400) {
  return new NextResponse(
    `<!DOCTYPE html><html><head><title>Connect Google</title>
<style>body{font-family:system-ui;max-width:520px;margin:60px auto;padding:24px;color:#1a1a1a}
h1{color:#c45c4c;font-size:18px}p{color:#5a5550}</style></head>
<body><h1>Can't start Google connection</h1><p>${message}</p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html' } }
  );
}

export async function GET(req: NextRequest) {
  const userId = (req.nextUrl.searchParams.get('userId') || '').trim();
  const token = req.nextUrl.searchParams.get('token') || '';
  const authHeader = token ? `Bearer ${token}` : req.headers.get('authorization');

  const auth = validateAuth(authHeader);
  if (!auth.valid || !auth.userId) {
    return htmlError('You must be signed in as an owner to connect a Google account.', 401);
  }
  if (!(await isOwner(auth.userId))) {
    return htmlError('Only an owner can link a Google account for a user.', 403);
  }

  if (!userId) return htmlError('Missing userId.', 400);
  const target = await getAppUser(userId);
  if (!target) return htmlError(`Unknown user "${userId}".`, 404);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return htmlError('GOOGLE_CLIENT_ID is not configured on the server.', 500);

  const redirectUri = `${req.nextUrl.origin}/api/auth/google-callback`;
  const scopes = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar.readonly',
  ].join(' ');

  const state = signOauthState(userId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    // `consent` forces Google to return a fresh refresh_token even if the user
    // has previously approved this OAuth client. Without it, re-linking a
    // different account silently fails because refresh_token isn't re-issued.
    prompt: 'consent',
    state,
    // Hint at the email field on the consent screen (Google may prefill).
    login_hint: target.googleEmail || target.email || '',
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}

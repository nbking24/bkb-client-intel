import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/google-callback?code=XXX
 *
 * OAuth callback handler. Exchanges the authorization code for tokens
 * and displays them for the admin to copy to Vercel env vars.
 * This is a one-time setup endpoint.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    return new NextResponse(`<h1>OAuth Error</h1><p>${error}</p>`, {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  if (!code) {
    // No code — redirect to Google OAuth consent
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return new NextResponse('GOOGLE_CLIENT_ID env var not set', { status: 500 });
    }
    const redirectUri = `${req.nextUrl.origin}/api/auth/google-callback`;
    const scopes = [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar.readonly',
    ].join(' ');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`;
    return NextResponse.redirect(authUrl);
  }

  // Exchange code for tokens
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${req.nextUrl.origin}/api/auth/google-callback`;

  if (!clientId || !clientSecret) {
    return new NextResponse('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set', { status: 500 });
  }

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

    if (tokens.error) {
      return new NextResponse(
        `<h1>Token Exchange Error</h1><pre>${JSON.stringify(tokens, null, 2)}</pre>`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Display tokens for admin to copy
    return new NextResponse(
      `<!DOCTYPE html>
<html><head><title>OAuth Setup Complete</title>
<style>body{font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px;background:#1a1a1a;color:#e8e0d8}
pre{background:#242424;padding:16px;border-radius:8px;overflow-x:auto;font-size:13px;border:1px solid rgba(205,162,116,0.12)}
h1{color:#CDA274}h2{color:#8a8078}code{color:#22c55e}</style></head>
<body>
<h1>OAuth Setup Complete!</h1>
<p>Add these to your Vercel environment variables:</p>
<h2>GOOGLE_REFRESH_TOKEN</h2>
<pre><code>${tokens.refresh_token || 'NOT RETURNED — you may need to revoke access and retry'}</code></pre>
<h2>GOOGLE_ACCESS_TOKEN (temporary, will auto-refresh)</h2>
<pre><code>${tokens.access_token}</code></pre>
<h2>Token Details</h2>
<pre>${JSON.stringify(tokens, null, 2)}</pre>
<p style="color:#8a8078;margin-top:20px">You can close this page now. The refresh token never expires unless revoked.</p>
</body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } catch (err: any) {
    return new NextResponse(`<h1>Error</h1><pre>${err.message}</pre>`, {
      headers: { 'Content-Type': 'text/html' },
      status: 500,
    });
  }
}

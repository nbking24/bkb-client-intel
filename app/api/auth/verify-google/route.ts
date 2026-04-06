import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/verify-google?userId=nathan
 *
 * Temporary endpoint to verify which Google account a refresh token resolves to.
 * DELETE THIS AFTER USE.
 */

const REFRESH_TOKEN_ENV: Record<string, string> = {
  nathan: 'GOOGLE_REFRESH_TOKEN',
  terri: 'GOOGLE_REFRESH_TOKEN_TERRI',
};

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId') || 'nathan';
    const envName = REFRESH_TOKEN_ENV[userId] || 'GOOGLE_REFRESH_TOKEN';
    const refreshToken = process.env[envName];

    if (!refreshToken) {
      return NextResponse.json({ error: `No refresh token found in ${envName}` }, { status: 400 });
    }

    // Exchange refresh token for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      return NextResponse.json({ error: 'Token refresh failed', details: err }, { status: 500 });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Use Gmail profile API to identify the account (we know this scope works)
    const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const gmailProfile = gmailRes.ok ? await gmailRes.json() : { error: `Gmail profile failed: ${gmailRes.status}` };

    // Also try Calendar settings to see which calendar account
    const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const calProfile = calRes.ok ? await calRes.json() : { error: `Calendar failed: ${calRes.status}` };

    return NextResponse.json({
      userId,
      envVar: envName,
      gmail: {
        emailAddress: gmailProfile.emailAddress,
        messagesTotal: gmailProfile.messagesTotal,
        threadsTotal: gmailProfile.threadsTotal,
      },
      calendar: {
        id: calProfile.id,
        summary: calProfile.summary,
        timeZone: calProfile.timeZone,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

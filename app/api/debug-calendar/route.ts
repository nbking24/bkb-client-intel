import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/debug-calendar?userId=nathan
 *
 * Temporary endpoint to list raw calendar events from Google Calendar API.
 * Shows exactly what events the API returns for the next 14 days.
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
      return NextResponse.json({ error: `No refresh token in ${envName}` }, { status: 400 });
    }

    // Get access token
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

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return NextResponse.json({ error: 'No access token', tokenData }, { status: 500 });
    }

    // Fetch primary calendar events for next 14 days
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      `timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
      `&singleEvents=true&orderBy=startTime&maxResults=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const calData = await calRes.json();

    // Also get calendar list to see ALL calendars this account has access to
    const listRes = await fetch(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const calList = await listRes.json();

    // Format events with organizer info
    const events = (calData.items || []).map((e: any) => ({
      summary: e.summary || '(No title)',
      start: e.start?.dateTime || e.start?.date || '',
      organizer: e.organizer?.email || 'unknown',
      creator: e.creator?.email || 'unknown',
      status: e.status,
      attendees: (e.attendees || []).map((a: any) => a.email),
    }));

    // Format calendar list
    const calendars = (calList.items || []).map((c: any) => ({
      id: c.id,
      summary: c.summary,
      primary: c.primary || false,
      accessRole: c.accessRole,
    }));

    return NextResponse.json({
      userId,
      envVar: envName,
      calendarOwner: calData.summary,
      eventCount: events.length,
      events,
      subscribedCalendars: calendars,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

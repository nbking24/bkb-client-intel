// TEMPORARY — DELETE THIS FILE after fixing the calendar title template
import { NextRequest, NextResponse } from 'next/server';

const GHL_BASE = 'https://services.leadconnectorhq.com';
// Expires: this endpoint is only valid while deployed. Remove after use.
const TEMP_SECRET = 'bkb-cal-fix-2026';

function headers() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== TEMP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const calendarId = req.nextUrl.searchParams.get('calendarId') || '229P4MHIrdFP31JX7EWH';

  try {
    const res = await fetch(`${GHL_BASE}/calendars/${calendarId}`, { headers: headers() });
    const body = await res.json();
    return NextResponse.json({ status: res.status, calendar: body }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== TEMP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const calendarId = req.nextUrl.searchParams.get('calendarId') || '229P4MHIrdFP31JX7EWH';

  try {
    const updates = await req.json();
    const res = await fetch(`${GHL_BASE}/calendars/${calendarId}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(updates),
    });
    const body = await res.json();
    return NextResponse.json({ status: res.status, result: body }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

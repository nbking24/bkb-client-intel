// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';

const GHL_BASE = 'https://services.leadconnectorhq.com';

function headers() {
  return {
    Authorization: 'Bearer ' + (process.env.GHL_API_KEY || ''),
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

export async function GET(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization')).valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const testContactId = req.nextUrl.searchParams.get('contactId') || '';
  const locationId = process.env.GHL_LOCATION_ID || '';

  const results: Record<string, any> = {
    timestamp: new Date().toISOString(),
    envCheck: {
      GHL_API_KEY: process.env.GHL_API_KEY ? 'SET (' + process.env.GHL_API_KEY.slice(0, 8) + '...)' : 'MISSING',
      GHL_LOCATION_ID: locationId ? 'SET (' + locationId + ')' : 'MISSING',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING',
      JOBTREAD_API_KEY: process.env.JOBTREAD_API_KEY ? 'SET' : 'MISSING',
    },
  };

  // Test 1: Contact lookup
  if (testContactId) {
    try {
      const res = await fetch(GHL_BASE + '/contacts/' + testContactId, { headers: headers() });
      const body = await res.text();
      results.contactLookup = {
        status: res.status,
        ok: res.ok,
        bodyPreview: body.slice(0, 300),
      };
    } catch (err) {
      results.contactLookup = { error: err instanceof Error ? err.message : 'Failed' };
    }
  }

  // Test 2: Conversations search
  if (testContactId && locationId) {
    try {
      const url = GHL_BASE + '/conversations/search?locationId=' + locationId + '&contactId=' + testContactId;
      const res = await fetch(url, { headers: headers() });
      const body = await res.text();
      results.conversationSearch = {
        status: res.status,
        ok: res.ok,
        bodyPreview: body.slice(0, 500),
      };
    } catch (err) {
      results.conversationSearch = { error: err instanceof Error ? err.message : 'Failed' };
    }
  }

  // Test 3: Contact notes
  if (testContactId) {
    try {
      const res = await fetch(GHL_BASE + '/contacts/' + testContactId + '/notes', { headers: headers() });
      const body = await res.text();
      results.contactNotes = {
        status: res.status,
        ok: res.ok,
        bodyPreview: body.slice(0, 300),
      };
    } catch (err) {
      results.contactNotes = { error: err instanceof Error ? err.message : 'Failed' };
    }
  }

  // Test 4: Contact tasks
  if (testContactId) {
    try {
      const res = await fetch(GHL_BASE + '/contacts/' + testContactId + '/tasks', { headers: headers() });
      const body = await res.text();
      results.contactTasks = {
        status: res.status,
        ok: res.ok,
        bodyPreview: body.slice(0, 300),
      };
    } catch (err) {
      results.contactTasks = { error: err instanceof Error ? err.message : 'Failed' };
    }
  }

  // Test 5: Pipelines (general GHL connectivity test)
  try {
    const res = await fetch(GHL_BASE + '/opportunities/pipelines?locationId=' + locationId, { headers: headers() });
    const body = await res.text();
    results.pipelines = {
      status: res.status,
      ok: res.ok,
      bodyPreview: body.slice(0, 300),
    };
  } catch (err) {
    results.pipelines = { error: err instanceof Error ? err.message : 'Failed' };
  }

  // Test 6: Calendar events debug
  try {
    // Fetch all calendars
    const calRes = await fetch(GHL_BASE + '/calendars/?locationId=' + locationId, { headers: headers() });
    const calData = await calRes.json();
    const calendars = calData.calendars || [];
    results.calendars = calendars.map((c: any) => ({ id: c.id, name: c.name }));

    // Fetch events from each calendar for next 60 days
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const allCalEvents: any[] = [];

    for (const cal of calendars) {
      try {
        const evUrl = `${GHL_BASE}/calendars/events?locationId=${locationId}&startTime=${encodeURIComponent(now.toISOString())}&endTime=${encodeURIComponent(end.toISOString())}&calendarId=${cal.id}`;
        const evRes = await fetch(evUrl, { headers: headers() });
        const evData = await evRes.json();
        const events = evData.events || [];
        for (const ev of events) {
          allCalEvents.push({
            calendarName: cal.name,
            id: ev.id,
            title: ev.title || ev.name,
            startTime: ev.startTime,
            endTime: ev.endTime,
            contactId: ev.contactId,
            contactName: ev.contact ? `${ev.contact.firstName || ''} ${ev.contact.lastName || ''}`.trim() : null,
            status: ev.status || ev.appointmentStatus,
            allKeys: Object.keys(ev),
          });
        }
      } catch (e: any) {
        allCalEvents.push({ calendarName: cal.name, error: e.message });
      }
    }
    results.calendarEvents = { count: allCalEvents.length, events: allCalEvents };
  } catch (err: any) {
    results.calendarEvents = { error: err.message };
  }

  return NextResponse.json(results, { status: 200 });
}

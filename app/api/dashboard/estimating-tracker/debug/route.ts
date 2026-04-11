// @ts-nocheck
// Temporary debug endpoint — remove after fixing calendar events
import { NextResponse } from 'next/server';
import { getCalendars, getCalendarEvents } from '@/app/lib/ghl';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  try {
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const results: any = { timestamp: now.toISOString() };

    // 1. Fetch calendars
    const calendars = await getCalendars();
    results.calendars = calendars.map((c: any) => ({ id: c.id, name: c.name }));

    // 2. Fetch events from each calendar
    const allEvents: any[] = [];
    for (const cal of calendars) {
      try {
        const events = await getCalendarEvents({
          startTime: now.toISOString(),
          endTime: end.toISOString(),
          calendarId: cal.id,
        });
        for (const ev of events || []) {
          allEvents.push({
            calendarName: cal.name,
            id: ev.id,
            title: ev.title || ev.name,
            startTime: ev.startTime,
            endTime: ev.endTime,
            contactId: ev.contactId,
            contactName: ev.contact ? `${ev.contact?.firstName || ''} ${ev.contact?.lastName || ''}`.trim() : null,
            status: ev.status || ev.appointmentStatus,
            keys: Object.keys(ev),
          });
        }
      } catch (e: any) {
        allEvents.push({ calendarName: cal.name, error: e.message });
      }
    }

    results.eventCount = allEvents.length;
    results.events = allEvents;

    return NextResponse.json(results);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

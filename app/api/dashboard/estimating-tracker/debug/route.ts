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

    // 3. Also try the appointments-based approach (search contacts' appointments)
    // Some GHL setups store meetings as contact appointments, not calendar events
    const GHL_BASE = 'https://services.leadconnectorhq.com';
    const testContactIds = [
      { name: 'Adams', id: 'QiMJubX9DOU6FftwKyql' },
      { name: 'Pocius', id: 'TuxTgGsOFZdsd2JZuHbE' },
    ];

    const contactAppointments: any[] = [];
    for (const tc of testContactIds) {
      try {
        // Try fetching appointments for this contact
        const apptRes = await fetch(
          `${GHL_BASE}/contacts/${tc.id}/appointments`,
          {
            headers: {
              Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
              'Content-Type': 'application/json',
              Version: '2021-07-28',
            },
          }
        );
        const apptText = await apptRes.text();
        contactAppointments.push({
          contact: tc.name,
          contactId: tc.id,
          status: apptRes.status,
          response: apptText.slice(0, 1000),
        });
      } catch (e: any) {
        contactAppointments.push({ contact: tc.name, error: e.message });
      }
    }
    results.contactAppointments = contactAppointments;

    // 4. Try searching for events without calendarId (location-wide)
    try {
      const locationEvRes = await fetch(
        `${GHL_BASE}/calendars/events?locationId=${process.env.GHL_LOCATION_ID || ''}&startTime=${encodeURIComponent(now.toISOString())}&endTime=${encodeURIComponent(end.toISOString())}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
            'Content-Type': 'application/json',
            Version: '2021-07-28',
          },
        }
      );
      const locationEvText = await locationEvRes.text();
      results.locationWideEvents = {
        status: locationEvRes.status,
        response: locationEvText.slice(0, 2000),
      };
    } catch (e: any) {
      results.locationWideEvents = { error: e.message };
    }

    return NextResponse.json(results);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

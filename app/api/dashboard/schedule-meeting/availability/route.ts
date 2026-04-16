// ============================================================
// Free Slots / Availability - Fetch available time slots for a GHL calendar
//
// GET /api/dashboard/schedule-meeting/availability?calendarId=X&date=YYYY-MM-DD
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getFreeSlots, getCalendarEvents } from '@/app/lib/ghl';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const calendarId = searchParams.get('calendarId');
    const date = searchParams.get('date'); // YYYY-MM-DD

    if (!calendarId || !date) {
      return NextResponse.json(
        { error: 'calendarId and date are required' },
        { status: 400 }
      );
    }

    // Fetch free slots from GHL for the given date
    const data = await getFreeSlots({
      calendarId,
      startDate: date,
      endDate: date,
      timezone: 'America/New_York',
    });

    // GHL returns slots keyed by date: { "YYYY-MM-DD": { "slots": ["2026-04-21T12:00:00-04:00", ...] } }
    // Or sometimes as an object with slot objects: { "YYYY-MM-DD": { "slots": [{ "slot": "..." }] } }
    // Normalize to a flat array of ISO time strings
    const slots: string[] = [];

    if (data && typeof data === 'object') {
      for (const [, dayData] of Object.entries(data)) {
        const daySlots = (dayData as any)?.slots || [];
        for (const s of daySlots) {
          if (typeof s === 'string') {
            slots.push(s);
          } else if (s?.slot) {
            slots.push(s.slot);
          }
        }
      }
    }

    // Also fetch existing events for context (show busy times)
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);
    let events: any[] = [];
    try {
      events = await getCalendarEvents({
        startTime: dayStart.toISOString(),
        endTime: dayEnd.toISOString(),
        calendarId,
      });
    } catch {
      // Non-fatal — slots are the primary data
    }

    return NextResponse.json({
      success: true,
      date,
      calendarId,
      slots,
      events: events.map((e: any) => ({
        id: e.id,
        title: e.title,
        startTime: e.startTime,
        endTime: e.endTime,
        status: e.appointmentStatus || e.status,
      })),
    });
  } catch (err: any) {
    console.error('[availability] Error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch availability' },
      { status: 500 }
    );
  }
}

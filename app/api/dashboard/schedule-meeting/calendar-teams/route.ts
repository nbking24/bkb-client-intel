// @ts-nocheck
/**
 * GET /api/dashboard/schedule-meeting/calendar-teams
 *
 * One-shot diagnostic that returns every calendar in the location plus the
 * GHL user IDs on its team. Used to figure out which calendar belongs to
 * which BKB attendee (Nathan, Brett, Evan, etc.) so we can route per-user
 * appointments correctly. Read-only; no side effects.
 */
import { NextResponse } from 'next/server';

const GHL_BASE = 'https://services.leadconnectorhq.com';

function headers() {
  return {
    Authorization: 'Bearer ' + (process.env.GHL_API_KEY || ''),
    'Content-Type': 'application/json',
    Version: '2021-04-15',
  };
}

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  const locationId = process.env.GHL_LOCATION_ID || '';
  try {
    const listRes = await fetch(`${GHL_BASE}/calendars/?locationId=${locationId}`, {
      headers: headers(),
    });
    if (!listRes.ok) {
      return NextResponse.json({ error: `list failed: ${listRes.status}` }, { status: 500 });
    }
    const { calendars = [] } = await listRes.json();

    // For each calendar, fetch full detail (team members are usually only on detail).
    const detailed = await Promise.all(
      calendars.map(async (c: any) => {
        try {
          const r = await fetch(`${GHL_BASE}/calendars/${c.id}`, { headers: headers() });
          if (!r.ok) return { id: c.id, name: c.name, error: `detail ${r.status}` };
          const d = await r.json();
          const cal = d.calendar || d;
          const teamMembers = (cal.teamMembers || []).map((tm: any) => ({
            userId: tm.userId,
            priority: tm.priority,
            isPrimary: tm.isPrimary,
            selected: tm.selected,
          }));
          return {
            id: c.id,
            name: c.name,
            teamMembers,
          };
        } catch (err: any) {
          return { id: c.id, name: c.name, error: err.message };
        }
      })
    );

    return NextResponse.json({ calendars: detailed });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

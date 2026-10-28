// @ts-nocheck
/**
 * GET /api/cron/meeting-sync
 *
 * Every 10 minutes: Google Calendar -> JobTread 📅 tasks + Loop reminders.
 * All logic and the on/off switches: app/lib/meeting-sync/run.ts and the
 * meeting_sync_config row in Supabase.
 * Auth: Bearer CRON_SECRET or Vercel's x-vercel-cron header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runMeetingSync } from '@/app/lib/meeting-sync/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') || '';
  if (expected && auth === `Bearer ${expected}`) return true;
  if (req.headers.get('x-vercel-cron')) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const result = await runMeetingSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[cron meeting-sync]', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

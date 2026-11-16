// @ts-nocheck
/**
 * GET /api/cron/marketing-photo-weekly
 *
 * Marketing pipeline Step 5, the Friday run. Scheduled every 10 minutes from
 * 07:05 to 09:55 UTC on Fridays (about 2am ET in winter, just after the
 * nightly change detector at 07:00): the first call starts the
 * run and later calls continue it until every flagged job is done and the
 * email is sent. Does nothing while the run is switched off
 * (agent_cache marketing-weekly-config). Draft or live as described in
 * app/api/lib/marketing/weekly.ts.
 *
 * Auth: Bearer CRON_SECRET only.
 *
 * Style note: no em or en dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isConfigured } from '@/app/api/lib/ftp';
import { getWeeklyConfig, runWeeklyTick } from '@/app/api/lib/marketing/weekly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const config = await getWeeklyConfig();
  if (!config.enabled) return NextResponse.json({ skipped: 'The Friday run is switched off.' });
  if (!isConfigured()) return NextResponse.json({ error: 'FTP is not configured' });
  try {
    const r = await runWeeklyTick({ trigger: 'cron', deadlineMs: 240000 });
    return NextResponse.json({ date: r.date, mode: r.mode, finished: r.finished, emailed: r.emailed });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Friday run failed' });
  }
}

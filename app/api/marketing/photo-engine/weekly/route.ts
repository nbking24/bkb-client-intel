// @ts-nocheck
/**
 * Marketing pipeline Step 5 controls. Owner only.
 *
 * GET   today's Friday run (if any), the latest Run now or draft, the last
 *       finished live run, whether the schedule is on, and live or draft.
 * POST  { action: "run-now" }  run one step of a LIVE run now (call again
 *                              until finished is true). Sends new files to
 *                              Mike's FTP and emails him, exactly like Friday;
 *                              the next run only picks up what is newer.
 *       { action: "draft" }    run one step of a DRAFT run now (call again
 *                              until finished is true). Never changes the FTP
 *                              and records nothing as sent.
 *       { action: "enable" }   switch the Friday schedule on
 *       { action: "disable" }  switch it off
 *       { action: "live-on" }  set the Hub's live setting (live also needs
 *                              MARKETING_PHOTO_ENGINE_LIVE=true in Vercel)
 *       { action: "live-off" } clear it
 *
 * Style note: no em or en dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '@/app/api/lib/auth';
import { isConfigured } from '@/app/api/lib/ftp';
import { getLastLiveRun, getManualRun, getRun, getWeeklyConfig, isLive, liveChecks, runWeeklyTick, setHubLive, setWeeklyEnabled } from '@/app/api/lib/marketing/weekly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function owner(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (auth.role !== 'owner') return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { auth };
}

async function state() {
  return {
    config: await getWeeklyConfig(),
    live: await isLive(),
    checks: await liveChecks(),
    run: await getRun(),
    manualRun: await getManualRun(),
    lastLive: await getLastLiveRun(),
  };
}

export async function GET(req: NextRequest) {
  const { denied } = owner(req);
  if (denied) return denied;
  return NextResponse.json(await state());
}

export async function POST(req: NextRequest) {
  const { denied, auth } = owner(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'enable' || body.action === 'disable') {
      await setWeeklyEnabled(body.action === 'enable', auth.userId || null);
      return NextResponse.json({ config: await getWeeklyConfig() });
    }
    if (body.action === 'live-on' || body.action === 'live-off') {
      await setHubLive(body.action === 'live-on');
      return NextResponse.json({ live: await isLive(), checks: await liveChecks() });
    }
    if (body.action === 'draft' || body.action === 'run-now') {
      if (!isConfigured()) return NextResponse.json({ error: 'FTP is not configured' });
      const tick = await runWeeklyTick({ trigger: 'manual', forceDraft: body.action === 'draft', deadlineMs: 240000 });
      return NextResponse.json({ tick, ...(await state()) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' });
  }
}

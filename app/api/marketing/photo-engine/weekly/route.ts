// @ts-nocheck
/**
 * Marketing pipeline Step 5 controls. Owner only.
 *
 * GET   today's run (if any), whether the schedule is on, and live or draft.
 * POST  { action: "draft" }    run one step of a DRAFT run now (call again
 *                              until finished is true). Never changes the FTP.
 *       { action: "enable" }   switch the Friday schedule on
 *       { action: "disable" }  switch it off
 *
 * Style note: no em or en dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '@/app/api/lib/auth';
import { isConfigured } from '@/app/api/lib/ftp';
import { getRun, getWeeklyConfig, isLive, runWeeklyTick, setWeeklyEnabled } from '@/app/api/lib/marketing/weekly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function owner(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (auth.role !== 'owner') return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { auth };
}

export async function GET(req: NextRequest) {
  const { denied } = owner(req);
  if (denied) return denied;
  return NextResponse.json({ config: await getWeeklyConfig(), live: await isLive(), run: await getRun() });
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
    if (body.action === 'draft') {
      if (!isConfigured()) return NextResponse.json({ error: 'FTP is not configured' });
      const existing = await getRun();
      if (existing && existing.mode === 'live') {
        return NextResponse.json({ error: "Today's run is a live run; a draft cannot be started on the same day." });
      }
      return NextResponse.json(await runWeeklyTick({ trigger: 'manual', forceDraft: true, deadlineMs: 240000 }));
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' });
  }
}

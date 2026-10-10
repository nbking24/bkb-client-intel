// @ts-nocheck
/**
 * GET /api/cron/planning-brief
 *
 * Tuesday 10:00 UTC (6 am Eastern in summer, 5 am in winter): rebuild the Prep
 * Brief for the open planning meeting from JobTread, so it is ready before
 * Heather works through it. Creates the meeting if there is none yet.
 * Auth: Bearer CRON_SECRET or Vercel's x-vercel-cron header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { getOrCreateDraft, refreshBrief } from '@/app/lib/planning-meeting/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
    const sb = getSupabase();
    const draft = await getOrCreateDraft('cron', sb);
    const updated = await refreshBrief(draft, sb);
    const jobs = updated.brief?.jobs || [];
    return NextResponse.json({ ok: true, meetingId: updated.id, meetingDate: updated.meeting_date, jobs: jobs.length, flags: jobs.reduce((n, j) => n + (j.flags?.length || 0), 0), errors: updated.brief?.errors || [] });
  } catch (e: any) {
    console.error('[cron planning-brief]', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

// @ts-nocheck
/**
 * /api/dashboard/planning-meeting
 *
 * GET   The open meeting (created for the next Tuesday if none), its Prep Brief
 *       (built from JobTread on first load), the last confirmed meeting (notes
 *       per job and its delta), on-hold jobs, meeting history and the people list.
 *       ?refresh=1 rebuilds the brief from JobTread first.
 * PUT   Autosave: { meetingId, state, plus?, delta?, meetingDate? }
 * POST  { action: 'hold', jobId, jobName, onHold, nextTouch?, reason? }  on-hold switch (Hub only)
 *
 * Writes to JobTread happen only in ./confirm and ./transcript.
 * Design: JobTread Assistant project, claude/BKB-Meetings-and-Job-Setup-Game-Plan-2026-10-10.md
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { authorize, getOrCreateDraft, refreshBrief, lastConfirmedMeeting, listHolds, listAllHolds, history } from '@/app/lib/planning-meeting/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const who = await authorize(req);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  try {
    const sb = getSupabase();
    let meeting = await getOrCreateDraft(who.userId, sb);
    const wantRefresh = req.nextUrl.searchParams.get('refresh') === '1';
    if (!meeting.brief || wantRefresh) meeting = await refreshBrief(meeting, sb);
    const [last, holds, holdsAll, hist] = await Promise.all([lastConfirmedMeeting(sb), listHolds(sb), listAllHolds(sb), history(sb)]);
    return NextResponse.json({
      meeting,
      lastMeeting: last ? { id: last.id, meeting_date: last.meeting_date, plus: last.plus, delta: last.delta, transcript_result: last.transcript_result || null, has_transcript: !!last.transcript, jobNames: Object.fromEntries((last.brief?.jobs || []).map((j) => [j.id, j.short])), jobs: Object.fromEntries(Object.entries(last.state?.jobs || {}).map(([k, v]: any) => [k, { notes: v.notes || '' }])) } : null,
      holds,
      holdsAll,
      history: hist,
      user: { id: who.userId, name: who.name },
    });
  } catch (e: any) {
    console.error('[planning-meeting GET]', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const who = await authorize(req);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const body = await req.json().catch(() => ({}));
  if (!body.meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 });
  const sb = getSupabase();
  const { data: cur } = await sb.from('planning_meetings').select('id, status').eq('id', body.meetingId).single();
  if (!cur) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
  if (cur.status !== 'draft') return NextResponse.json({ error: 'This meeting is already confirmed' }, { status: 409 });
  const patch: any = { updated_by: who.userId, updated_at: new Date().toISOString() };
  if (body.state) patch.state = body.state;
  if (typeof body.plus === 'string') patch.plus = body.plus;
  if (typeof body.delta === 'string') patch.delta = body.delta;
  if (/^\d{4}-\d{2}-\d{2}$/.test(body.meetingDate || '')) patch.meeting_date = body.meetingDate;
  const { data, error } = await sb.from('planning_meetings').update(patch).eq('id', body.meetingId).select('id, updated_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated_at: data.updated_at });
}

export async function POST(req: NextRequest) {
  const who = await authorize(req);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const body = await req.json().catch(() => ({}));
  if (body.action !== 'hold' || !body.jobId) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  const sb = getSupabase();
  const row = {
    job_id: body.jobId,
    job_name: body.jobName || null,
    on_hold: !!body.onHold,
    next_touch: /^\d{4}-\d{2}-\d{2}$/.test(body.nextTouch || '') ? body.nextTouch : null,
    reason: body.reason || null,
    set_by: who.userId,
    set_at: new Date().toISOString(),
  };
  const { error } = await sb.from('planning_job_holds').upsert(row, { onConflict: 'job_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const [holds, holdsAll] = await Promise.all([listHolds(sb), listAllHolds(sb)]);
  return NextResponse.json({ ok: true, holds, holdsAll });
}

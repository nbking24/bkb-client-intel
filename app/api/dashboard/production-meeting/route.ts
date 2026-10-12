// @ts-nocheck
/**
 * /api/dashboard/production-meeting
 *
 * GET   The open meeting (created for the next Monday if none), its Production
 *       Brief (built from JobTread and the money caches on first load), the last
 *       confirmed meeting (notes per job and its delta), history and the user.
 *       ?refresh=1 rebuilds the brief first. Dollar detail (job.money) is sent
 *       to owners only.
 * PUT   Autosave: { meetingId, state, plus?, delta?, meetingDate? }
 *
 * Writes to JobTread happen only in ./confirm.
 * Design: JobTread Assistant project, claude/BKB-Production-Meeting-Design-2026-10-12.md
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { productionNotesText } from '@/app/lib/production-meeting/constants';
import { stripMoney } from '@/app/lib/production-meeting/brief';
import { authorize, getOrCreateDraft, refreshBrief, lastConfirmedMeeting, history } from '@/app/lib/production-meeting/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const who = await authorize(req);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  try {
    const sb = getSupabase();
    let meeting = await getOrCreateDraft(who.userId, sb);
    const wantRefresh = req.nextUrl.searchParams.get('refresh') === '1';
    if (!meeting.brief || wantRefresh) meeting = await refreshBrief(meeting, sb);
    const [last, hist] = await Promise.all([lastConfirmedMeeting(sb), history(sb)]);
    const safe = { ...meeting, brief: who.isOwner ? meeting.brief : stripMoney(meeting.brief), write_log: undefined };
    return NextResponse.json({
      meeting: safe,
      lastMeeting: last ? {
        id: last.id, meeting_date: last.meeting_date, plus: last.plus, delta: last.delta,
        jobNames: Object.fromEntries((last.brief?.jobs || []).map((j) => [j.id, j.short])),
        jobs: Object.fromEntries(Object.entries(last.state?.jobs || {}).map(([k, v]: any) => [k, { notes: productionNotesText(v) }])),
      } : null,
      history: hist,
      user: { id: who.userId, name: who.name, isOwner: !!who.isOwner },
    });
  } catch (e: any) {
    console.error('[production-meeting GET]', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const who = await authorize(req);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const body = await req.json().catch(() => ({}));
  if (!body.meetingId) return NextResponse.json({ error: 'meetingId required' }, { status: 400 });
  const sb = getSupabase();
  const { data: cur } = await sb.from('production_meetings').select('id, status').eq('id', body.meetingId).single();
  if (!cur) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
  if (cur.status !== 'draft') return NextResponse.json({ error: 'This meeting is already confirmed' }, { status: 409 });
  const patch: any = { updated_by: who.userId, updated_at: new Date().toISOString() };
  if (body.state) patch.state = body.state;
  if (typeof body.plus === 'string') patch.plus = body.plus;
  if (typeof body.delta === 'string') patch.delta = body.delta;
  if (/^\d{4}-\d{2}-\d{2}$/.test(body.meetingDate || '')) patch.meeting_date = body.meetingDate;
  const { data, error } = await sb.from('production_meetings').update(patch).eq('id', body.meetingId).select('id, updated_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated_at: data.updated_at });
}

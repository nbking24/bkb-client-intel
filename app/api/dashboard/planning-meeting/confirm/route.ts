// @ts-nocheck
/**
 * POST /api/dashboard/planning-meeting/confirm   { meetingId }
 *
 * Writes the meeting to JobTread (tasks, task updates, gate ticks, marker
 * dates, one daily log per job). Safe to press again after a partial failure:
 * every write is logged under a key and finished keys are skipped. The meeting
 * is marked confirmed only when every write succeeded.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { authorize, saveCreatedTasks } from '@/app/lib/planning-meeting/store';
import { writeMeetingToJobTread } from '@/app/lib/planning-meeting/writeback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const who = await authorize(req);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const { meetingId } = await req.json().catch(() => ({}));
  const sb = getSupabase();
  const { data: meeting } = await sb.from('planning_meetings').select('*').eq('id', meetingId).single();
  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
  if (meeting.status !== 'draft') return NextResponse.json({ error: 'This meeting is already confirmed' }, { status: 409 });
  if (!meeting.brief?.jobs?.length) return NextResponse.json({ error: 'No Prep Brief on this meeting' }, { status: 400 });

  // Holds switched since this meeting was opened go into that job's daily log.
  const { data: holds } = await sb.from('planning_job_holds').select('*').gte('set_at', meeting.created_at);
  // Corrections to Claude's read made during this meeting go into the daily log too.
  const { data: context } = await sb.from('planning_job_context').select('*').is('removed_at', null).gte('created_at', meeting.created_at).order('created_at', { ascending: true });

  try {
    const res = await writeMeetingToJobTread(meeting, holds || [], context || []);
    await saveCreatedTasks(meeting.id, res.createdTasks, sb);
    const patch: any = { write_log: res.log, updated_at: new Date().toISOString(), updated_by: who.userId };
    const allOk = res.failed === 0;
    if (allOk) Object.assign(patch, { status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: who.userId });
    await sb.from('planning_meetings').update(patch).eq('id', meeting.id);
    const errors = res.log.filter((l) => !l.ok).slice(-20);
    return NextResponse.json({ ok: allOk, written: res.written, failed: res.failed, created: res.createdTasks.length, errors: allOk ? [] : errors });
  } catch (e: any) {
    console.error('[planning-meeting confirm]', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

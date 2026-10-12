// @ts-nocheck
/**
 * POST /api/dashboard/production-meeting/confirm   { meetingId }
 *
 * Writes the meeting to JobTread with the planning meeting's writeback
 * (new commitments and roadblocks in 🔵 ACTIVE, Done / New date / Drop on
 * existing tasks, one internal daily log per job titled "Production meeting").
 * Safe to press again after a partial failure: finished writes are skipped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { authorize, saveCreatedTasks } from '@/app/lib/production-meeting/store';
import { productionNotesText } from '@/app/lib/production-meeting/constants';
import { writeMeetingToJobTread } from '@/app/lib/planning-meeting/writeback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const who = await authorize(req);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const { meetingId } = await req.json().catch(() => ({}));
  const sb = getSupabase();
  const { data: meeting } = await sb.from('production_meetings').select('*').eq('id', meetingId).single();
  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
  if (meeting.status !== 'draft') return NextResponse.json({ error: 'This meeting is already confirmed' }, { status: 409 });
  if (!meeting.brief?.jobs?.length) return NextResponse.json({ error: 'No Production Brief on this meeting' }, { status: 400 });
  try {
    const res = await writeMeetingToJobTread(meeting, [], [], { label: 'production meeting', notesText: productionNotesText });
    await saveCreatedTasks(meeting.id, res.createdTasks, sb);
    const patch: any = { write_log: res.log, updated_at: new Date().toISOString(), updated_by: who.userId };
    const allOk = res.failed === 0;
    if (allOk) Object.assign(patch, { status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: who.userId });
    await sb.from('production_meetings').update(patch).eq('id', meeting.id);
    const errors = res.log.filter((l) => !l.ok).slice(-20);
    return NextResponse.json({ ok: allOk, written: res.written, failed: res.failed, created: res.createdTasks.length, errors: allOk ? [] : errors });
  } catch (e: any) {
    console.error('[production-meeting confirm]', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

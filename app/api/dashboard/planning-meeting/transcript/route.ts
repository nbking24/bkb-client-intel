// @ts-nocheck
/**
 * POST /api/dashboard/planning-meeting/transcript
 *   { meetingId, action: 'analyze', transcript }   Claude splits it by job and returns suggestions (nothing written)
 *   { meetingId, action: 'save', result }           keep approvals and edits while reviewing
 *   { meetingId, action: 'apply', result }          write the approved suggestions to JobTread
 * Works on the open meeting or a confirmed one (the transcript usually arrives after Confirm).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { authorize, saveCreatedTasks } from '@/app/lib/planning-meeting/store';
import { analyzeTranscript, applyTranscript } from '@/app/lib/planning-meeting/transcript';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const who = await authorize(req);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const body = await req.json().catch(() => ({}));
  const sb = getSupabase();
  const { data: meeting } = await sb.from('planning_meetings').select('*').eq('id', body.meetingId).single();
  if (!meeting) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
  const people = (meeting.brief?.members || []).map((m) => m.name);

  try {
    if (body.action === 'analyze') {
      const text = String(body.transcript || '').trim();
      if (text.length < 200) return NextResponse.json({ error: 'Paste the full transcript text' }, { status: 400 });
      const result = await analyzeTranscript(meeting, text, people);
      await sb.from('planning_meetings').update({ transcript: text, transcript_result: result, updated_at: new Date().toISOString() }).eq('id', meeting.id);
      return NextResponse.json({ ok: true, result });
    }
    if (body.action === 'save') {
      await sb.from('planning_meetings').update({ transcript_result: body.result }).eq('id', meeting.id);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'apply') {
      const result = body.result || meeting.transcript_result;
      const res = await applyTranscript(meeting, result, meeting.brief?.members || []);
      await saveCreatedTasks(meeting.id, res.createdTasks, sb);
      result.appliedAt = new Date().toISOString();
      await sb.from('planning_meetings').update({ write_log: res.log, transcript_result: result }).eq('id', meeting.id);
      return NextResponse.json({ ok: res.failed === 0, written: res.written, failed: res.failed, errors: res.log.filter((l) => !l.ok).slice(-10) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    console.error('[planning-meeting transcript]', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

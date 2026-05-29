// @ts-nocheck
/**
 * Plaud transcript webhook.
 *
 * Plaud (Developer Platform or a Zapier relay) POSTs here when a recording has
 * been transcribed. We verify a shared secret, dedupe on the Plaud ids, store
 * the transcript as 'unassigned', map it to the recorder's Hub user, and run
 * the calendar-aware matcher to pre-fill a best-guess job/lead. Nothing is
 * pushed to JobTread/PML here — that happens only after the recorder confirms.
 *
 * Auth: shared secret in header `x-plaud-secret` or `?secret=` query param,
 * compared against env PLAUD_WEBHOOK_SECRET. (Plaud cannot send our user auth.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { matchTranscript } from '@/app/lib/transcript-matcher';
import { searchContacts } from '@/app/api/lib/ghl';

export const dynamic = 'force-dynamic';

// Tolerant field extraction: the exact Plaud payload shape is finalized when
// the Developer Platform app is registered, so we check several likely paths.
function pick(obj: any, paths: string[]): any {
  for (const p of paths) {
    const val = p.split('.').reduce((o: any, k: string) => (o == null ? o : o[k]), obj);
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return null;
}

export async function POST(req: NextRequest) {
  // 1. Verify shared secret.
  const expected = process.env.PLAUD_WEBHOOK_SECRET;
  const provided = req.headers.get('x-plaud-secret') || req.nextUrl.searchParams.get('secret');
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const data = body?.data || body;
  const eventType = pick(body, ['event', 'event_type', 'type']) || 'transcript_ready';

  const transcript = pick(data, ['transcript', 'transcript_text', 'text', 'flattened_transcript', 'content']);
  // Non-transcript events (e.g. audio_ready) are acked and ignored.
  if (!transcript || String(transcript).trim().length === 0) {
    return NextResponse.json({ ok: true, skipped: 'no transcript on this event', eventType });
  }

  const recordingId = pick(data, ['recording_id', 'recordingId', 'id', 'file_id', 'fileId']);
  const eventId = pick(body, ['id', 'event_id', 'eventId']) || pick(data, ['event_id']) || eventType;
  const title = pick(data, ['title', 'name', 'summary_title']) || 'Untitled meeting';
  const recordedAt = pick(data, ['recorded_at', 'recordedAt', 'start_time', 'created_at', 'createdAt']);
  const durationSeconds = pick(data, ['duration', 'duration_seconds', 'length']);
  const audioUrl = pick(data, ['audio_url', 'audioUrl', 'file_url', 'recording_url']);
  const recorderIdentity = pick(data, ['member_email', 'owner_email', 'user_email', 'member_id', 'owner_id', 'device_id', 'deviceId']);

  const sb = getSupabase();

  // 2. Dedupe on (recording_id, event_id).
  if (recordingId) {
    const { data: existing } = await sb
      .from('meeting_transcripts')
      .select('id')
      .eq('plaud_recording_id', String(recordingId))
      .eq('plaud_event_id', String(eventId))
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, deduped: true, id: existing.id });
    }
  }

  // 3. Map recorder identity -> Hub user (fallback to default reviewer).
  let recordedByUser = process.env.PLAUD_DEFAULT_REVIEWER || 'nathan';
  if (recorderIdentity) {
    const { data: map } = await sb
      .from('plaud_user_map')
      .select('hub_user_id')
      .eq('plaud_identity', String(recorderIdentity))
      .maybeSingle();
    if (map?.hub_user_id) recordedByUser = map.hub_user_id;
  }

  // 4. Insert the unassigned transcript.
  const { data: inserted, error: insErr } = await sb
    .from('meeting_transcripts')
    .insert({
      plaud_recording_id: recordingId ? String(recordingId) : null,
      plaud_event_id: String(eventId),
      recorded_by_user: recordedByUser,
      title: String(title).slice(0, 300),
      recorded_at: recordedAt ? new Date(recordedAt).toISOString() : null,
      duration_seconds: durationSeconds ? Math.round(Number(durationSeconds)) : null,
      audio_url: audioUrl || null,
      raw_transcript: String(transcript),
      status: 'unassigned',
    })
    .select('id')
    .single();

  if (insErr) {
    return NextResponse.json({ error: 'Insert failed: ' + insErr.message }, { status: 500 });
  }

  // 5. Best-guess match (calendar + transcript). Best-effort; never blocks intake.
  try {
    const match = await matchTranscript({
      transcript: String(transcript),
      recordedAt: recordedAt ? new Date(recordedAt).toISOString() : null,
      recorderUserId: recordedByUser,
    });

    let leadContactId: string | null = null;
    let leadName: string | null = match.leadName || null;
    if (match.kind === 'lead' && match.leadName) {
      try {
        const contacts = await searchContacts(match.leadName);
        const first = Array.isArray(contacts) ? contacts[0] : (contacts?.contacts || [])[0];
        if (first?.id) {
          leadContactId = first.id;
          leadName = [first.firstName, first.lastName].filter(Boolean).join(' ') || match.leadName;
        }
      } catch { /* ignore lead resolution failure */ }
    }

    await sb
      .from('meeting_transcripts')
      .update({
        matched_calendar_event: match.calendarEvent || null,
        suggested_kind: match.kind === 'unknown' ? null : match.kind,
        suggested_job_id: match.kind === 'job' ? match.jobId : null,
        suggested_job_name: match.kind === 'job' ? match.jobName : null,
        suggested_lead_contact_id: leadContactId,
        suggested_lead_name: match.kind === 'lead' ? leadName : null,
        match_confidence: match.confidence,
        match_reasoning: match.reasoning,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inserted.id);
  } catch (err: any) {
    // Leave the row as unassigned with no suggestion; reviewer picks manually.
    await sb.from('meeting_transcripts')
      .update({ match_reasoning: 'Auto-match error: ' + (err?.message || 'unknown'), updated_at: new Date().toISOString() })
      .eq('id', inserted.id);
  }

  return NextResponse.json({ ok: true, id: inserted.id, recordedBy: recordedByUser });
}

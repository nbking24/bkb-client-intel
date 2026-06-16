// @ts-nocheck
/**
 * POST /api/transcripts/:id/confirm
 * The recorder confirms (or corrects) which job/lead a transcript belongs to.
 * On confirm we write the full transcript into project_events (PML) so the Ask
 * agent can query it immediately. Creating the JobTread daily-log summary and
 * attaching the transcript file is Phase 2.
 *
 * Body: { kind:'job'|'lead', jobId?, jobName?, leadContactId?, leadName? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '@/app/api/lib/supabase';
import { createProjectEvent } from '@/app/lib/project-memory';
import { processConfirmedTranscript } from '@/app/lib/meeting-processing';

export const dynamic = 'force-dynamic';
// Confirm also runs processConfirmedTranscript inline (summary + upload +
// JT createDailyLog), which can exceed the default 10s/60s cap on long
// transcripts. Match the retry route's 300s ceiling so a fresh confirm
// of an 80K+ char transcript doesn't 504 either.
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const kind = body?.kind;
  if (kind !== 'job' && kind !== 'lead') {
    return NextResponse.json({ error: 'kind must be "job" or "lead"' }, { status: 400 });
  }
  if (kind === 'job' && !body.jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });
  if (kind === 'lead' && !body.leadContactId && !body.leadName) {
    return NextResponse.json({ error: 'leadContactId or leadName required' }, { status: 400 });
  }

  const sb = getSupabase();
  const { data: row, error: loadErr } = await sb
    .from('meeting_transcripts').select('*').eq('id', params.id).maybeSingle();
  if (loadErr || !row) return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });

  // Only the recorder, or an owner/admin, may confirm.
  const isPrivileged = auth.role === 'owner' || auth.role === 'admin';
  if (!isPrivileged && row.recorded_by_user && row.recorded_by_user !== auth.userId) {
    return NextResponse.json({ error: 'Not your transcript' }, { status: 403 });
  }

  // Write the full transcript to PML (queryable by the Ask agent).
  let pmlEventId: string | null = null;
  try {
    const ev = await createProjectEvent({
      job_id: kind === 'job' ? String(body.jobId) : null,
      job_name: kind === 'job' ? (body.jobName || null) : null,
      channel: 'meeting',
      event_type: 'meeting_held',
      summary: row.title || 'Meeting transcript',
      detail: row.raw_transcript || '',
      event_date: row.recorded_at || null,
      source_ref: {
        source: 'plaud',
        plaud_recording_id: row.plaud_recording_id || null,
        audio_url: row.audio_url || null,
        calendar_event: row.matched_calendar_event || null,
        ...(kind === 'lead' && body.leadContactId ? { ghl_contact_id: String(body.leadContactId) } : {}),
        meeting_transcript_id: row.id,
      },
    });
    pmlEventId = ev?.id || null;
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to save to memory: ' + (err?.message || 'unknown') }, { status: 500 });
  }

  // Persist the assignment first (so it survives even if Phase 2 processing fails).
  const { error: updErr } = await sb
    .from('meeting_transcripts')
    .update({
      assigned_kind: kind,
      assigned_job_id: kind === 'job' ? String(body.jobId) : null,
      assigned_job_name: kind === 'job' ? (body.jobName || null) : null,
      assigned_lead_contact_id: kind === 'lead' ? (body.leadContactId || null) : null,
      assigned_lead_name: kind === 'lead' ? (body.leadName || null) : null,
      assigned_at: new Date().toISOString(),
      pml_event_id: pmlEventId,
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Phase 2: for a JobTread job, create the daily-log summary + attach the
  // transcript file. Leads have no job yet, so they stay 'confirmed' (queryable
  // via PML) until conversion, when backfillLeadTranscriptDailyLogs runs.
  if (kind === 'job') {
    try {
      await sb.from('meeting_transcripts').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', params.id);
      const out = await processConfirmedTranscript({
        sb,
        transcriptRowId: row.id,
        jobId: String(body.jobId),
        jobName: body.jobName || null,
        title: row.title,
        rawTranscript: row.raw_transcript || '',
        recordedAt: row.recorded_at,
      });
      await sb.from('meeting_transcripts').update({
        summary: out.summary, jt_daily_log_id: out.dailyLogId, jt_file_id: out.fileId,
        status: 'processed', error_note: out.fileError || null, updated_at: new Date().toISOString(),
      }).eq('id', params.id);
      return NextResponse.json({ ok: true, id: params.id, pmlEventId, status: 'processed', dailyLogId: out.dailyLogId, fileId: out.fileId, fileError: out.fileError || null });
    } catch (err: any) {
      // Transcript is saved + in PML; only the daily-log step failed. Mark retryable.
      await sb.from('meeting_transcripts').update({ status: 'failed', error_note: (err?.message || 'processing failed'), updated_at: new Date().toISOString() }).eq('id', params.id);
      return NextResponse.json({ ok: true, id: params.id, pmlEventId, status: 'failed', error: 'Saved to memory, but daily-log creation failed: ' + (err?.message || 'unknown') });
    }
  }

  return NextResponse.json({ ok: true, id: params.id, pmlEventId, status: 'confirmed' });
}

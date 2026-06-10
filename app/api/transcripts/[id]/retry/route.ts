// @ts-nocheck
/**
 * POST /api/transcripts/:id/retry
 *
 * Re-run the daily-log creation step for a transcript that is in 'failed'
 * status. Only applies to job-assigned transcripts (the only ones that
 * produce a daily log). Idempotent: if a daily log was already created on
 * a prior attempt the row will already be 'processed' and we 409 instead
 * of duplicating it.
 *
 * Body: none.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '@/app/api/lib/supabase';
import { processConfirmedTranscript } from '@/app/lib/meeting-processing';
import { deleteDailyLog } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabase();
  const { data: row, error: loadErr } = await sb
    .from('meeting_transcripts')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (loadErr || !row) return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });

  // Permission: same rule as confirm. Owner/admin always; otherwise only the
  // recorder. Field staff who weren't the recorder shouldn't be able to retry
  // someone else's meeting.
  const isPrivileged = auth.role === 'owner' || auth.role === 'admin';
  if (!isPrivileged && row.recorded_by_user && row.recorded_by_user !== auth.userId) {
    return NextResponse.json({ error: 'Not your transcript' }, { status: 403 });
  }

  if (row.assigned_kind !== 'job' || !row.assigned_job_id) {
    return NextResponse.json(
      { error: 'Retry only works for job-assigned transcripts. Assign the transcript to a job first.' },
      { status: 400 },
    );
  }
  if (!row.raw_transcript) {
    return NextResponse.json(
      { error: 'No raw transcript text on this row. Wait for transcription to finish, then retry.' },
      { status: 400 },
    );
  }

  // Force regenerate: when ?force=1 is passed, delete the existing JT daily
  // log and clear the row's link so processConfirmedTranscript writes a fresh
  // one. Used by the "Regenerate daily log" button when a previously-uploaded
  // log needs to be redone (e.g. it got truncated under the old 8000-char cap
  // and we want to re-run with the new 9500 cap).
  const force = req.nextUrl.searchParams.get('force') === '1';
  if (row.jt_daily_log_id) {
    if (!force) {
      return NextResponse.json(
        {
          error: `Transcript already has a daily log (${row.jt_daily_log_id}). Pass ?force=1 to delete it and regenerate.`,
          dailyLogId: row.jt_daily_log_id,
        },
        { status: 409 },
      );
    }
    // Best-effort delete of the prior JT daily log. We don't fail the
    // regenerate if the delete fails (e.g. JT permission, or the log was
    // already manually removed); we just log it and proceed.
    try {
      await deleteDailyLog(row.jt_daily_log_id);
    } catch (delErr: any) {
      console.warn('[retry] deleteDailyLog failed (continuing):', delErr?.message || delErr);
    }
    await sb
      .from('meeting_transcripts')
      .update({
        jt_daily_log_id: null,
        jt_file_id: null,
        summary: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id);
  }

  // Mark processing so the dashboard reflects the in-flight retry.
  await sb
    .from('meeting_transcripts')
    .update({ status: 'processing', updated_at: new Date().toISOString(), error_note: null })
    .eq('id', params.id);

  try {
    const out = await processConfirmedTranscript({
      sb,
      transcriptRowId: row.id,
      jobId: row.assigned_job_id,
      jobName: row.assigned_job_name || null,
      title: row.title,
      rawTranscript: row.raw_transcript || '',
      recordedAt: row.recorded_at,
    });
    await sb
      .from('meeting_transcripts')
      .update({
        summary: out.summary,
        jt_daily_log_id: out.dailyLogId,
        jt_file_id: out.fileId,
        status: 'processed',
        error_note: out.fileError || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id);
    return NextResponse.json({
      ok: true,
      id: params.id,
      status: 'processed',
      dailyLogId: out.dailyLogId,
      fileId: out.fileId,
      fileError: out.fileError || null,
    });
  } catch (err: any) {
    const msg = err?.message || 'processing failed';
    await sb
      .from('meeting_transcripts')
      .update({ status: 'failed', error_note: msg, updated_at: new Date().toISOString() })
      .eq('id', params.id);
    return NextResponse.json(
      { error: 'Retry failed: ' + msg },
      { status: 502 },
    );
  }
}

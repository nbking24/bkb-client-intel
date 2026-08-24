// @ts-nocheck
/**
 * POST /api/transcripts/:id/unassign
 *
 * "Wrong job" undo. When a transcript was confirmed to the wrong job (or
 * lead), this walks the confirm back so it can be re-categorized:
 *   1. Deletes the JobTread daily log created for it (if any).
 *   2. Removes the project-memory (PML) event so the Ask agent stops
 *      attributing the meeting to the wrong job.
 *   3. Clears the assignment + outputs and sets status back to 'unassigned',
 *      which puts the transcript back in the "Transcripts to confirm" queue
 *      with the job dropdown so the recorder can pick the correct job.
 *
 * The raw transcript, title, recorded time and duration are all kept. The
 * previous (wrong) suggestion is cleared so the card doesn't nudge the same
 * mistake again; the reasoning note records where it used to be filed.
 *
 * Permission: owner/admin, or the recorder.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '@/app/api/lib/supabase';
import { deleteDailyLog } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';

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

  const isPrivileged = auth.role === 'owner' || auth.role === 'admin';
  if (!isPrivileged && row.recorded_by_user && row.recorded_by_user !== auth.userId) {
    return NextResponse.json({ error: 'Not your transcript' }, { status: 403 });
  }

  if (row.status === 'unassigned') {
    return NextResponse.json({ ok: true, id: params.id, status: 'unassigned', alreadyUnassigned: true });
  }
  if (row.status === 'processing') {
    return NextResponse.json({ error: 'This transcript is still processing. Wait for it to finish, then try again.' }, { status: 409 });
  }

  // 1. Delete the JobTread daily log. This is the one step that must succeed
  // before we requeue; otherwise a stray daily log would be left on the wrong
  // job with nothing in the Hub pointing at it.
  let deletedDailyLogId: string | null = null;
  if (row.jt_daily_log_id) {
    try {
      await deleteDailyLog(row.jt_daily_log_id);
      deletedDailyLogId = row.jt_daily_log_id;
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      // If JobTread says it's already gone, carry on; anything else stops here.
      if (!/not found|does not exist|no .*daily ?log/i.test(msg)) {
        return NextResponse.json(
          { error: `Could not delete the JobTread daily log (${row.jt_daily_log_id}): ${msg || 'unknown error'}. Nothing was changed.` },
          { status: 502 },
        );
      }
      deletedDailyLogId = row.jt_daily_log_id;
    }
  }

  // 2. Remove PML event(s) + the linked transcript file (the daily-log link
  // pointed at it; a fresh confirm re-uploads it).
  try { await sb.from('project_events').delete().eq('source_ref->>meeting_transcript_id', params.id); } catch {}
  if (row.pml_event_id) { try { await sb.from('project_events').delete().eq('id', row.pml_event_id); } catch {} }
  try { await sb.storage.from('meeting-transcripts').remove([`${params.id}.txt`]); } catch {}

  // 3. Reset to unassigned.
  const previously = row.assigned_kind === 'job'
    ? (row.assigned_job_name || row.assigned_job_id)
    : (row.assigned_lead_name || 'a lead');
  const wrongJobWasSuggested = row.assigned_kind === 'job' && row.suggested_job_id && row.suggested_job_id === row.assigned_job_id;
  const wrongLeadWasSuggested = row.assigned_kind === 'lead' && row.suggested_kind === 'lead';

  const { error: updErr } = await sb
    .from('meeting_transcripts')
    .update({
      assigned_kind: null,
      assigned_job_id: null,
      assigned_job_name: null,
      assigned_lead_contact_id: null,
      assigned_lead_name: null,
      assigned_at: null,
      summary: null,
      jt_daily_log_id: null,
      jt_file_id: null,
      pml_event_id: null,
      status: 'unassigned',
      error_note: null,
      ...(wrongJobWasSuggested || wrongLeadWasSuggested
        ? { suggested_kind: null, suggested_job_id: null, suggested_job_name: null, suggested_lead_contact_id: null, suggested_lead_name: null, match_confidence: null }
        : {}),
      match_reasoning: `Moved back for re-categorizing (was filed under ${previously}).`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: params.id, status: 'unassigned', deletedDailyLogId, previously });
}

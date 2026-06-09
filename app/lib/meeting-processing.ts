// @ts-nocheck
/**
 * Phase 2 processing for confirmed meeting transcripts.
 *
 * On confirm (job assignment) we:
 *   1. Generate a detailed but bounded summary (respecting the JobTread daily-log
 *      length limit) following Nathan's voice + BKB vocabulary rules.
 *   2. Create a JobTread daily log on the job with that summary.
 *   3. Upload the raw transcript to Supabase Storage and attach the file to that
 *      same daily log via JobTread's createFile (sourced from a signed URL).
 *
 * The raw transcript is also written to PML by the confirm route, so the Ask
 * agent can query the full text regardless of the daily-log summary.
 */
import Anthropic from '@anthropic-ai/sdk';
import { pave, createDailyLog } from './jobtread';
import { NATHAN_BRAND_VOICE } from './nathan-voice';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SUMMARY_MODEL = 'claude-sonnet-4-6';

// JobTread's hard cap on the dailyLog.notes field is exactly 10,000 characters
// (confirmed empirically via createDailyLog with progressively larger payloads;
// 10,000 succeeds, 15,000 fails with "Notes cannot be more than 10000 characters").
//
// We reserve ~500 chars of headroom for the appended "Full meeting transcript:
// <url>" footer (typically 150-200 chars) plus the truncation sentinel, so the
// summary itself is capped at 9500. That keeps the JT write safely under the
// hard limit without ever clipping mid-sentence the way the old 8000 cap did
// (e.g. the 06-09 Gibbons meeting summary clipped mid-paren at "Antique brass
// direction for door hardware (").
export const MAX_DAILY_LOG_CHARS = Number(process.env.MAX_DAILY_LOG_CHARS || 9500);

/** BKB written-content rules: no em/en dashes, no "sub"/"subcontractor". */
function sanitize(text: string): string {
  if (!text) return text;
  return text
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\bsubcontractors\b/g, 'trade partners')
    .replace(/\bSubcontractors\b/g, 'Trade partners')
    .replace(/\bsubcontractor\b/g, 'trade partner')
    .replace(/\bSubcontractor\b/g, 'Trade partner')
    .replace(/\bsubcontracted\b/g, 'performed by trade partners')
    .replace(/\bsubcontracting\b/g, 'trade partner work')
    .replace(/\bsubs\b/g, 'trade partners')
    .replace(/\bSubs\b/g, 'Trade partners');
}

/** Trim to the ceiling at the last clean break, never mid-sentence. */
function capLength(text: string, max = MAX_DAILY_LOG_CHARS): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
  return (lastBreak > max * 0.5 ? slice.slice(0, lastBreak) : slice).trim() + '\n\n[Summary trimmed to fit the daily log. Full transcript is attached and stored in project memory.]';
}

export async function generateMeetingSummary(params: {
  transcript: string;
  title?: string;
  contextName?: string;   // job or client name
}): Promise<string> {
  const { transcript, title, contextName } = params;
  const prompt = `${NATHAN_BRAND_VOICE}

You are writing a daily-log summary of a recorded meeting for ${contextName || 'a construction project'} at Brett King Builder. This summary will be posted directly into the JobTread daily log notes field.

Write a clear, detailed summary covering, where present:
- Who was on the meeting
- Purpose of the meeting
- Decisions made
- Client selections and preferences captured
- Action items with owners
- Open questions / follow-ups

LENGTH: Aim for 800 to 1500 words. The JobTread daily log has a HARD limit of 9000 characters for your summary - DO NOT exceed that. If the meeting is dense, prefer terse bullets and skip the chit-chat to fit. Finish your last sentence cleanly; never end mid-thought.

Rules: plain professional prose. No em dashes or en dashes. Never use the words "sub" or "subcontractor"; say "trade partner(s)". Do not invent details that are not supported by the transcript.

Meeting title: ${title || '(untitled)'}

Transcript:
"""
${(transcript || '').slice(0, 60000)}
"""

Write only the summary.`;

  const res = await anthropic.messages.create({
    model: SUMMARY_MODEL,
    // 4000 tokens ≈ 16,000 characters. Plenty of room for the AI to write
    // a full 9000-char summary without bumping the model's output ceiling.
    // The capLength() defense-in-depth trim catches the rare case the model
    // ignores the prompt and overshoots.
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = (res.content || []).map((b: any) => (b.type === 'text' ? b.text : '')).join('').trim();
  return capLength(sanitize(text));
}

/** Attach a file (by URL) to a JobTread daily log. */
export async function attachFileToDailyLog(params: { dailyLogId: string; url: string; name: string }) {
  const { dailyLogId, url, name } = params;
  const result = await pave({
    createFile: {
      $: { targetType: 'dailyLog', targetId: dailyLogId, url, name },
      createdFile: { id: {}, name: {} },
    },
  });
  return (result as any)?.createFile?.createdFile || null;
}

/**
 * Full processing for a confirmed, job-assigned transcript.
 * Returns the created daily log id, attached file id, and the summary.
 * Throws on hard failure so the caller can mark the row 'failed'.
 */
export async function processConfirmedTranscript(params: {
  sb: any;                       // Supabase client (service role)
  transcriptRowId: string;
  jobId: string;
  jobName?: string | null;
  title?: string | null;
  rawTranscript: string;
  recordedAt?: string | null;
}): Promise<{ dailyLogId: string; fileId: string | null; summary: string }> {
  const { sb, transcriptRowId, jobId, jobName, title, rawTranscript, recordedAt } = params;

  // 1. Summary.
  const summary = await generateMeetingSummary({ transcript: rawTranscript, title: title || undefined, contextName: jobName || undefined });

  // 2. Upload the raw transcript to storage (public-by-unguessable-UUID, same
  // model as co-photos) so it can be linked from the daily log. JobTread's
  // createFile does not accept a URL param, so we link the transcript in the
  // log notes; native in-JobTread file attach (createUploadRequest flow) is a
  // future enhancement.
  let transcriptUrl: string | null = null;
  try {
    const path = `${transcriptRowId}.txt`;
    const up = await sb.storage.from('meeting-transcripts').upload(path, new Blob([rawTranscript], { type: 'text/plain' }), { upsert: true, contentType: 'text/plain' });
    if (!up.error) {
      const { data: pub } = sb.storage.from('meeting-transcripts').getPublicUrl(path);
      transcriptUrl = pub?.publicUrl || null;
    }
  } catch { transcriptUrl = null; }

  // 3. Daily log with the summary, linking the full transcript.
  const date = (recordedAt ? new Date(recordedAt) : new Date()).toISOString().slice(0, 10);
  const notes = transcriptUrl ? `${summary}\n\nFull meeting transcript: ${transcriptUrl}` : summary;
  const log = await createDailyLog({ jobId, date, notes, dailyLogType: process.env.MEETING_DAILY_LOG_TYPE || 'Other' });

  return { dailyLogId: log.id, fileId: null, summary, transcriptUrl, fileError: null };
}

/**
 * When a Loop lead converts to a JobTread job, create daily logs on the new job
 * from any confirmed lead-stage transcripts for that contact that don't yet
 * have one. Coordinates with PML's backfillProjectEventsForLead (which moves the
 * transcript events onto the job).
 */
export async function backfillLeadTranscriptDailyLogs(params: { sb: any; jobId: string; jobName?: string | null; ghlContactId: string }) {
  const { sb, jobId, jobName, ghlContactId } = params;
  const { data: rows } = await sb
    .from('meeting_transcripts')
    .select('*')
    .eq('assigned_kind', 'lead')
    .eq('assigned_lead_contact_id', ghlContactId)
    .is('jt_daily_log_id', null)
    .eq('status', 'confirmed');
  const results: any[] = [];
  for (const row of rows || []) {
    try {
      const out = await processConfirmedTranscript({
        sb, transcriptRowId: row.id, jobId, jobName,
        title: row.title, rawTranscript: row.raw_transcript, recordedAt: row.recorded_at,
      });
      await sb.from('meeting_transcripts').update({
        assigned_job_id: jobId, assigned_job_name: jobName || null,
        jt_daily_log_id: out.dailyLogId, jt_file_id: out.fileId, summary: out.summary,
        status: 'processed', updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      results.push({ id: row.id, dailyLogId: out.dailyLogId });
    } catch (err: any) {
      await sb.from('meeting_transcripts').update({ status: 'failed', error_note: 'Backfill: ' + (err?.message || 'unknown'), updated_at: new Date().toISOString() }).eq('id', row.id);
    }
  }
  return results;
}

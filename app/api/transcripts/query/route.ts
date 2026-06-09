// @ts-nocheck
/**
 * POST /api/transcripts/query
 * AI search over meeting transcripts. Scope with jobId or an explicit list of
 * transcriptIds (the currently filtered set); otherwise searches all
 * confirmed/processed transcripts the user can see. Returns an answer plus the
 * meetings it drew from.
 * Body: { question: string, jobId?: string, transcriptIds?: string[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '@/app/api/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const QUERY_MODEL = 'claude-sonnet-4-20250514';
// Tune for the realistic transcript shapes Plaud is producing for BKB:
// short meetings 4-8k chars, long ones 40-60k chars. We want every full
// transcript in scope at small filter sizes (1-3 meetings = single job)
// while still being able to range over a year of meetings when unfiltered.
const MAX_DOCS = 40;
// Total character budget for the transcripts section of the prompt. Sonnet
// has a 200K-token context; ~50K chars (~12K tokens) of transcript leaves
// plenty of room for the prompt, system overhead, and the answer.
const TOTAL_BUDGET = 180_000;
// Per-doc cap when many transcripts share the budget. We compute the actual
// per-doc allowance dynamically below so 1 transcript can use the whole
// budget (full text) but 40 each get a fair share.
const PER_DOC_MIN = 4_000;
const PER_DOC_MAX = 150_000;

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const question = (body?.question || '').trim();
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });

  const sb = getSupabase();
  // Searchable statuses: anything where the raw text is likely present.
  // - confirmed/processed → ready to search
  // - processing → post-processing not done yet, but raw_transcript is usually already saved
  // - failed → AI summary/categorization failed but the raw transcript is still there;
  //   Nathan should still be able to ask questions of the underlying text
  const SEARCHABLE_STATUSES = ['confirmed', 'processing', 'processed', 'failed'];

  // If the client sent an explicit (possibly empty) transcriptIds array, that's
  // the authoritative scope - don't fall through to "search everything" when
  // the filter narrowed the list to zero matches. Same intent for jobId.
  const hasTranscriptIds = Array.isArray(body.transcriptIds);
  if (hasTranscriptIds && body.transcriptIds.length === 0) {
    return NextResponse.json({
      answer: "There are no transcripts in your current filter, so there's nothing to search. Clear a filter and try again.",
      sources: [],
    });
  }

  let q = sb
    .from('meeting_transcripts')
    .select('id, title, status, recorded_at, assigned_kind, assigned_job_name, assigned_lead_name, recorded_by_user, raw_transcript')
    .in('status', SEARCHABLE_STATUSES)
    // Only rows with raw text are useful; status='processing' can briefly mean
    // the row exists but the audio hasn't been transcribed yet.
    .not('raw_transcript', 'is', null)
    .order('recorded_at', { ascending: false, nullsFirst: false })
    .limit(MAX_DOCS);

  if (hasTranscriptIds) q = q.in('id', body.transcriptIds.slice(0, MAX_DOCS));
  else if (body.jobId) q = q.eq('assigned_job_id', String(body.jobId));
  if (!(auth.role === 'owner' || auth.role === 'admin')) q = q.eq('recorded_by_user', auth.userId);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    // Better empty state: try a permissive count to tell the operator WHY
    // their search returned nothing. If transcripts exist in the scope but
    // we excluded them, name the reason.
    let why = 'No transcripts found in the selected scope.';
    if (body.jobId) {
      const { count: anyForJob } = await sb
        .from('meeting_transcripts')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_job_id', String(body.jobId));
      if (anyForJob && anyForJob > 0) {
        const { count: noText } = await sb
          .from('meeting_transcripts')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_job_id', String(body.jobId))
          .is('raw_transcript', null);
        if (noText && noText > 0) {
          why = `There ${anyForJob === 1 ? 'is 1 transcript' : `are ${anyForJob} transcripts`} for this project, but ${noText === anyForJob ? 'none have' : `${noText} have not yet`} finished transcribing. Try again in a few minutes.`;
        } else {
          why = `This project has ${anyForJob} transcript(s), but none are in a searchable state right now.`;
        }
      } else {
        why = 'No transcripts have been linked to this project yet. Confirm a transcript to this job from the categorizing queue first.';
      }
    }
    return NextResponse.json({ answer: why, sources: [] });
  }

  // Dynamic per-doc budgeting. The old hard cap of 6000 chars per transcript
  // truncated long meetings (40-60k chars are common) at the OPENING, dropping
  // the entire back half where decisions and next-steps usually live. Now we
  // size the per-doc allowance against the total budget so one transcript can
  // use the full budget (read in entirety) and many transcripts each get a
  // fair slice. Floor at PER_DOC_MIN so even 40 docs get useful context.
  const perDocBudget = Math.min(
    PER_DOC_MAX,
    Math.max(PER_DOC_MIN, Math.floor(TOTAL_BUDGET / Math.max(1, rows.length))),
  );

  const sources: any[] = [];
  let used = '';
  // Rows came back ordered newest first. Tag the first one explicitly so the
  // AI can answer "last meeting" / "most recent meeting" questions correctly
  // without us trying to parse the question.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (used.length > TOTAL_BUDGET) break;
    const who = r.assigned_kind === 'job' ? r.assigned_job_name : r.assigned_kind === 'lead' ? `${r.assigned_lead_name} (lead)` : 'Unassigned';
    const date = r.recorded_at ? new Date(r.recorded_at).toLocaleDateString('en-US') : '';
    const raw = r.raw_transcript || '';
    const text = raw.length > perDocBudget ? raw.slice(0, perDocBudget) + '\n[transcript truncated above this point for length]' : raw;
    const tag = i === 0 ? ' [MOST RECENT MEETING IN SCOPE]' : '';
    used += `\n\n=== MEETING ${i + 1} of ${rows.length}${tag}: ${r.title || 'Untitled'} | Job: ${who} | Date: ${date} | id:${r.id} ===\n${text}`;
    sources.push({ id: r.id, title: r.title, job: who, date, charsIncluded: text.length });
  }

  const prompt = `You are Brett King Builder's meeting-transcript researcher. Below are ${rows.length} meeting transcript(s) in the operator's current filter, ordered newest first. The first one is tagged [MOST RECENT MEETING IN SCOPE].

Read all of the supplied transcripts carefully BEFORE answering. Long transcripts cover early-meeting catch-up, the middle decisions, and end-of-meeting next-steps; the answer often lives near the end of the meeting, not the beginning.

When the question is about "the last meeting", "the latest meeting", "what we discussed recently", or "next steps", answer primarily from the meeting tagged [MOST RECENT MEETING IN SCOPE] unless the question explicitly asks across meetings.

When you state a fact, cite the meeting it came from by title and date (e.g. "in the 6-3 Sunroom meeting"). If a transcript was truncated, you'll see "[transcript truncated above this point for length]" - you can still answer from what you have but acknowledge if the answer might be in the truncated portion.

If the answer truly is not present in the transcripts (after a careful read of the relevant meeting), say so plainly and suggest what the operator could do next (e.g. check a different meeting, ask the team).

Do not use em dashes. Use "trade partner(s)" instead of "sub" or "subcontractor".

QUESTION: ${question}

TRANSCRIPTS:${used}`;

  try {
    const res = await anthropic.messages.create({ model: QUERY_MODEL, max_tokens: 2400, messages: [{ role: 'user', content: prompt }] });
    const answer = (res.content || []).map((b: any) => (b.type === 'text' ? b.text : '')).join('').trim();
    return NextResponse.json({
      answer,
      sources,
      // Surfaced for diagnostics: how much of each transcript actually made
      // it into the prompt. If a user gets a "not in the transcripts" reply
      // but the relevant transcript was truncated, this tells us.
      meta: { docsInScope: rows.length, perDocBudget, totalChars: used.length },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'AI query failed: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}

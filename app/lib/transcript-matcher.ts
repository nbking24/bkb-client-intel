// @ts-nocheck
/**
 * Transcript -> Job/Lead matcher.
 *
 * Given a meeting transcript, the recording time, and the recorder's user id,
 * produce a best-guess assignment for the review queue. Uses two signals:
 *   1. The recorder's Google Calendar around the recording time (title /
 *      location / description of a client meeting).
 *   2. Client names / addresses spoken in the transcript itself.
 * Both are cross-referenced against the active JobTread job list (and, when the
 * transcript looks like an early sales call with no matching job, flagged as a
 * 'lead' so the reviewer can attach it to a Loop contact instead).
 *
 * This only produces a SUGGESTION. Nothing is processed until the recorder
 * confirms it on their home page.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getActiveJobs } from '@/app/lib/jobtread';
import { fetchCalendarEvents } from '@/app/lib/google-api';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MATCH_MODEL = 'claude-sonnet-4-20250514';

export interface TranscriptMatch {
  kind: 'job' | 'lead' | 'unknown';
  jobId: string | null;
  jobName: string | null;
  leadName: string | null;
  confidence: number;        // 0..1
  reasoning: string;
  calendarEvent: any | null; // the calendar event used as context, if any
}

function windowAround(iso: string | null, hours = 3): { start: Date; end: Date } {
  const base = iso ? new Date(iso) : new Date();
  return {
    start: new Date(base.getTime() - hours * 3600 * 1000),
    end: new Date(base.getTime() + hours * 3600 * 1000),
  };
}

export async function matchTranscript(params: {
  transcript: string;
  recordedAt?: string | null;
  recorderUserId?: string | null;
}): Promise<TranscriptMatch> {
  const { transcript, recordedAt, recorderUserId } = params;

  // 1. Calendar context around the recording time (fails open to []).
  let calendarEvents: any[] = [];
  try {
    const { start, end } = windowAround(recordedAt || null, 3);
    calendarEvents = await fetchCalendarEvents(1, start, end, recorderUserId || undefined);
  } catch {
    calendarEvents = [];
  }

  // 2. Active jobs to match against.
  let jobs: any[] = [];
  try {
    jobs = await getActiveJobs(200);
  } catch {
    jobs = [];
  }

  const jobLines = jobs
    .map((j) => `- id:${j.id} | ${j.name}${j.clientName ? ' | client:' + j.clientName : ''}${j.number ? ' | #' + j.number : ''}`)
    .join('\n')
    .slice(0, 12000);

  const calLines = (calendarEvents || [])
    .map((e) => `- ${e.summary}${e.location ? ' @ ' + e.location : ''} (${e.start})`)
    .join('\n') || '(no calendar events near the recording time)';

  const excerpt = (transcript || '').slice(0, 5000);

  const prompt = `You match a recorded meeting to the correct construction project.

Active JobTread jobs:
${jobLines || '(none available)'}

Recorder's calendar around the recording time:
${calLines}

Meeting transcript excerpt:
"""
${excerpt}
"""

Decide which job this meeting is about. If it clearly matches a job above, return that job. If it is an early sales / discovery conversation with a client who does NOT have a job in the list yet, return kind "lead" with the client's name. If you cannot tell, return kind "unknown".

Respond with ONLY a JSON object, no prose:
{"kind":"job|lead|unknown","jobId":"<id or null>","jobName":"<name or null>","leadName":"<client name or null>","confidence":<0..1>,"reasoning":"<one sentence>"}`;

  try {
    const res = await anthropic.messages.create({
      model: MATCH_MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (res.content || []).map((b: any) => (b.type === 'text' ? b.text : '')).join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const chosenCal = calendarEvents[0] || null;
    return {
      kind: json.kind === 'job' || json.kind === 'lead' ? json.kind : 'unknown',
      jobId: json.jobId || null,
      jobName: json.jobName || null,
      leadName: json.leadName || null,
      confidence: typeof json.confidence === 'number' ? Math.max(0, Math.min(1, json.confidence)) : 0,
      reasoning: json.reasoning || '',
      calendarEvent: chosenCal,
    };
  } catch (err: any) {
    return {
      kind: 'unknown', jobId: null, jobName: null, leadName: null,
      confidence: 0, reasoning: 'Matcher error: ' + (err?.message || 'unknown'),
      calendarEvent: calendarEvents[0] || null,
    };
  }
}

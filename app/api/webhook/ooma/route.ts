// @ts-nocheck
/**
 * Ooma phone-call webhook (via Zapier).
 *
 * Receives call recordings/transcripts from the Ooma Office "New Call
 * Recording" Zapier trigger. The big advantage over Plaud: calls carry caller
 * ID, so we match the external phone number to a Loop (GHL) contact and
 * pre-fill the lead suggestion. Calls are ALWAYS queued for review (Terri
 * confirms or deletes) — never auto-filed.
 *
 * Auth: shared secret in `x-plaud-secret` / `x-webhook-secret` header or
 * `?secret=`, compared against OOMA_WEBHOOK_SECRET (falls back to
 * PLAUD_WEBHOOK_SECRET so no new env var is required).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { searchContacts } from '@/app/api/lib/ghl';
import { matchTranscript } from '@/app/lib/transcript-matcher';

export const dynamic = 'force-dynamic';

// BKB's own numbers (normalized to 10 digits) — the OTHER party is the lead.
const BKB_NUMBERS = new Set(
  (process.env.BKB_PHONE_NUMBERS || '2155361145,2155387981,8552067476,2672720010')
    .split(',').map((n) => n.replace(/\D/g, '').replace(/^1/, ''))
);

function pick(obj: any, paths: string[]): any {
  for (const p of paths) {
    const val = p.split('.').reduce((o: any, k: string) => (o == null ? o : o[k]), obj);
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return null;
}

function tenDigits(raw: any): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? d : (d.length > 0 ? d : null);
}
function fmtPhone(d: string): string {
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;
}

export async function POST(req: NextRequest) {
  const expected = process.env.OOMA_WEBHOOK_SECRET || process.env.PLAUD_WEBHOOK_SECRET;
  const provided = req.headers.get('x-webhook-secret') || req.headers.get('x-plaud-secret') || req.nextUrl.searchParams.get('secret');
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const data = body?.data || body;

  const transcript = pick(data, ['transcript', 'transcription', 'transcript_text', 'text']);
  const recordingUrl = pick(data, ['recording_url', 'recordingUrl', 'audio_url', 'file_url', 'url']);
  if (!transcript && !recordingUrl) {
    return NextResponse.json({ ok: true, skipped: 'no transcript or recording on this event' });
  }

  const direction = String(pick(data, ['direction', 'call_direction', 'type']) || '').toLowerCase();
  const fromNum = tenDigits(pick(data, ['from', 'from_number', 'caller', 'caller_number', 'callerNumber', 'caller_id']));
  const toNum = tenDigits(pick(data, ['to', 'to_number', 'callee', 'dialed_number', 'calleeNumber']));
  // The lead is whichever party is not a BKB number.
  let leadNumber: string | null = null;
  if (fromNum && !BKB_NUMBERS.has(fromNum)) leadNumber = fromNum;
  else if (toNum && !BKB_NUMBERS.has(toNum)) leadNumber = toNum;
  else leadNumber = direction.includes('out') ? toNum : fromNum;

  const callId = pick(data, ['recording_id', 'call_id', 'id', 'uuid']) || `${fromNum || ''}-${toNum || ''}-${pick(data, ['start_time', 'timestamp']) || ''}`;
  const startTime = pick(data, ['start_time', 'startTime', 'timestamp', 'date', 'created_at', 'call_time']);
  const durationSeconds = pick(data, ['duration', 'duration_seconds', 'length']);

  const sb = getSupabase();

  // Dedupe.
  const sourceId = 'ooma_' + String(callId);
  const { data: existing } = await sb
    .from('meeting_transcripts').select('id')
    .eq('plaud_recording_id', sourceId).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, deduped: true, id: existing.id });

  // Caller ID -> Loop contact (best effort).
  let leadContactId: string | null = null;
  let leadName: string | null = null;
  if (leadNumber) {
    try {
      let results = await searchContacts(leadNumber);
      if (!results?.length) results = await searchContacts('+1' + leadNumber);
      const first = results?.[0];
      if (first?.id) { leadContactId = first.id; leadName = (first.name || '').trim() || null; }
    } catch { /* non-fatal */ }
  }

  const dirLabel = direction.includes('out') ? 'Outbound' : 'Inbound';
  const who = leadName || (leadNumber ? fmtPhone(leadNumber) : 'Unknown caller');
  const title = `${dirLabel} call - ${who}`;

  const rawTranscript = transcript
    ? String(transcript)
    : `(No transcript provided by Ooma for this call. Recording: ${recordingUrl})`;

  const { data: inserted, error: insErr } = await sb
    .from('meeting_transcripts')
    .insert({
      plaud_recording_id: sourceId,
      plaud_event_id: 'ooma_call',
      recorded_by_user: process.env.OOMA_DEFAULT_REVIEWER || 'terri',
      title: title.slice(0, 300),
      recorded_at: startTime ? new Date(startTime).toISOString() : new Date().toISOString(),
      duration_seconds: durationSeconds ? Math.round(Number(durationSeconds)) : null,
      audio_url: recordingUrl || null,
      raw_transcript: rawTranscript,
      suggested_kind: leadContactId || leadName ? 'lead' : null,
      suggested_lead_contact_id: leadContactId,
      suggested_lead_name: leadName,
      match_confidence: leadContactId ? 0.9 : null,
      match_reasoning: leadContactId
        ? `Caller number ${leadNumber ? fmtPhone(leadNumber) : ''} matched Loop contact ${leadName || ''}`.trim()
        : (leadNumber ? `No Loop contact found for ${fmtPhone(leadNumber)}` : 'Caller number unavailable'),
      status: 'unassigned',
    })
    .select('id').single();
  if (insErr) return NextResponse.json({ error: 'Insert failed: ' + insErr.message }, { status: 500 });

  // If caller ID didn't resolve and we have transcript text, fall back to the
  // AI matcher (it may recognize a job or client by name).
  if (!leadContactId && transcript) {
    try {
      const match = await matchTranscript({ transcript: String(transcript), recordedAt: startTime || null, recorderUserId: process.env.OOMA_DEFAULT_REVIEWER || 'terri' });
      if (match.kind !== 'unknown') {
        await sb.from('meeting_transcripts').update({
          suggested_kind: match.kind,
          suggested_job_id: match.kind === 'job' ? match.jobId : null,
          suggested_job_name: match.kind === 'job' ? match.jobName : null,
          suggested_lead_name: match.kind === 'lead' ? match.leadName : leadName,
          match_confidence: match.confidence,
          match_reasoning: match.reasoning,
          updated_at: new Date().toISOString(),
        }).eq('id', inserted.id);
      }
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true, id: inserted.id, matchedLead: leadName, leadContactId });
}

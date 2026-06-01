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
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const QUERY_MODEL = 'claude-sonnet-4-20250514';
const MAX_DOCS = 25;
const PER_DOC_CHARS = 6000;
const TOTAL_BUDGET = 110000;

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const question = (body?.question || '').trim();
  if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });

  const sb = getSupabase();
  let q = sb
    .from('meeting_transcripts')
    .select('id, title, recorded_at, assigned_kind, assigned_job_name, assigned_lead_name, recorded_by_user, raw_transcript')
    .in('status', ['confirmed', 'processing', 'processed'])
    .order('recorded_at', { ascending: false, nullsFirst: false })
    .limit(MAX_DOCS);

  if (Array.isArray(body.transcriptIds) && body.transcriptIds.length) q = q.in('id', body.transcriptIds.slice(0, MAX_DOCS));
  else if (body.jobId) q = q.eq('assigned_job_id', String(body.jobId));
  if (!(auth.role === 'owner' || auth.role === 'admin')) q = q.eq('recorded_by_user', auth.userId);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ answer: 'No transcripts found in the selected scope.', sources: [] });

  const sources: any[] = [];
  let used = '';
  for (const r of rows) {
    if (used.length > TOTAL_BUDGET) break;
    const who = r.assigned_kind === 'job' ? r.assigned_job_name : r.assigned_kind === 'lead' ? `${r.assigned_lead_name} (lead)` : 'Unassigned';
    const date = r.recorded_at ? new Date(r.recorded_at).toLocaleDateString('en-US') : '';
    const text = (r.raw_transcript || '').slice(0, PER_DOC_CHARS);
    used += `\n\n=== MEETING: ${r.title || 'Untitled'} | Job: ${who} | Date: ${date} | id:${r.id} ===\n${text}`;
    sources.push({ id: r.id, title: r.title, job: who, date });
  }

  const prompt = `You are searching Brett King Builder's meeting transcripts to answer a question. Use ONLY the transcripts below. When you state a fact, cite the meeting it came from by title and date. If the answer is not in these transcripts, say so plainly. Do not use em dashes.

QUESTION: ${question}

TRANSCRIPTS:${used}`;

  try {
    const res = await anthropic.messages.create({ model: QUERY_MODEL, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] });
    const answer = (res.content || []).map((b: any) => (b.type === 'text' ? b.text : '')).join('').trim();
    return NextResponse.json({ answer, sources });
  } catch (err: any) {
    return NextResponse.json({ error: 'AI query failed: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}

// @ts-nocheck
/**
 * /api/dashboard/personal-investments/questions  (Nathan only)
 *
 * GET  -> open and recently answered bookkeeping questions.
 * POST {stessaId, answer} -> records Nathan's answer (status 'answered').
 *
 * The weekly Stessa task writes questions into bookkeeping_questions, then on
 * its next run applies every 'answered' row in Stessa and marks it 'applied'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { isNathan } from '@/app/api/lib/nathan-only';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  if (!(await isNathan(req))) return NextResponse.json({ error: 'This page is private.' }, { status: 403 });
  const { data, error } = await getSupabase()
    .from('bookkeeping_questions')
    .select('stessa_id, txn_date, vendor, amount, account, question, best_guess, options, status, answer, answered_at')
    .in('status', ['open', 'answered'])
    .order('txn_date', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ questions: data || [] });
}

export async function POST(req: NextRequest) {
  if (!(await isNathan(req))) return NextResponse.json({ error: 'This page is private.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const stessaId = Number(body.stessaId);
  const answer = String(body.answer || '').trim().slice(0, 500);
  if (!stessaId || !answer) return NextResponse.json({ error: 'stessaId and answer are required' }, { status: 400 });
  const { data, error } = await getSupabase()
    .from('bookkeeping_questions')
    .update({ status: 'answered', answer, answered_at: new Date().toISOString() })
    .eq('stessa_id', stessaId)
    .in('status', ['open', 'answered'])
    .select('stessa_id, status, answer')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Question not found or already applied' }, { status: 404 });
  return NextResponse.json({ ok: true, question: data });
}

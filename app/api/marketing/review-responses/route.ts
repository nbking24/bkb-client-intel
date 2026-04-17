// @ts-nocheck
/**
 * GET  /api/marketing/review-responses?status=pending   — list review-reply drafts
 * POST /api/marketing/review-responses                  — approve / edit / skip a draft
 *
 * POST body:
 *   { id, action: 'approve' | 'edit' | 'skip', editedText?: string }
 *
 * Approved replies are marked as approved; actual posting to Google/Houzz/FB
 * happens in a separate step (platform APIs / manual) — we don't auto-post
 * responses in this first iteration.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAuth } from '../../lib/auth';
import { logEvent } from '../../lib/marketing/review-concierge';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const status = req.nextUrl.searchParams.get('status') || 'pending';
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('review_responses')
    .select('*')
    .eq('approval_status', status)
    .order('drafted_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ responses: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, action, editedText } = await req.json();
  if (!id || !action) {
    return NextResponse.json({ error: 'id and action required' }, { status: 400 });
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();
  let update: Record<string, any> = {
    approved_by: auth.userId,
    approved_at: now,
    updated_at: now,
  };

  if (action === 'approve') {
    update.approval_status = 'approved';
    // If editedText provided, treat as edit-then-approve
    if (editedText) update.approved_reply = editedText;
  } else if (action === 'edit') {
    update.approval_status = 'edited';
    update.approved_reply = editedText;
  } else if (action === 'skip') {
    update.approval_status = 'skipped';
  } else {
    return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('review_responses')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logEvent({
    agent: 'review_response_ui',
    eventType: 'approval_action',
    entityType: 'review_response',
    entityId: id,
    outcome: 'success',
    detail: { action, by: auth.userId },
  });

  return NextResponse.json({ response: data });
}

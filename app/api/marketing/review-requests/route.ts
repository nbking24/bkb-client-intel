// @ts-nocheck
/**
 * GET  /api/marketing/review-requests      — list with filters
 * POST /api/marketing/review-requests      — manually queue a review request
 *
 * Both require Bearer auth.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAuth } from '../../lib/auth';
import { processReviewTrigger } from '../../lib/marketing/review-concierge';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const trigger = sp.get('trigger');
  const limit = Math.min(Number(sp.get('limit') || 100), 500);

  const supabase = getSupabase();
  let query = supabase
    .from('review_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (trigger) query = query.eq('trigger_type', trigger);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    triggerType,
    clientContactId,
    jobtreadJobId,
    clientName,
    clientEmail,
    clientPhone,
  } = body || {};

  if (!triggerType || !clientContactId) {
    return NextResponse.json(
      { error: 'triggerType and clientContactId required' },
      { status: 400 }
    );
  }

  const result = await processReviewTrigger({
    triggerType,
    triggerSource: 'manual_dashboard',
    clientContactId,
    jobtreadJobId,
    clientName,
    clientEmail,
    clientPhone,
    rawEventDetail: { initiated_by: auth.userId },
  });

  return NextResponse.json(result);
}

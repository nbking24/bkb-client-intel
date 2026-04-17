// @ts-nocheck
/**
 * GET /api/marketing/stats
 *
 * Dashboard stats for the Marketing Overview + Reviews tabs.
 *
 * Returns:
 *   {
 *     reviewFunnel90d: [{ trigger_type, requests_sent, five_star_responses, ... }],
 *     recentReviews: [...],              // last 20 confirmed reviews
 *     approvalQueue: { total, reviewResponses, fbDrafts, newsletterIssues },
 *     makeItRight: [...],                // sub-5-star responses awaiting follow-up
 *     recentEvents: [...]                // last 50 marketing_events
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAuth } from '../../lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();

  const [
    funnelRes,
    recentReviewsRes,
    approvalQueueRes,
    makeItRightRes,
    recentEventsRes,
  ] = await Promise.all([
    supabase.from('review_funnel_90d').select('*'),
    supabase
      .from('review_requests')
      .select('id, client_name, review_platform, review_stars, review_confirmed_at, review_url')
      .eq('review_left_status', 'confirmed')
      .order('review_confirmed_at', { ascending: false })
      .limit(20),
    supabase.from('marketing_approval_queue').select('kind, id'),
    supabase
      .from('review_requests')
      .select('id, client_name, client_email, star_rating, survey_responded_at, outcome_notes')
      .lt('star_rating', 5)
      .gte('star_rating', 1)
      .in('status', ['responded', 'completed'])
      .order('survey_responded_at', { ascending: false })
      .limit(25),
    supabase
      .from('marketing_events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(50),
  ]);

  const queueRows = approvalQueueRes.data || [];
  const approvalQueue = {
    total: queueRows.length,
    reviewResponses: queueRows.filter((r) => r.kind === 'review_response').length,
    fbDrafts: queueRows.filter((r) => r.kind === 'fb_reply').length,
    newsletterIssues: queueRows.filter((r) => r.kind === 'newsletter_issue').length,
  };

  return NextResponse.json({
    reviewFunnel90d: funnelRes.data || [],
    recentReviews: recentReviewsRes.data || [],
    approvalQueue,
    makeItRight: makeItRightRes.data || [],
    recentEvents: recentEventsRes.data || [],
  });
}

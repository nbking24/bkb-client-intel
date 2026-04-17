// @ts-nocheck
/**
 * POST /api/webhook/new-review
 *
 * Called when a new review is detected on Google / Facebook.
 * Records the review in client_review_history (which dedupes future asks)
 * and closes out any open review_requests for that client.
 *
 * Expected body:
 *   {
 *     contactId: string,            // GHL contact id (required)
 *     platform: 'google' | 'facebook',
 *     stars?: number,
 *     url?: string,
 *     reviewedAt?: string,
 *     clientName?: string,
 *     clientEmail?: string
 *   }
 *
 * Optionally this can also create a review_responses row for the Response Agent
 * to draft a reply. Controlled by body flag `queueForReply`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { recordReviewLeft } from '../../lib/marketing/review-dedup';
import { logEvent } from '../../lib/marketing/review-concierge';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-review-webhook-secret');
  if (!secret || secret !== process.env.REVIEW_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    contactId,
    platform,
    stars,
    url,
    reviewedAt,
    clientName,
    clientEmail,
    reviewText,
    externalReviewId,
    queueForReply,
  } = body;

  if (!contactId || !platform) {
    return NextResponse.json(
      { error: 'contactId and platform required' },
      { status: 400 }
    );
  }

  await recordReviewLeft({
    clientContactId: contactId,
    platform,
    stars,
    url,
    reviewedAt,
    clientName,
    clientEmail,
  });

  if (queueForReply && externalReviewId) {
    const supabase = getSupabase();
    await supabase
      .from('review_responses')
      .upsert(
        {
          platform,
          external_review_id: externalReviewId,
          reviewer_name: clientName,
          review_stars: stars,
          review_text: reviewText,
          review_posted_at: reviewedAt,
          review_url: url,
          approval_status: 'pending',
        },
        { onConflict: 'platform,external_review_id' }
      );
  }

  await logEvent({
    agent: 'review_webhook',
    eventType: 'new_review_recorded',
    entityType: 'client_review_history',
    entityId: contactId,
    outcome: 'success',
    detail: { platform, stars, url },
  });

  return NextResponse.json({ ok: true });
}

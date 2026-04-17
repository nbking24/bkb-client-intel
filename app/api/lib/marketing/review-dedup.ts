// @ts-nocheck
/**
 * Review Dedup — single source of truth for "should this client be asked for a review?"
 *
 * Every review-request workflow MUST check eligibility before sending. The hard rule
 * from Nathan: if a client has left a review on ANY platform (Google or Facebook),
 * they are never asked again.
 */
import { getSupabase } from '../supabase';

export interface EligibilityResult {
  eligible: boolean;
  reason?:
    | 'already_reviewed'
    | 'opted_out'
    | 'rate_limited_recent_ask'
    | 'missing_contact_id';
  existingReview?: {
    platform: string;
    stars?: number;
    url?: string;
    reviewedAt?: string;
  };
  lastAskAt?: string;
}

/**
 * Check whether a client is eligible for a review request right now.
 *
 * Blocking conditions (in order):
 *  1. Missing contact id (caller error)
 *  2. Client already has a review in client_review_history
 *  3. Client has been asked within the last 45 days (rate limit)
 */
export async function checkReviewEligibility(
  clientContactId: string
): Promise<EligibilityResult> {
  if (!clientContactId) {
    return { eligible: false, reason: 'missing_contact_id' };
  }

  const supabase = getSupabase();

  // 1. Already reviewed?
  const { data: history, error: histErr } = await supabase
    .from('client_review_history')
    .select('platforms_reviewed, latest_review_at')
    .eq('client_contact_id', clientContactId)
    .maybeSingle();

  if (histErr) {
    console.error('[review-dedup] history lookup failed', histErr);
    // Fail closed — don't ask if we can't verify
    return { eligible: false, reason: 'already_reviewed' };
  }

  if (history && history.platforms_reviewed) {
    const platforms = history.platforms_reviewed as Record<string, any>;
    const reviewedPlatform = Object.keys(platforms)[0];
    if (reviewedPlatform) {
      const p = platforms[reviewedPlatform];
      return {
        eligible: false,
        reason: 'already_reviewed',
        existingReview: {
          platform: reviewedPlatform,
          stars: p.stars,
          url: p.url,
          reviewedAt: p.reviewed_at,
        },
      };
    }
  }

  // 2. Recent ask? (45-day cooldown)
  const { data: recent } = await supabase
    .from('review_requests')
    .select('id, sent_at, created_at')
    .eq('client_contact_id', clientContactId)
    .in('status', ['sent', 'responded', 'completed'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const lastAsk = recent[0].sent_at || recent[0].created_at;
    const ageMs = Date.now() - new Date(lastAsk).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 45) {
      return {
        eligible: false,
        reason: 'rate_limited_recent_ask',
        lastAskAt: lastAsk,
      };
    }
  }

  return { eligible: true };
}

/**
 * Mark a client as having left a review. Called by the webhook that detects
 * new Google/Facebook reviews, or by manual sync.
 */
export async function recordReviewLeft(params: {
  clientContactId: string;
  platform: 'google' | 'facebook';
  stars?: number;
  url?: string;
  reviewedAt?: string;
  clientName?: string;
  clientEmail?: string;
}) {
  const supabase = getSupabase();
  const reviewedAtIso = params.reviewedAt || new Date().toISOString();

  // Upsert into client_review_history
  const { data: existing } = await supabase
    .from('client_review_history')
    .select('platforms_reviewed, first_review_at')
    .eq('client_contact_id', params.clientContactId)
    .maybeSingle();

  const existingPlatforms = (existing?.platforms_reviewed as Record<string, any>) || {};
  existingPlatforms[params.platform] = {
    stars: params.stars,
    url: params.url,
    reviewed_at: reviewedAtIso,
  };

  const firstReviewAt = existing?.first_review_at || reviewedAtIso;

  await supabase.from('client_review_history').upsert(
    {
      client_contact_id: params.clientContactId,
      client_name: params.clientName,
      client_email: params.clientEmail,
      platforms_reviewed: existingPlatforms,
      first_review_at: firstReviewAt,
      latest_review_at: reviewedAtIso,
      synced_from: 'agent_detected',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_contact_id' }
  );

  // If there's an open review_requests row for this contact, close it out
  await supabase
    .from('review_requests')
    .update({
      review_left_status: 'confirmed',
      review_platform: params.platform,
      review_url: params.url,
      review_stars: params.stars,
      review_confirmed_at: reviewedAtIso,
      status: 'completed',
      updated_at: new Date().toISOString(),
    })
    .eq('client_contact_id', params.clientContactId)
    .in('status', ['sent', 'responded']);
}

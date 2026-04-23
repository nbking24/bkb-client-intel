// @ts-nocheck
/**
 * POST /api/public/review-submit
 *
 * Public endpoint — no auth. Called by the /review/[contactId] gateway page
 * when a client submits their star rating and (optional) review text.
 *
 * Flow:
 *   - Record the submission in review_gateway_submissions
 *   - If 5 stars → response includes googleReviewUrl for client-side redirect
 *   - If 1-4 stars → response marks as internal_followup (no Google redirect)
 *   - If this matches an open review_request, link it via source_review_request_id
 *
 * Request body:
 *   {
 *     contactId: string (required)
 *     stars: 1 | 2 | 3 | 4 | 5 (required)
 *     reviewText?: string
 *     clientName?: string
 *     clientEmail?: string
 *     clientPhone?: string
 *   }
 *
 * Response:
 *   200 { success: true, routedTo: 'google' | 'internal_followup', googleReviewUrl?: string, submissionId: string }
 *   400 if validation fails
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { createLowStarReviewTask, createFiveStarGiftCardTask } from '../../lib/marketing/jobtread-alerts';
import { markCompletedByContactKey } from '../../lib/marketing/past-client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { contactId, stars, reviewText, clientName, clientEmail, clientPhone } = body;

  if (!contactId || typeof contactId !== 'string') {
    return NextResponse.json({ error: 'contactId required' }, { status: 400 });
  }
  const starsNum = Number(stars);
  if (!Number.isInteger(starsNum) || starsNum < 1 || starsNum > 5) {
    return NextResponse.json({ error: 'stars must be 1-5' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Find the most recent open review_request for this contact so we can link it
  let sourceRequestId: string | null = null;
  let jobtreadJobId: string | null = null;
  {
    const { data } = await supabase
      .from('review_requests')
      .select('id, jobtread_job_id')
      .eq('client_contact_id', contactId)
      .in('status', ['sent', 'responded'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      sourceRequestId = data[0].id;
      jobtreadJobId = data[0].jobtread_job_id;
    }
  }

  const routedTo = starsNum === 5 ? 'google' : 'internal_followup';
  const userAgent = req.headers.get('user-agent') || null;
  const ipCountry = req.headers.get('x-vercel-ip-country') || null;

  const { data: inserted, error } = await supabase
    .from('review_gateway_submissions')
    .insert({
      client_contact_id: contactId,
      client_name: clientName || null,
      client_email: clientEmail || null,
      client_phone: clientPhone || null,
      jobtread_job_id: jobtreadJobId,
      star_rating: starsNum,
      review_text: reviewText || null,
      routed_to: routedTo,
      source_review_request_id: sourceRequestId,
      user_agent: userAgent,
      ip_country: ipCountry,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[review-submit] insert failed', error);
    return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 });
  }

  // Update the linked review_request with the survey response
  if (sourceRequestId) {
    await supabase
      .from('review_requests')
      .update({
        star_rating: starsNum,
        survey_response: { source: 'gateway', review_text: reviewText || null },
        survey_responded_at: new Date().toISOString(),
        status: 'responded',
        follow_up_action: routedTo === 'google' ? 'links_sent' : 'internal_alert',
        follow_up_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourceRequestId);
  }

  // Log event
  await supabase.from('marketing_events').insert({
    agent: 'review_gateway',
    event_type: 'gateway_submission',
    entity_type: 'review_gateway_submissions',
    entity_id: inserted.id,
    outcome: 'success',
    detail: {
      stars: starsNum,
      routed_to: routedTo,
      has_text: !!reviewText,
      contact_id: contactId,
    },
  });

  // If the contactId matches a row in past_client_outreach, mark it completed so
  // reminder and email-escalation automation stops. Non-blocking — failures here
  // should never break the public review-submit flow.
  try {
    const pcoRow = await markCompletedByContactKey(contactId, inserted.id);
    if (pcoRow) {
      await supabase.from('marketing_events').insert({
        agent: 'past_client_outreach',
        event_type: 'pco_completed_via_gateway',
        entity_type: 'past_client_outreach',
        entity_id: pcoRow.id,
        outcome: 'success',
        detail: {
          contact_key: contactId,
          stars: starsNum,
          submission_id: inserted.id,
        },
      });
    }
  } catch (pcoErr: any) {
    console.error('[review-submit] pco completion update threw:', pcoErr);
  }

  // Kick off JobTread alert — non-blocking. Missing tasks should never
  // break the public submit flow, so we log failures and move on.
  const alertCtx = {
    contactId,
    stars: starsNum,
    clientName: clientName || null,
    clientEmail: clientEmail || null,
    clientPhone: clientPhone || null,
    reviewText: reviewText || null,
    submissionId: inserted.id,
    jobtreadJobId,
  };
  try {
    const alertResult =
      starsNum === 5
        ? await createFiveStarGiftCardTask(alertCtx)
        : await createLowStarReviewTask(alertCtx);

    await supabase.from('marketing_events').insert({
      agent: 'review_gateway',
      event_type: alertResult.ok ? 'jobtread_task_created' : 'jobtread_task_failed',
      entity_type: 'review_gateway_submissions',
      entity_id: inserted.id,
      outcome: alertResult.ok ? 'success' : 'failed',
      detail: {
        stars: starsNum,
        task_type: starsNum === 5 ? 'five_star_gift_card' : 'low_star_followup',
        jobtread_task_id: alertResult.taskId || null,
        error: alertResult.error || null,
      },
    });
  } catch (alertErr: any) {
    console.error('[review-submit] alert dispatch threw:', alertErr);
  }

  const responsePayload: Record<string, any> = {
    success: true,
    routedTo,
    submissionId: inserted.id,
  };

  if (routedTo === 'google') {
    responsePayload.googleReviewUrl =
      process.env.GOOGLE_REVIEW_URL ||
      'https://search.google.com/local/writereview?placeid=PLACE_ID';
  }

  return NextResponse.json(responsePayload);
}

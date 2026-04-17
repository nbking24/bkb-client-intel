// @ts-nocheck
/**
 * POST /api/webhook/ghl-survey-response
 *
 * GHL fires this webhook after a client responds to the review survey.
 * Expected body (configure in GHL webhook):
 *   {
 *     contactId: string,
 *     stars: number,             // 1-5
 *     responses: object,         // full survey data
 *     workflowId?: string
 *   }
 *
 * Actions:
 *   - Update the matching review_requests row
 *   - If 5 stars → confirm; GHL workflow sends review links directly
 *   - If 1-4 stars → flag for make-it-right, alert Nathan
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { logEvent } from '../../lib/marketing/review-concierge';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // GHL webhooks should use a shared secret header. Configure in GHL side.
  const secret = req.headers.get('x-ghl-webhook-secret');
  if (!secret || secret !== process.env.GHL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { contactId, stars, responses, workflowId } = body;

  if (!contactId || stars == null) {
    return NextResponse.json(
      { error: 'contactId and stars required' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  // Find the latest open review_request for this contact
  const { data: rrRows } = await supabase
    .from('review_requests')
    .select('id')
    .eq('client_contact_id', contactId)
    .in('status', ['sent', 'queued'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (!rrRows || rrRows.length === 0) {
    // Log orphan — no open ask matches
    await logEvent({
      agent: 'ghl_webhook',
      eventType: 'survey_response_orphan',
      outcome: 'skipped',
      detail: { contactId, stars },
    });
    return NextResponse.json({ ok: true, matched: false });
  }

  const requestId = rrRows[0].id;
  const now = new Date().toISOString();
  const starsNum = Number(stars);

  const update: Record<string, any> = {
    star_rating: starsNum,
    survey_response: responses || {},
    survey_responded_at: now,
    status: 'responded',
    updated_at: now,
  };

  if (starsNum === 5) {
    update.follow_up_action = 'links_sent';
    update.follow_up_at = now;
  } else if (starsNum >= 1 && starsNum <= 4) {
    update.follow_up_action = 'internal_alert';
    update.follow_up_at = now;
  }

  await supabase.from('review_requests').update(update).eq('id', requestId);

  await logEvent({
    agent: 'ghl_webhook',
    eventType: 'survey_response_received',
    entityType: 'review_request',
    entityId: requestId,
    outcome: 'success',
    detail: { stars: starsNum, workflowId },
  });

  return NextResponse.json({ ok: true, requestId, action: update.follow_up_action });
}

// @ts-nocheck
/**
 * POST /api/public/review-gateway-viewed
 *
 * Public endpoint — no auth. Called by the /review/[contactId] gateway
 * (and its /r/[k] alias) on page mount to log that a contact landed on
 * the review page. This gives us "visited but didn't finish" visibility
 * separate from the existing form-submit tracking.
 *
 * Behavior:
 *   - Logs a marketing_events row with event_type='gateway_page_viewed'
 *   - If contactId matches a past_client_outreach row AND first_viewed_at
 *     is null, sets first_viewed_at to now. (Only the first visit is
 *     stamped on the pco row; subsequent visits just log events.)
 *
 * Request body:
 *   { contactId: string }
 *
 * Response:
 *   200 { success: true }
 *   400 if contactId missing
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { contactId } = body;
  if (!contactId || typeof contactId !== 'string') {
    return NextResponse.json({ error: 'contactId required' }, { status: 400 });
  }

  const supabase = getSupabase();
  const userAgent = req.headers.get('user-agent') || null;
  const ipCountry = req.headers.get('x-vercel-ip-country') || null;

  // Find matching pco row (optional — not all contactIds are past clients)
  const { data: pcoRow } = await supabase
    .from('past_client_outreach')
    .select('id, first_viewed_at')
    .eq('contact_key', contactId)
    .maybeSingle();

  // First-view stamping
  if (pcoRow && !pcoRow.first_viewed_at) {
    await supabase
      .from('past_client_outreach')
      .update({ first_viewed_at: new Date().toISOString() })
      .eq('id', pcoRow.id);
  }

  // Always log the event (even if the page is re-opened or this isn't a pco contact)
  await supabase.from('marketing_events').insert({
    agent: 'review_gateway',
    event_type: 'gateway_page_viewed',
    entity_type: pcoRow ? 'past_client_outreach' : null,
    entity_id: pcoRow ? pcoRow.id : null,
    outcome: 'success',
    detail: {
      contact_id: contactId,
      user_agent: userAgent,
      ip_country: ipCountry,
      first_view: pcoRow ? !pcoRow.first_viewed_at : null,
    },
  });

  return NextResponse.json({ success: true });
}

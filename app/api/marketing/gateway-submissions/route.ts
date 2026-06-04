// @ts-nocheck
/**
 * GET   /api/marketing/gateway-submissions    list every review_gateway_submissions row,
 *                                             joined to past_client_outreach for client + project info.
 *                                             Optional filters: ?routed=google|internal_followup, ?verified=true|false
 * PATCH /api/marketing/gateway-submissions    toggle google_verified / set internal_note on one row.
 *
 * Bearer-token auth (same pattern as the rest of /api/marketing).
 *
 * Why this exists: the original Reviews dashboard only reads `review_requests`, but
 * the past-client text campaign drove clients to r.brettkingbuilder.com/r/{id}, and
 * those submissions land in `review_gateway_submissions` with no matching
 * `review_requests` row. As a result, 53 real reviews were invisible on the
 * dashboard. This endpoint surfaces them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAuth } from '../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const routed = sp.get('routed'); // 'google' | 'internal_followup'
  const verified = sp.get('verified'); // 'true' | 'false'
  const limit = Math.min(Number(sp.get('limit') || 500), 2000);

  const supabase = getSupabase();
  let query = supabase
    .from('review_gateway_submissions')
    .select(
      `
      id,
      client_contact_id,
      client_name,
      client_email,
      client_phone,
      jobtread_job_id,
      star_rating,
      review_text,
      routed_to,
      source_review_request_id,
      google_verified,
      verified_at,
      verified_by,
      internal_note,
      created_at
      `,
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (routed === 'google' || routed === 'internal_followup') {
    query = query.eq('routed_to', routed);
  }
  if (verified === 'true') query = query.eq('google_verified', true);
  if (verified === 'false') query = query.eq('google_verified', false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Pull the matching past_client_outreach rows in one shot so we can attach
  // a friendly full_name + project_names + email + phone to each submission.
  // The contact_key on PCO === client_contact_id on the gateway submission
  // (both are the 10-digit phone number from the campaign).
  //
  // NOTE: the column is `jobtread_account_id`, not `jobtread_customer_id`.
  // The previous version selected a non-existent column, which caused the
  // entire row to come back null from supabase and silently broke every
  // name resolution, every project name, every email. That's why Nathan saw
  // "no names" on the dashboard even though every real PCO row has a name.
  const contactKeys = Array.from(new Set((data || []).map((s) => s.client_contact_id).filter(Boolean)));
  let pcoByKey: Record<string, any> = {};
  if (contactKeys.length > 0) {
    const { data: pco, error: pcoErr } = await supabase
      .from('past_client_outreach')
      .select('contact_key, full_name, first_name, last_name, project_names, email, phone, jobtread_account_id, ghl_contact_id')
      .in('contact_key', contactKeys);
    if (pcoErr) {
      console.error('[gateway-submissions] PCO lookup failed:', pcoErr);
    }
    for (const row of pco || []) {
      pcoByKey[row.contact_key] = row;
    }
  }

  // Helper: pretty-print a phone number for display, since contactKey is just
  // ten digits. "2128449369" -> "(212) 844-9369".
  const formatPhone = (digits: string | null | undefined) => {
    if (!digits) return null;
    const m = String(digits).match(/^(\d{3})(\d{3})(\d{4})$/);
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : digits;
  };

  const submissions = (data || []).map((s) => {
    const pco = pcoByKey[s.client_contact_id] || null;
    const displayName =
      s.client_name ||
      pco?.full_name ||
      [pco?.first_name, pco?.last_name].filter(Boolean).join(' ').trim() ||
      null;
    // If we still can't resolve a name, the 10-digit phone is at least
    // identifying — show it formatted so Nathan can recognize the number
    // and add a name manually (or we can backfill later via JT).
    const fallbackLabel = !displayName && /^\d{10}$/.test(s.client_contact_id)
      ? `Phone ${formatPhone(s.client_contact_id)}`
      : null;
    return {
      id: s.id,
      clientContactId: s.client_contact_id,
      clientName: displayName,
      clientLabel: displayName || fallbackLabel || 'Unknown client',
      clientPhoneFormatted: formatPhone(pco?.phone || s.client_contact_id),
      clientEmail: s.client_email || pco?.email || null,
      clientPhone: s.client_phone || pco?.phone || null,
      jobtreadJobId: s.jobtread_job_id,
      jobtreadAccountId: pco?.jobtread_account_id || null,
      ghlContactId: pco?.ghl_contact_id || null,
      projectNames: pco?.project_names || null,
      starRating: s.star_rating,
      reviewText: s.review_text,
      routedTo: s.routed_to, // 'google' | 'internal_followup'
      googleVerified: s.google_verified === true,
      verifiedAt: s.verified_at,
      verifiedBy: s.verified_by,
      internalNote: s.internal_note,
      submittedAt: s.created_at,
      sourceReviewRequestId: s.source_review_request_id,
    };
  });

  // Counts for the dashboard header (always over the FULL set, not the filtered slice).
  const { count: totalCount } = await supabase
    .from('review_gateway_submissions')
    .select('id', { count: 'exact', head: true });
  const { count: googleRoutedCount } = await supabase
    .from('review_gateway_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('routed_to', 'google');
  const { count: lowStarCount } = await supabase
    .from('review_gateway_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('routed_to', 'internal_followup');
  const { count: verifiedCount } = await supabase
    .from('review_gateway_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('google_verified', true);

  return NextResponse.json({
    submissions,
    counts: {
      total: totalCount || 0,
      routedToGoogle: googleRoutedCount || 0,
      internalFollowup: lowStarCount || 0,
      googleVerified: verifiedCount || 0,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { id, googleVerified, internalNote } = body || {};
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const patch: Record<string, any> = {};
  if (typeof googleVerified === 'boolean') {
    patch.google_verified = googleVerified;
    patch.verified_at = googleVerified ? new Date().toISOString() : null;
    patch.verified_by = googleVerified ? (auth.userId || 'unknown') : null;
  }
  if (typeof internalNote === 'string') {
    patch.internal_note = internalNote.trim() || null;
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('review_gateway_submissions')
    .update(patch)
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

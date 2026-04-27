// @ts-nocheck
/**
 * GET /api/marketing/past-client/list
 *
 * Returns the full past-client outreach queue grouped by stage, plus
 * the funnel counts. Used by /dashboard/marketing/past-client-outreach.
 *
 * Query params:
 *   stage (optional) — filter to one stage
 *   limit (optional, default 500) — cap on rows returned
 *
 * Auth: Bearer (dashboard) OR x-agent-token
 * Response: { rows: [...], funnel: {...} }
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../../lib/auth';
import { getSupabase } from '../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const stage = req.nextUrl.searchParams.get('stage');
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get('limit')) || 500,
    1000,
  );

  const supabase = getSupabase();

  try {
    // Explicit field list — `.select('*')` was silently dropping ghl_contact_id,
    // priority, and first_viewed_at on this table for some payloads. Listing
    // them explicitly forces PostgREST to include them in every response.
    const FIELDS = [
      'id', 'contact_key', 'ghl_contact_id', 'jobtread_account_id',
      'first_name', 'last_name', 'full_name',
      'phone', 'phone_digits', 'email',
      'source', 'project_names', 'job_numbers', 'city',
      'stage', 'priority',
      'queued_at', 'initial_sent_at', 'reminder_sent_at', 'email_sent_at',
      'reply_received_at', 'form_completed_at', 'opted_out_at',
      'first_viewed_at',
      'initial_text_body', 'reminder_text_body', 'email_subject', 'email_body',
      'reply_text', 'reply_full_thread',
      'form_submission_id',
      'flag_notes', 'internal_notes',
      'created_at', 'updated_at',
    ].join(', ');

    let query = supabase
      .from('past_client_outreach')
      .select(FIELDS)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (stage) query = query.eq('stage', stage);

    const [{ data: rows, error: rowsErr }, funnelRes] = await Promise.all([
      query,
      supabase.from('pco_funnel').select('*').maybeSingle(),
    ]);
    if (rowsErr) throw rowsErr;

    return NextResponse.json(
      {
        rows: rows || [],
        funnel: funnelRes.data || {},
      },
      {
        // Belt + suspenders: prevent any intermediary cache from holding stale rows
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      },
    );
  } catch (e: any) {
    console.error('[pco/list]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

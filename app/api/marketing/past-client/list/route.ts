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

    // Fetch the full unfiltered set for funnel computation (we always need
    // accurate counts regardless of the row filter applied below). This
    // bypasses the pco_funnel view which has been returning stale counts.
    const allRowsQuery = supabase
      .from('past_client_outreach')
      .select('stage')
      .limit(2000);

    let rowsQuery = supabase
      .from('past_client_outreach')
      .select(FIELDS)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (stage) rowsQuery = rowsQuery.eq('stage', stage);

    const [allRowsRes, rowsRes] = await Promise.all([allRowsQuery, rowsQuery]);
    if (allRowsRes.error) throw allRowsRes.error;
    if (rowsRes.error) throw rowsRes.error;

    // Compute funnel counts from the unfiltered set so they always reflect
    // ground truth (the pco_funnel view has cache staleness issues).
    const funnel: Record<string, number> = {
      queued: 0, initial_sent: 0, reminder_sent: 0, email_sent: 0,
      replied: 0, completed: 0, opted_out: 0, skipped: 0, failed: 0, total: 0,
    };
    for (const r of allRowsRes.data || []) {
      funnel.total++;
      if (r.stage in funnel) funnel[r.stage]++;
    }

    return NextResponse.json(
      {
        rows: rowsRes.data || [],
        funnel,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
        },
      },
    );
  } catch (e: any) {
    console.error('[pco/list]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

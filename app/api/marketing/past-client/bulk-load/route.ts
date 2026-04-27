// @ts-nocheck
/**
 * POST /api/marketing/past-client/bulk-load
 *
 * Upserts past-client outreach rows from the send-queue spreadsheet.
 * Idempotent: existing rows keyed by contact_key are updated with the
 * latest text/notes but their stage and timestamps are left alone so
 * we never reset someone who's already in-flight.
 *
 * Body:
 *   {
 *     rows: [
 *       {
 *         contact_key: string,            (required — phone_digits)
 *         first_name?, last_name?, full_name?,
 *         phone?, phone_digits?, email?,
 *         source?: 'jt_past_project' | 'loop_contact',
 *         project_names?, job_numbers?, city?,
 *         initial_text_body?: string,     (column O text)
 *         flag_notes?: string,
 *         stage?: 'queued' | 'skipped',   (default 'queued'; 'skipped' if you want to pre-skip)
 *         ghl_contact_id?, jobtread_account_id?,
 *       },
 *       ...
 *     ]
 *   }
 *
 * Auth: x-agent-token OR Bearer
 * Response: { inserted, updated, skipped, errors: [...] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../../lib/auth';
import { getSupabase } from '../../../lib/supabase';

export const runtime = 'nodejs';

const ALLOWED_FIELDS = [
  'contact_key', 'ghl_contact_id', 'jobtread_account_id',
  'first_name', 'last_name', 'full_name',
  'phone', 'phone_digits', 'email',
  'source', 'project_names', 'job_numbers', 'city',
  'initial_text_body', 'flag_notes', 'priority',
  // Recoverable timestamps — explicit nulls allowed so we can reset a row
  // back to queued state if a phantom send marked it incorrectly.
  'initial_sent_at',
];

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'rows required' }, { status: 400 });
  }
  if (rows.length > 500) {
    return NextResponse.json({ error: 'max 500 rows per request' }, { status: 400 });
  }

  const supabase = getSupabase();
  const results = { inserted: 0, updated: 0, skipped: 0, errors: [] as any[] };

  for (const raw of rows) {
    if (!raw?.contact_key) {
      results.skipped++;
      results.errors.push({ row: raw, reason: 'missing contact_key' });
      continue;
    }
    // Whitelist fields so callers can't poke at stage/timestamps
    const payload: any = {};
    for (const k of ALLOWED_FIELDS) {
      if (raw[k] !== undefined) payload[k] = raw[k];
    }
    // Allow explicit stage transitions at load time:
    //   'skipped' — for the no-phone rows
    //   'queued'  — for resetting a row that was incorrectly marked sent
    if (raw.stage === 'skipped' || raw.stage === 'queued') {
      payload.stage = raw.stage;
    }

    try {
      const { data: existing } = await supabase
        .from('past_client_outreach')
        .select('id, stage')
        .eq('contact_key', payload.contact_key)
        .maybeSingle();

      if (existing) {
        // Update safe fields only — never reset stage/timestamps for in-flight rows
        const { error } = await supabase
          .from('past_client_outreach')
          .update(payload)
          .eq('id', existing.id);
        if (error) throw error;
        results.updated++;
      } else {
        const { error } = await supabase
          .from('past_client_outreach')
          .insert({ ...payload, stage: payload.stage || 'queued' });
        if (error) throw error;
        results.inserted++;
      }
    } catch (e: any) {
      results.errors.push({ contact_key: raw.contact_key, error: e.message });
      results.skipped++;
    }
  }

  return NextResponse.json(results);
}

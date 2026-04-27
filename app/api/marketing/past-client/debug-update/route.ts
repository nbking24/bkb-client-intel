// @ts-nocheck
/**
 * POST /api/marketing/past-client/debug-update
 *
 * Inspect-and-fix-state endpoint. Returns the row's current state via
 * a fresh SELECT, optionally writes a partial update, then SELECTs again.
 * Reveals any reader/writer cache inconsistencies.
 *
 * Body:
 *   { contact_key: string, set?: { stage?, initial_sent_at?, ghl_contact_id?, ... } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../../lib/auth';
import { getSupabase } from '../../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const contact_key = body.contact_key;
  const set = body.set;
  if (!contact_key) return NextResponse.json({ error: 'contact_key required' }, { status: 400 });

  const supabase = getSupabase();
  const out: any = { contact_key };

  // Snapshot before any mutation
  {
    const { data, error } = await supabase
      .from('past_client_outreach')
      .select('id, contact_key, ghl_contact_id, priority, stage, initial_sent_at, queued_at, updated_at')
      .eq('contact_key', contact_key)
      .maybeSingle();
    out.before = { data, error: error?.message || null };
  }

  if (set && typeof set === 'object') {
    const r = await supabase
      .from('past_client_outreach')
      .update(set)
      .eq('contact_key', contact_key);
    out.update = { status: r.status, error: r.error?.message || null, applied: set };

    const { data, error } = await supabase
      .from('past_client_outreach')
      .select('id, contact_key, ghl_contact_id, priority, stage, initial_sent_at, queued_at, updated_at')
      .eq('contact_key', contact_key)
      .maybeSingle();
    out.after = { data, error: error?.message || null };
  }

  return NextResponse.json(out, {
    headers: { 'Cache-Control': 'no-store, no-cache' },
  });
}

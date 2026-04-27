// @ts-nocheck
/**
 * POST /api/marketing/past-client/debug-update
 *
 * TEMPORARY debug endpoint — isolates whether ghl_contact_id writes persist.
 * Updates a single row via three different mechanisms and returns each
 * result + a fresh readback after a short delay so we can see what
 * Postgres actually committed.
 *
 * Body: { contact_key: string, ghl_contact_id?: string }
 * Auth: x-agent-token
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
  const test_value = body.ghl_contact_id || `DEBUG_${Date.now()}`;
  if (!contact_key) return NextResponse.json({ error: 'contact_key required' }, { status: 400 });

  const supabase = getSupabase();
  const out: any = { contact_key, test_value };

  // Snapshot BEFORE
  {
    const { data, error } = await supabase
      .from('past_client_outreach')
      .select('id, contact_key, ghl_contact_id, priority, stage')
      .eq('contact_key', contact_key)
      .maybeSingle();
    out.before = { data, error: error?.message || null };
  }

  // Method 1: update().eq() - direct
  {
    const r = await supabase
      .from('past_client_outreach')
      .update({ ghl_contact_id: test_value })
      .eq('contact_key', contact_key);
    out.method1_update = { status: r.status, statusText: r.statusText, error: r.error?.message || null };
  }

  // Immediate readback (same client)
  {
    const { data, error } = await supabase
      .from('past_client_outreach')
      .select('contact_key, ghl_contact_id')
      .eq('contact_key', contact_key)
      .maybeSingle();
    out.immediate_readback = { data, error: error?.message || null };
  }

  // Wait 2 seconds, read again (simulates a separate request)
  await new Promise((r) => setTimeout(r, 2000));
  {
    const { data, error } = await supabase
      .from('past_client_outreach')
      .select('contact_key, ghl_contact_id')
      .eq('contact_key', contact_key)
      .maybeSingle();
    out.delayed_readback = { data, error: error?.message || null };
  }

  // Method 2: try with .select() chained
  const test_value_2 = test_value + '_v2';
  {
    const r = await supabase
      .from('past_client_outreach')
      .update({ ghl_contact_id: test_value_2 })
      .eq('contact_key', contact_key)
      .select('contact_key, ghl_contact_id');
    out.method2_update_with_select = {
      status: r.status,
      data: r.data,
      error: r.error?.message || null,
    };
  }

  // Final readback
  {
    const { data, error } = await supabase
      .from('past_client_outreach')
      .select('contact_key, ghl_contact_id')
      .eq('contact_key', contact_key)
      .maybeSingle();
    out.final_readback = { data, error: error?.message || null };
  }

  return NextResponse.json(out);
}

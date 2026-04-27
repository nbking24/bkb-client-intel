// @ts-nocheck
/**
 * POST /api/marketing/past-client/debug-update
 *
 * TEMPORARY — diagnose why mark-sent's .eq().eq() filter doesn't match.
 * Body: { contact_key: string, set?: object }
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
  const { contact_key, set } = body;
  if (!contact_key) return NextResponse.json({ error: 'contact_key required' }, { status: 400 });

  const supabase = getSupabase();
  const out: any = { contact_key, set };

  // 1. Read row by contact_key only
  {
    const { data, error } = await supabase
      .from('past_client_outreach')
      .select('id, contact_key, stage, initial_sent_at, updated_at')
      .eq('contact_key', contact_key)
      .maybeSingle();
    out.read_by_key = { data, error: error?.message };
  }

  // 2. Read row with .eq('contact_key', X).eq('stage', 'queued')
  {
    const { data, error } = await supabase
      .from('past_client_outreach')
      .select('id, contact_key, stage')
      .eq('contact_key', contact_key)
      .eq('stage', 'queued')
      .maybeSingle();
    out.read_with_stage_filter = { data, error: error?.message };
  }

  // 3. Try update without stage filter (should work)
  if (set) {
    const r = await supabase
      .from('past_client_outreach')
      .update(set)
      .eq('contact_key', contact_key)
      .select('id, contact_key, stage, initial_sent_at');
    out.update_no_stage_filter = { status: r.status, data: r.data, error: r.error?.message };
  }

  // 4. Read again
  {
    const { data, error } = await supabase
      .from('past_client_outreach')
      .select('id, contact_key, stage, initial_sent_at, updated_at')
      .eq('contact_key', contact_key)
      .maybeSingle();
    out.read_after = { data, error: error?.message };
  }

  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}

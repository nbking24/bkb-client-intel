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
    let query = supabase
      .from('past_client_outreach')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (stage) query = query.eq('stage', stage);

    const [{ data: rows, error: rowsErr }, funnelRes] = await Promise.all([
      query,
      supabase.from('pco_funnel').select('*').maybeSingle(),
    ]);
    if (rowsErr) throw rowsErr;

    return NextResponse.json({
      rows: rows || [],
      funnel: funnelRes.data || {},
    });
  } catch (e: any) {
    console.error('[pco/list]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

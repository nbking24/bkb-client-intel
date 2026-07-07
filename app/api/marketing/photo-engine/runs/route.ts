// @ts-nocheck
/**
 * GET /api/marketing/photo-engine/runs
 *
 * Returns the ~30 most recent marketing_photo_runs, newest first, for the
 * recent-activity panel in the Photo Engine dashboard.
 *
 * Owner/admin only.
 *
 * Style note: no em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { validateAuth } from '@/app/api/lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['owner', 'admin'].includes(auth.role || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('marketing_photo_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ runs: data || [] });
}

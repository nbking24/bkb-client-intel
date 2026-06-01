// @ts-nocheck
/**
 * GET /api/transcripts/history
 * Searchable archive of the user's confirmed/processed meeting transcripts.
 * Returns metadata only (no full transcript text — that loads on demand via
 * GET /api/transcripts/:id). Owners/admins can pass ?scope=all.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '@/app/api/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const scopeAll = url.searchParams.get('scope') === 'all';

  const sb = getSupabase();
  let q = sb
    .from('meeting_transcripts')
    .select('id, title, recorded_at, created_at, recorded_by_user, assigned_kind, assigned_job_id, assigned_job_name, assigned_lead_name, jt_daily_log_id, status')
    .in('status', ['confirmed', 'processing', 'processed', 'failed'])
    .order('recorded_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(500);

  if (!scopeAll && auth.userId) q = q.eq('recorded_by_user', auth.userId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transcripts: data || [] });
}

// @ts-nocheck
/**
 * GET /api/transcripts/:id
 * Full transcript (text + summary + metadata) for the viewer/search panel.
 * Scoped to the recorder; owners/admins can read any.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '@/app/api/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getSupabase();
  const { data: row, error } = await sb
    .from('meeting_transcripts')
    .select('id, title, recorded_at, duration_seconds, recorded_by_user, assigned_kind, assigned_job_id, assigned_job_name, assigned_lead_name, jt_daily_log_id, summary, raw_transcript, status')
    .eq('id', params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const privileged = auth.role === 'owner' || auth.role === 'admin';
  if (!privileged && row.recorded_by_user && row.recorded_by_user !== auth.userId) {
    return NextResponse.json({ error: 'Not your transcript' }, { status: 403 });
  }
  return NextResponse.json({ transcript: row });
}

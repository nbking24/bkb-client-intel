// @ts-nocheck
/**
 * GET /api/transcripts
 * Lists meeting transcripts awaiting confirmation, scoped to the requesting
 * user (the recorder). Owners/admins can pass ?scope=all to see everyone's.
 * Also returns active jobs to populate the assignment dropdown.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '@/app/api/lib/supabase';
import { getActiveJobs } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const scopeAll = url.searchParams.get('scope') === 'all' && (auth.role === 'owner' || auth.role === 'admin');
  const status = url.searchParams.get('status') || 'unassigned';

  const sb = getSupabase();
  let q = sb
    .from('meeting_transcripts')
    .select('id, title, recorded_at, duration_seconds, audio_url, recorded_by_user, matched_calendar_event, suggested_kind, suggested_job_id, suggested_job_name, suggested_lead_contact_id, suggested_lead_name, match_confidence, match_reasoning, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (status !== 'any') q = q.eq('status', status);
  if (!scopeAll && auth.userId) q = q.eq('recorded_by_user', auth.userId);

  const { data: transcripts, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Job options for the dropdown (best-effort).
  let jobOptions: any[] = [];
  try {
    const jobs = await getActiveJobs(200);
    jobOptions = jobs.map((j: any) => ({ id: j.id, name: j.name, clientName: j.clientName || null, number: j.number || null }));
  } catch { jobOptions = []; }

  return NextResponse.json({ transcripts: transcripts || [], jobOptions });
}

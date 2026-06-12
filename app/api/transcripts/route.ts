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
import { listActiveLeads } from '@/app/lib/leads-needs-attention';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

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

  // Job + lead options for the confirm dropdowns (best-effort). When a
  // transcript belongs to an early-stage call ("Lead / no job yet"), the
  // confirm UI shows a dropdown of active Loop leads instead of a free-text
  // client name field — see TranscriptsToConfirm. Fetch in parallel so the
  // confirm card doesn't wait twice. Surface any failure reason in the
  // response so the dashboard can show a clear empty state instead of a
  // silent "no leads found" mystery.
  let leadOptionsError: string | null = null;
  const [jobOptions, leadOptions] = await Promise.all([
    getActiveJobs()
      .then((jobs) =>
        jobs.map((j: any) => ({
          id: j.id,
          name: j.name,
          clientName: j.clientName || null,
          number: j.number || null,
        })),
      )
      .catch(() => [] as any[]),
    listActiveLeads().catch((err: any) => {
      leadOptionsError = err?.message || 'failed';
      console.warn('[api/transcripts] listActiveLeads failed:', leadOptionsError);
      return [] as any[];
    }),
  ]);

  return NextResponse.json({
    transcripts: transcripts || [],
    jobOptions,
    leadOptions,
    ...(leadOptionsError ? { leadOptionsError } : {}),
  });
}

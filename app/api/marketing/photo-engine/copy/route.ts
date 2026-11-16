// @ts-nocheck
/**
 * Marketing pipeline Step 3: copy new photos, videos and plans for one job
 * from JobTread to Mike's FTP.
 *
 * GET   the jobs selected for the engine, flagged ones first.
 * POST  { jobId, dryRun?: boolean }  dryRun defaults to TRUE. Only an
 *       explicit dryRun: false uploads anything. Returns what would be (or
 *       was) sent, excluded for good, or left waiting for labels, and
 *       done: false when it stopped near the time limit (call again to
 *       continue).
 *
 * Owner only.
 *
 * Style note: no em or en dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '@/app/api/lib/auth';
import { isConfigured } from '@/app/api/lib/ftp';
import { getSupabase } from '@/app/api/lib/supabase';
import { runCopyStep } from '@/app/api/lib/marketing/copy-step';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function owner(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest) {
  const denied = owner(req);
  if (denied) return denied;
  const { data, error } = await getSupabase()
    .from('marketing_photo_selected_jobs')
    .select('job_id, job_name, job_number, folder_name, included, needs_processing, scan_mode, last_processed_at')
    .eq('included', true);
  if (error) return NextResponse.json({ error: error.message });
  const jobs = (data || []).sort((a, b) =>
    a.needs_processing !== b.needs_processing ? (a.needs_processing ? -1 : 1) : (a.job_name || '').localeCompare(b.job_name || '')
  );
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const denied = owner(req);
  if (denied) return denied;
  if (!isConfigured()) return NextResponse.json({ error: 'The FTP connection is not set up in the Hub environment.' });

  const body = await req.json().catch(() => ({}));
  if (!body.jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });

  try {
    const result = await runCopyStep({
      jobId: String(body.jobId),
      dryRun: body.dryRun !== false,
      deadlineMs: 240000,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Copy step failed' });
  }
}

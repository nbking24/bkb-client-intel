// @ts-nocheck
/**
 * POST /api/marketing/photo-engine/queue
 *
 * On-demand trigger. Body: { jobId }. Looks up the job among the eligible
 * marketing jobs, inserts a marketing_photo_runs row (status 'queued',
 * trigger 'manual'), and returns the inserted row. The Cowork/Claude task polls
 * for queued rows and does the actual media work.
 *
 * Owner/admin only.
 *
 * Style note: no em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { validateAuth } from '@/app/api/lib/auth';
import { getMarketingJobs } from '@/app/api/lib/jobtread';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['owner', 'admin'].includes(auth.role || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : '';
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  // Confirm the job is actually one of the eligible marketing jobs.
  const jobs = await getMarketingJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) {
    return NextResponse.json(
      { error: 'Job not found among eligible marketing jobs' },
      { status: 404 }
    );
  }

  const supabase = getSupabase();
  const { data: inserted, error } = await supabase
    .from('marketing_photo_runs')
    .insert({
      job_id: job.id,
      job_number: job.number || null,
      job_name: job.name || null,
      folder_name: job.folderName || null,
      trigger: 'manual',
      status: 'queued',
      email_status: 'draft',
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ run: inserted });
}

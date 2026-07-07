// @ts-nocheck
/**
 * POST /api/marketing/photo-engine/select
 *
 * Manual job selection for the Photo Engine. Body: { jobId, included }. Resolves
 * the job's name/number from the active JobTread jobs, computes the FTP folder
 * name, and upserts a marketing_photo_selected_jobs row. Including a job opts it
 * in; setting included false removes it from processing without deleting history.
 *
 * Owner/admin only.
 *
 * Style note: no em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { validateAuth } from '@/app/api/lib/auth';
import { getActiveJobs, folderNameForJob } from '@/app/api/lib/jobtread';

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
  const included = body?.included !== false; // default true

  // Resolve the job among the active JobTread jobs.
  const jobs = await getActiveJobs(200);
  const job = jobs.find((j: any) => j.id === jobId);
  if (!job) {
    return NextResponse.json(
      { error: 'Job not found among active jobs' },
      { status: 404 }
    );
  }

  const jobName = job.name || '';
  const supabase = getSupabase();
  const { error } = await supabase
    .from('marketing_photo_selected_jobs')
    .upsert(
      {
        job_id: jobId,
        job_number: job.number || null,
        job_name: jobName || null,
        folder_name: folderNameForJob(jobName) || null,
        included,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'job_id' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, jobId, included });
}

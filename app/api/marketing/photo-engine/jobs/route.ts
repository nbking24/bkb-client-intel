// @ts-nocheck
/**
 * GET /api/marketing/photo-engine/jobs
 *
 * Returns ALL active JobTread jobs, each merged with:
 *   - folderName (the per-job folder used on the designer's FTP server),
 *   - included (whether the user has manually selected the job for the engine,
 *     read from marketing_photo_selected_jobs; a job with no row or included
 *     false is false),
 *   - lastRun fields from the newest marketing_photo_runs row for that job.
 * Also returns the current live/draft mode read from the single settings row.
 *
 * Shape: { jobs: [...], liveMode: boolean }
 *
 * Included jobs sort first, then by job name.
 *
 * Owner/admin only.
 *
 * Style note: no em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { validateAuth } from '@/app/api/lib/auth';
import { getAllJobs, folderNameForJob } from '@/app/api/lib/jobtread';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['owner', 'admin'].includes(auth.role || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getSupabase();

  // All active jobs from JobTread. Never let a JobTread hiccup crash the route
  // with an empty body, or the client cannot parse the response.
  let jobs: any[] = [];
  try {
    jobs = await getAllJobs();
  } catch (err: any) {
    return NextResponse.json(
      { jobs: [], liveMode: false, error: 'Could not load jobs from JobTread: ' + (err?.message || 'unknown error') },
      { status: 200 }
    );
  }

  // Live mode from the single settings row.
  const { data: settings } = await supabase
    .from('marketing_photo_settings')
    .select('live_mode')
    .eq('id', 1)
    .maybeSingle();
  const liveMode = settings?.live_mode === true;

  // Which jobs the user has manually included.
  const includedByJob: Record<string, boolean> = {};
  const { data: selections } = await supabase
    .from('marketing_photo_selected_jobs')
    .select('job_id, included');
  for (const sel of selections || []) {
    includedByJob[sel.job_id] = sel.included === true;
  }

  // Latest run per job. Pull recent runs and keep the newest per job_id.
  const jobIds = jobs.map((j: any) => j.id).filter(Boolean);
  const latestByJob: Record<string, any> = {};
  if (jobIds.length > 0) {
    const { data: runs } = await supabase
      .from('marketing_photo_runs')
      .select('job_id, status, photos_added, videos_added, profile_updated, email_status, change_summary, completed_at, created_at')
      .in('job_id', jobIds)
      .order('created_at', { ascending: false });
    for (const run of runs || []) {
      if (!latestByJob[run.job_id]) latestByJob[run.job_id] = run;
    }
  }

  const merged = jobs.map((j: any) => {
    const last = latestByJob[j.id] || null;
    return {
      id: j.id,
      name: j.name,
      number: j.number,
      folderName: folderNameForJob(j.name || ''),
      active: !j.closedOn,
      included: includedByJob[j.id] === true,
      lastRun: last
        ? {
            status: last.status,
            photosAdded: last.photos_added,
            videosAdded: last.videos_added,
            profileUpdated: last.profile_updated,
            emailStatus: last.email_status,
            changeSummary: last.change_summary,
            completedAt: last.completed_at,
            createdAt: last.created_at,
          }
        : null,
    };
  });

  // Included jobs first, then by job name (case-insensitive).
  // Included first, then active jobs before completed jobs, then alphabetical.
  merged.sort((a: any, b: any) => {
    if (a.included !== b.included) return a.included ? -1 : 1;
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });

  return NextResponse.json({ jobs: merged, liveMode });
}

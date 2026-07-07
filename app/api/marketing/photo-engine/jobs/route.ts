// @ts-nocheck
/**
 * GET /api/marketing/photo-engine/jobs
 *
 * Returns the jobs opted in for the Marketing Photo Engine (active jobs with a
 * truthy "Marketing" custom field in JobTread), each merged with its latest run
 * row from marketing_photo_runs. Also returns the current live/draft mode read
 * from the single settings row.
 *
 * Shape: { jobs: [...], liveMode: boolean }
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

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['owner', 'admin'].includes(auth.role || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getSupabase();

  // Eligible jobs from JobTread (defensive: helper returns [] on error).
  const jobs = await getMarketingJobs();

  // Live mode from the single settings row.
  const { data: settings } = await supabase
    .from('marketing_photo_settings')
    .select('live_mode')
    .eq('id', 1)
    .maybeSingle();
  const liveMode = settings?.live_mode === true;

  // Latest run per job. Pull recent runs and keep the newest per job_id.
  const jobIds = jobs.map((j) => j.id).filter(Boolean);
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

  const merged = jobs.map((j) => {
    const last = latestByJob[j.id] || null;
    return {
      ...j,
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

  return NextResponse.json({ jobs: merged, liveMode });
}

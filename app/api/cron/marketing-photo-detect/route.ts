// @ts-nocheck
/**
 * GET /api/cron/marketing-photo-detect
 *
 * Nightly change detector for the Marketing Photo Engine. Change detection used
 * to live inside the heavy weekly Cowork/Claude task, which meant paying to scan
 * every opted in job even when nothing had changed. This cheap cron moves that
 * work out: for each selected job it only asks JobTread for counts (no file
 * downloads, no vision work) and flags the jobs that actually have new items so
 * the AI processor can skip the rest.
 *
 * Flagging rules:
 *   - No marketing_photo_doc_state row yet: this job has never been built, so
 *     flag it needs_processing = true, scan_mode = 'full' (first-time full scan).
 *   - Otherwise: look for new files or a newly approved customer order since the
 *     last processed/checked time. If found, flag needs_processing = true,
 *     scan_mode = 'delta' (new items only). If nothing is new we leave any
 *     existing pending flag alone rather than clearing it here.
 *   - last_checked_at is always stamped so we have a moving baseline.
 *
 * Auth: Bearer CRON_SECRET, or App PIN base64 (matches the other cron endpoints).
 * Vercel Cron sends Authorization: Bearer <CRON_SECRET> automatically when the
 * CRON_SECRET env var is set.
 *
 * Style note: no em dashes anywhere in this file. Nathan hates them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { jobHasNewMarketingItemsSince, getJobVideoFileIds } from '@/app/api/lib/jobtread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Same auth pattern as the other crons.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    const appPin = process.env.APP_PIN;
    if (appPin) {
      const expectedAuth = `Bearer ${Buffer.from(appPin + ':').toString('base64')}`;
      if (authHeader !== expectedAuth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = getSupabase();

  // Load the jobs a user has opted in for marketing.
  const { data: jobs, error } = await supabase
    .from('marketing_photo_selected_jobs')
    .select('job_id, folder_name, needs_processing, scan_mode, last_processed_at, last_checked_at')
    .eq('included', true);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load selected jobs: ' + error.message },
      { status: 500 }
    );
  }

  const selected = jobs || [];
  const flagged: { folder_name: string | null; scan_mode: string }[] = [];
  let checked = 0;
  const nowISO = new Date().toISOString();

  for (const job of selected) {
    // One bad job must not fail the whole run.
    try {
      checked++;

      // Has this job ever been built? doc_state is upserted by the processor.
      const { data: docStateRow } = await supabase
        .from('marketing_photo_doc_state')
        .select('job_id, content')
        .eq('job_id', job.job_id)
        .maybeSingle();

      const update: Record<string, unknown> = { last_checked_at: nowISO };

      if (!docStateRow) {
        // First time we have seen this job: full scan.
        update.needs_processing = true;
        update.scan_mode = 'full';
        flagged.push({ folder_name: job.folder_name || null, scan_mode: 'full' });
      } else {
        // Established job: delta only when something new showed up.
        const since = job.last_processed_at ?? job.last_checked_at ?? null;
        const { hasNew } = await jobHasNewMarketingItemsSince(job.job_id, since);
        if (hasNew) {
          update.needs_processing = true;
          update.scan_mode = 'delta';
          flagged.push({ folder_name: job.folder_name || null, scan_mode: 'delta' });
        }
        // If nothing is new, leave the existing needs_processing flag as is.

        // Blind-spot guard: catch videos that exist on the job but were never
        // recorded (e.g. skipped during the first build). These predate
        // last_processed_at so the "new items" check above will never see them.
        // We compare the job's current video ids against what we have recorded
        // in marketing_photo_assets (included OR excluded) plus doc_state, and
        // flag a delta if any video is still unaccounted for. Marking skipped
        // videos as excluded (the same pattern photos use) stops re-flagging.
        if (!update.needs_processing) {
          try {
            const videoIds = await getJobVideoFileIds(job.job_id);
            if (videoIds.length) {
              const { data: recorded } = await supabase
                .from('marketing_photo_assets')
                .select('jobtread_file_id')
                .eq('job_id', job.job_id)
                .eq('kind', 'video');
              const known = new Set(
                (recorded || [])
                  .map((r: any) => r.jobtread_file_id)
                  .filter(Boolean)
              );
              const dsVideos = (docStateRow?.content?.videos || []) as string[];
              for (const v of dsVideos) known.add(v);
              const unhandled = videoIds.filter((id) => !known.has(id));
              if (unhandled.length) {
                update.needs_processing = true;
                update.scan_mode = 'delta';
                flagged.push({ folder_name: job.folder_name || null, scan_mode: 'delta' });
              }
            }
          } catch (err: any) {
            console.error('[marketing-photo-detect] video-gap check failed:', job?.job_id, err?.message || err);
          }
        }
      }

      await supabase
        .from('marketing_photo_selected_jobs')
        .update(update)
        .eq('job_id', job.job_id);
    } catch (err: any) {
      console.error(
        '[marketing-photo-detect] job failed:',
        job?.job_id,
        err?.message || err
      );
      continue;
    }
  }

  return NextResponse.json({ checked, flagged });
}

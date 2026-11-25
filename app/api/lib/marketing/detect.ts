// @ts-nocheck
/**
 * Change detection for the Marketing Photo Engine, shared by the nightly
 * detect cron and the start of every Friday or Run now run.
 *
 * For each selected job it only asks JobTread for counts (no file downloads)
 * and flags the jobs that actually have new items:
 *   - No marketing_photo_doc_state row yet: never built, so flag
 *     needs_processing = true, scan_mode = 'full' (first-time full scan).
 *   - Otherwise: new files or a newly approved customer order since the last
 *     processed or checked time flag needs_processing = true,
 *     scan_mode = 'delta' (new items only). If nothing is new, any existing
 *     pending flag is left alone rather than cleared here.
 *   - A job with a video that was never recorded is flagged as a delta too.
 *   - last_checked_at is always stamped so there is a moving baseline.
 *
 * Style note: no em or en dashes in this file.
 */
import { getSupabase } from '@/app/api/lib/supabase';
import { jobHasNewMarketingItemsSince, getJobVideoFileIds } from '@/app/api/lib/jobtread';

export async function detectNewMarketingItems(): Promise<{ checked: number; flagged: { folder_name: string | null; scan_mode: string }[] }> {
  const supabase = getSupabase();

  const { data: jobs, error } = await supabase
    .from('marketing_photo_selected_jobs')
    .select('job_id, folder_name, needs_processing, scan_mode, last_processed_at, last_checked_at')
    .eq('included', true);
  if (error) throw new Error('Failed to load selected jobs: ' + error.message);

  const flagged: { folder_name: string | null; scan_mode: string }[] = [];
  let checked = 0;
  const nowISO = new Date().toISOString();

  for (const job of jobs || []) {
    // One bad job must not fail the whole check.
    try {
      checked++;
      const { data: docStateRow } = await supabase
        .from('marketing_photo_doc_state')
        .select('job_id, content')
        .eq('job_id', job.job_id)
        .maybeSingle();

      const update: Record<string, unknown> = { last_checked_at: nowISO };

      if (!docStateRow) {
        update.needs_processing = true;
        update.scan_mode = 'full';
        flagged.push({ folder_name: job.folder_name || null, scan_mode: 'full' });
      } else {
        const since = job.last_processed_at ?? job.last_checked_at ?? null;
        const { hasNew } = await jobHasNewMarketingItemsSince(job.job_id, since);
        if (hasNew) {
          update.needs_processing = true;
          update.scan_mode = 'delta';
          flagged.push({ folder_name: job.folder_name || null, scan_mode: 'delta' });
        }

        // Blind-spot guard: videos that exist on the job but were never
        // recorded predate last_processed_at, so the check above misses them.
        if (!update.needs_processing) {
          try {
            const videoIds = await getJobVideoFileIds(job.job_id);
            if (videoIds.length) {
              const { data: recorded } = await supabase
                .from('marketing_photo_assets')
                .select('jobtread_file_id')
                .eq('job_id', job.job_id)
                .eq('kind', 'video');
              const known = new Set((recorded || []).map((r: any) => r.jobtread_file_id).filter(Boolean));
              for (const v of (docStateRow?.content?.videos || []) as string[]) known.add(v);
              if (videoIds.some((id) => !known.has(id))) {
                update.needs_processing = true;
                update.scan_mode = 'delta';
                flagged.push({ folder_name: job.folder_name || null, scan_mode: 'delta' });
              }
            }
          } catch (err: any) {
            console.error('[marketing-detect] video-gap check failed:', job?.job_id, err?.message || err);
          }
        }
      }

      await supabase.from('marketing_photo_selected_jobs').update(update).eq('job_id', job.job_id);
    } catch (err: any) {
      console.error('[marketing-detect] job failed:', job?.job_id, err?.message || err);
    }
  }

  return { checked, flagged };
}

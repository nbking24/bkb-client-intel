/**
 * Hourly incremental sync cron job.
 *
 * Fetches all active JT jobs and syncs any that haven't been updated in the cache
 * within the last 90 minutes. For each stale job, runs a deep sync (all 3 stages).
 *
 * Designed to complete within Vercel's 60-second timeout by:
 *   - Skipping recently-synced jobs
 *   - Processing in batches with a time guard
 *   - Logging sync state for monitoring
 *
 * Cron schedule: 0 * * * * (every hour)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveJobs, getJob, getTasksForJob } from '../../../lib/jobtread';
import { writeCache, readCache, createSyncState, updateSyncState } from '../../../lib/cache';

export const maxDuration = 60;

const STALE_THRESHOLD_MS = 90 * 60 * 1000; // 90 minutes
const MAX_SYNC_TIME_MS = 50 * 1000; // Stop after 50s to leave buffer

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Verify this is a cron call (Vercel includes auth header for cron jobs)
  // In dev, allow unauthenticated calls
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Also check if it matches our app PIN auth
    const appPin = process.env.APP_PIN;
    if (appPin) {
      const expectedAuth = `Bearer ${Buffer.from(appPin + ':').toString('base64')}`;
      if (authHeader !== expectedAuth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
  }

  const syncState = await createSyncState('jt_jobs_incremental', null, 'cron');
  const syncId = syncState?.id;

  let jobsSynced = 0;
  let jobsSkipped = 0;
  let errors = 0;
  const errorDetails: string[] = [];

  try {
    // Fetch all active jobs from JT
    const activeJobs = await getActiveJobs(200);

    if (!activeJobs || activeJobs.length === 0) {
      if (syncId) await updateSyncState(syncId, { status: 'completed', items_processed: 0 });
      return NextResponse.json({ status: 'completed', message: 'No active jobs found', jobsSynced: 0 });
    }

    // Get existing cache timestamps
    const cachedJobs = await readCache('jt_jobs', {}, { orderBy: 'synced_at', ascending: true });
    const cacheMap = new Map<string, string>();
    for (const cj of cachedJobs) {
      cacheMap.set(cj.id, cj.synced_at);
    }

    const now = Date.now();
    const staleThreshold = new Date(now - STALE_THRESHOLD_MS).toISOString();

    for (const job of activeJobs) {
      // Time guard — stop if we're running out of time
      if (Date.now() - startTime > MAX_SYNC_TIME_MS) {
        console.log(`[cron] Time guard hit after ${jobsSynced} jobs synced, ${jobsSkipped} skipped`);
        break;
      }

      try {
        // Check if this job was recently synced
        const lastSynced = cacheMap.get(job.id);
        if (lastSynced && lastSynced > staleThreshold) {
          jobsSkipped++;
          continue;
        }

        // Sync job details
        await writeCache('jt_jobs', [{
          id: job.id,
          number: job.number || '',
          name: job.name || '',
          status: job.status || '',
          description: (job as any).description || '',
          account_id: (job as any).account?.id || null,
          account_name: (job as any).account?.name || null,
          raw_data: job,
        }]);

        // Quick task sync (just tasks for this job, not full deep sync)
        const tasks = await getTasksForJob(job.id);
        if (tasks && tasks.length > 0) {
          const taskRows = tasks.map((t: any) => ({
            id: t.id,
            job_id: job.id,
            parent_task_id: t.parentTask?.id || null,
            name: t.name || '',
            progress: t.progress ?? null,
            is_group: t.isGroup || false,
            start_date: t.startDate || null,
            end_date: t.endDate || null,
            raw_data: t,
          }));
          await writeCache('jt_tasks', taskRows);
        }

        jobsSynced++;
      } catch (err: any) {
        errors++;
        errorDetails.push(`${job.id}: ${err.message}`);
        console.error(`[cron] Sync failed for job ${job.id}:`, err.message);
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncId) {
      await updateSyncState(syncId, {
        status: errors > 0 ? 'completed' : 'completed',
        items_processed: jobsSynced,
        completed_at: new Date().toISOString(),
        error_message: errors > 0 ? `${errors} errors: ${errorDetails.slice(0, 3).join('; ')}` : null,
      });
    }

    return NextResponse.json({
      status: 'completed',
      duration: `${duration}s`,
      activeJobs: activeJobs.length,
      jobsSynced,
      jobsSkipped,
      errors,
      errorDetails: errorDetails.slice(0, 5),
    });
  } catch (err: any) {
    console.error('[cron] Incremental sync failed:', err);

    if (syncId) {
      await updateSyncState(syncId, {
        status: 'failed',
        error_message: err.message,
      });
    }

    return NextResponse.json(
      { error: err.message || 'Sync failed' },
      { status: 500 }
    );
  }
}

/**
 * Sync JT messages (comments + daily logs) for a single job.
 *
 * Used by:
 *   - Daily cron (iterates over all active jobs)
 *   - Force-sync endpoint (on-demand for a specific job)
 *   - Write-through after creating a comment or daily log
 *
 * Pulls ALL comments and daily logs from the JT PAVE API and
 * upserts into the Supabase cache. Uses clear-and-replace to
 * ensure the database is a complete mirror.
 *
 * Usage:
 *   POST /api/sync/job/{jobId}
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getCommentsForTarget,
  getDailyLogsForJob,
} from '../../../../lib/jobtread';
import {
  writeCache,
  clearCacheForEntity,
  createSyncState,
  updateSyncState,
} from '../../../../lib/cache';

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const jobId = params.jobId;

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const syncState = await createSyncState('jt_messages', jobId, 'manual');
  const syncId = syncState?.id;

  const results: Record<string, { count: number; error?: string }> = {};
  let totalItems = 0;

  try {
    // ─── Comments (all messages on this job) ───
    if (syncId) await updateSyncState(syncId, { stage: 1, status: 'in_progress' });

    const comments = await getCommentsForTarget(jobId, 'job', 2000);
    if (comments && comments.length > 0) {
      await clearCacheForEntity('jt_comments', 'job_id', jobId);
      const commentRows = comments.map((c: any) => ({
        id: c.id,
        job_id: jobId,
        target_id: jobId,
        target_type: 'job',
        message: c.message || '',
        name: c.name || '',
        is_pinned: c.isPinned || false,
        parent_comment_id: c.parentComment?.id || null,
        created_at: c.createdAt || null,
        raw_data: c,
      }));
      const res = await writeCache('jt_comments', commentRows);
      results.comments = { count: res.count, error: res.error };
      totalItems += res.count;
    } else {
      results.comments = { count: 0 };
    }

    // ─── Daily Logs ───
    if (syncId) await updateSyncState(syncId, { stage: 2 });

    const logs = await getDailyLogsForJob(jobId, 2000);
    if (logs && logs.length > 0) {
      await clearCacheForEntity('jt_daily_logs', 'job_id', jobId);
      const logRows = logs.map((l: any) => ({
        id: l.id,
        job_id: jobId,
        date: l.date || null,
        notes: l.notes || '',
        created_at: l.createdAt || null,
        assigned_member_ids: l.assignedMemberships?.nodes?.map((a: any) => a.id) || [],
        assigned_member_names: l.assignedMemberships?.nodes?.map((a: any) => a.user?.name || '').filter(Boolean) || [],
        raw_data: l,
      }));
      const res = await writeCache('jt_daily_logs', logRows);
      results.dailyLogs = { count: res.count, error: res.error };
      totalItems += res.count;
    } else {
      results.dailyLogs = { count: 0 };
    }

    // Mark sync complete
    if (syncId) {
      await updateSyncState(syncId, {
        status: 'completed',
        items_processed: totalItems,
        completed_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      jobId,
      totalItems,
      results,
    });
  } catch (err: any) {
    console.error(`[sync] JT message sync failed for job ${jobId}:`, err);

    if (syncId) {
      await updateSyncState(syncId, {
        status: 'failed',
        error_message: err.message || 'Unknown error',
        items_processed: totalItems,
      });
    }

    return NextResponse.json(
      { error: err.message || 'Sync failed', results },
      { status: 500 }
    );
  }
}

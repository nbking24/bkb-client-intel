/**
 * On-demand deep sync for a single JobTread job.
 *
 * Fetches ALL data (tasks, comments, daily logs, time entries, cost items, documents)
 * and upserts into the Supabase cache. Broken into 3 stages to stay under Vercel's
 * 60-second timeout. Each stage checkpoints progress in sync_state.
 *
 * Stage 1: Job details + tasks
 * Stage 2: Comments + daily logs
 * Stage 3: Time entries + cost items + documents
 *
 * Usage:
 *   POST /api/sync/job/{jobId}           → runs all stages sequentially
 *   POST /api/sync/job/{jobId}?stage=2   → runs only stage 2
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getJob,
  getTasksForJob,
  getCommentsForTarget,
  getDailyLogsForJob,
  getTimeEntriesForJob,
  getCostItemsForJob,
  getDocumentsForJob,
} from '../../../../lib/jobtread';
import {
  writeCache,
  clearCacheForEntity,
  createSyncState,
  updateSyncState,
} from '../../../../lib/cache';

export const maxDuration = 60; // Allow full 60s for Vercel Pro

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const jobId = params.jobId;
  const url = new URL(request.url);
  const requestedStage = parseInt(url.searchParams.get('stage') || '0');
  const runAll = requestedStage === 0; // If no stage specified, run all

  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }

  const syncState = await createSyncState('jt_job_deep', jobId, 'manual');
  const syncId = syncState?.id;

  const results: Record<string, { count: number; error?: string }> = {};
  let totalItems = 0;

  try {
    // ─── STAGE 1: Job details + Tasks ───
    if (runAll || requestedStage === 1) {
      if (syncId) await updateSyncState(syncId, { stage: 1, status: 'in_progress' });

      // Sync job details
      const job = await getJob(jobId);
      if (job) {
        await writeCache('jt_jobs', [{
          id: job.id,
          number: job.number || '',
          name: job.name || '',
          status: job.status || '',
          description: job.description || '',
          account_id: job.account?.id || null,
          account_name: job.account?.name || null,
          raw_data: job,
        }]);
        results.job = { count: 1 };
        totalItems += 1;
      }

      // Sync all tasks (no pagination limit from cache side)
      const tasks = await getTasksForJob(jobId);
      if (tasks && tasks.length > 0) {
        // Clear old cached tasks for this job, then write fresh
        await clearCacheForEntity('jt_tasks', 'job_id', jobId);
        const taskRows = tasks.map((t: any) => ({
          id: t.id,
          job_id: jobId,
          parent_task_id: t.parentTask?.id || null,
          name: t.name || '',
          description: t.description || '',
          progress: t.progress ?? null,
          is_group: t.isGroup || false,
          start_date: t.startDate || null,
          end_date: t.endDate || null,
          assigned_member_ids: t.assignedMemberships?.nodes?.map((a: any) => a.id) || [],
          assigned_member_names: t.assignedMemberships?.nodes?.map((a: any) => a.user?.name || '').filter(Boolean) || [],
          raw_data: t,
        }));
        const res = await writeCache('jt_tasks', taskRows);
        results.tasks = { count: res.count, error: res.error };
        totalItems += res.count;
      } else {
        results.tasks = { count: 0 };
      }
    }

    // ─── STAGE 2: Comments + Daily Logs ───
    if (runAll || requestedStage === 2) {
      if (syncId) await updateSyncState(syncId, { stage: 2 });

      // Sync all comments for this job
      const comments = await getCommentsForTarget(jobId, 'job', 1000);
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

      // Sync daily logs
      const logs = await getDailyLogsForJob(jobId, 1000);
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
    }

    // ─── STAGE 3: Time Entries + Cost Items + Documents ───
    if (runAll || requestedStage === 3) {
      if (syncId) await updateSyncState(syncId, { stage: 3 });

      // Sync time entries
      const timeEntries = await getTimeEntriesForJob(jobId, 500);
      if (timeEntries && timeEntries.length > 0) {
        await clearCacheForEntity('jt_time_entries', 'job_id', jobId);
        const teRows = timeEntries.map((e: any) => ({
          id: e.id,
          job_id: jobId,
          task_id: e.task?.id || null,
          started_at: e.startedAt || null,
          ended_at: e.endedAt || null,
          hours: e.startedAt && e.endedAt
            ? (new Date(e.endedAt).getTime() - new Date(e.startedAt).getTime()) / 3600000
            : null,
          member_id: e.membership?.id || null,
          member_name: e.user?.name || '',
          notes: e.notes || '',
          raw_data: e,
        }));
        const res = await writeCache('jt_time_entries', teRows);
        results.timeEntries = { count: res.count, error: res.error };
        totalItems += res.count;
      } else {
        results.timeEntries = { count: 0 };
      }

      // Sync cost items (Estimating only — document is null)
      const costItems = await getCostItemsForJob(jobId, 1000);
      const estimatingItems = (costItems || []).filter((i: any) => !i.document);
      if (estimatingItems.length > 0) {
        await clearCacheForEntity('jt_cost_items', 'job_id', jobId);
        const ciRows = estimatingItems.map((ci: any) => ({
          id: ci.id,
          job_id: jobId,
          cost_group_id: ci.costGroup?.id || null,
          cost_group_name: ci.costGroup?.name || '',
          name: ci.name || '',
          description: ci.description || '',
          quantity: ci.quantity ?? null,
          unit_cost: ci.unitCost ?? null,
          unit_price: ci.unitPrice ?? null,
          raw_data: ci,
        }));
        const res = await writeCache('jt_cost_items', ciRows);
        results.costItems = { count: res.count, error: res.error };
        totalItems += res.count;
      } else {
        results.costItems = { count: 0 };
      }

      // Sync documents
      const docs = await getDocumentsForJob(jobId);
      if (docs && docs.length > 0) {
        await clearCacheForEntity('jt_documents', 'job_id', jobId);
        const docRows = docs.map((d: any) => ({
          id: d.id,
          job_id: jobId,
          name: d.name || '',
          document_type: d.type || '',
          status: d.status || '',
          total_price: d.totalPrice ?? null,
          raw_data: d,
        }));
        const res = await writeCache('jt_documents', docRows);
        results.documents = { count: res.count, error: res.error };
        totalItems += res.count;
      } else {
        results.documents = { count: 0 };
      }
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
      stage: runAll ? 'all' : requestedStage,
      totalItems,
      results,
    });
  } catch (err: any) {
    console.error(`[sync] Deep sync failed for job ${jobId}:`, err);

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

/**
 * Backfill endpoint — loads ALL historical JT messages/daily logs
 * and GHL messages/notes into the database.
 *
 * Designed to run within Vercel's 60s timeout by processing a small
 * batch per call. Call repeatedly until "remaining" hits 0.
 *
 * Usage:
 *   POST /api/sync/backfill                      → auto-detect what needs syncing (default batch=3)
 *   POST /api/sync/backfill?source=jt&batch=5    → sync 5 JT jobs
 *   POST /api/sync/backfill?source=ghl&batch=3   → sync 3 GHL contacts
 *   GET  /api/sync/backfill                      → check progress without syncing
 *
 * The endpoint checks what's already in the DB and skips completed items.
 * Safe to call multiple times — it picks up where it left off.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabase';
import { getActiveJobs, getCommentsForTarget, getDailyLogsForJob } from '../../../lib/jobtread';
import { searchContacts, searchConversations, getAllConversationMessages, getContactNotes } from '../../../lib/ghl';
import { writeCache, clearCacheForEntity } from '../../../lib/cache';

export const maxDuration = 60;

const MAX_TIME_MS = 50 * 1000; // Leave 10s buffer

// ─── GET: Check backfill progress ───
export async function GET() {
  try {
    const supabase = createServerClient();

    // Count what's in the DB
    const { count: jtCommentJobs } = await supabase
      .from('jt_comments')
      .select('job_id', { count: 'exact', head: true });

    const { count: jtDailyLogJobs } = await supabase
      .from('jt_daily_logs')
      .select('job_id', { count: 'exact', head: true });

    const { count: ghlMsgCount } = await supabase
      .from('ghl_messages')
      .select('id', { count: 'exact', head: true });

    const { count: ghlNoteCount } = await supabase
      .from('ghl_notes')
      .select('id', { count: 'exact', head: true });

    // Get distinct synced job IDs
    const { data: syncedJobs } = await supabase
      .from('jt_comments')
      .select('job_id')
      .limit(5000);
    const syncedJobIds = new Set((syncedJobs || []).map((r: any) => r.job_id).filter(Boolean));

    // Get active jobs to compare
    let activeJobCount = 0;
    try {
      const activeJobs = await getActiveJobs(50);
      activeJobCount = activeJobs.length;
    } catch { /* ignore */ }

    return NextResponse.json({
      status: 'progress',
      jt: {
        commentRows: jtCommentJobs || 0,
        dailyLogRows: jtDailyLogJobs || 0,
        jobsSynced: syncedJobIds.size,
        activeJobs: activeJobCount,
        remaining: Math.max(0, activeJobCount - syncedJobIds.size),
      },
      ghl: {
        messageRows: ghlMsgCount || 0,
        noteRows: ghlNoteCount || 0,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── POST: Run a batch of backfill ───
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const url = new URL(request.url);
  const source = url.searchParams.get('source'); // 'jt', 'ghl', or null (both)
  const batchSize = parseInt(url.searchParams.get('batch') || '3');

  const results: Record<string, any> = {};

  try {
    // ─── JT BACKFILL ───
    if (!source || source === 'jt') {
      const jtResult = await backfillJT(batchSize, startTime);
      results.jt = jtResult;
    }

    // ─── GHL BACKFILL ───
    if ((!source || source === 'ghl') && (Date.now() - startTime < MAX_TIME_MS)) {
      const ghlResult = await backfillGHL(batchSize, startTime);
      results.ghl = ghlResult;
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    return NextResponse.json({
      success: true,
      duration: `${duration}s`,
      results,
      hint: results.jt?.remaining > 0 || results.ghl?.remaining > 0
        ? 'Call this endpoint again to continue the backfill.'
        : 'Backfill complete! All data is synced.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, results }, { status: 500 });
  }
}

// ─── JT Backfill Logic ───
async function backfillJT(batchSize: number, startTime: number) {
  const supabase = createServerClient();

  // Get all active jobs
  const activeJobs = await getActiveJobs(50);

  // Find which jobs already have comments synced
  // Use high limit to ensure we capture all distinct job_ids
  const { data: syncedRows } = await supabase
    .from('jt_comments')
    .select('job_id')
    .limit(5000);

  const syncedJobIds = new Set((syncedRows || []).map((r: any) => r.job_id).filter(Boolean));

  // Find jobs that still need syncing
  const pendingJobs = activeJobs.filter((j) => !syncedJobIds.has(j.id));

  // Process a batch
  const batch = pendingJobs.slice(0, batchSize);
  let jobsSynced = 0;
  let totalComments = 0;
  let totalDailyLogs = 0;
  const errors: string[] = [];

  for (const job of batch) {
    if (Date.now() - startTime > MAX_TIME_MS) break;

    try {
      // Sync comments
      const comments = await getCommentsForTarget(job.id, 'job', 2000);
      if (comments && comments.length > 0) {
        await clearCacheForEntity('jt_comments', 'job_id', job.id);
        const rows = comments.map((c: any) => ({
          id: c.id,
          job_id: job.id,
          target_id: job.id,
          target_type: 'job',
          message: c.message || '',
          name: c.name || '',
          is_pinned: c.isPinned || false,
          parent_comment_id: c.parentComment?.id || null,
          created_at: c.createdAt || null,
          raw_data: c,
        }));
        const res = await writeCache('jt_comments', rows);
        totalComments += res.count;
      } else {
        // Write a placeholder so we know this job has been processed
        // (even if it has no comments)
        await writeCache('jt_comments', [{
          id: `placeholder_${job.id}`,
          job_id: job.id,
          target_id: job.id,
          target_type: 'job',
          message: '',
          name: 'system',
          created_at: new Date().toISOString(),
          raw_data: { _placeholder: true },
        }]);
      }

      // Sync daily logs
      const logs = await getDailyLogsForJob(job.id, 2000);
      if (logs && logs.length > 0) {
        await clearCacheForEntity('jt_daily_logs', 'job_id', job.id);
        const rows = logs.map((l: any) => ({
          id: l.id,
          job_id: job.id,
          date: l.date || null,
          notes: l.notes || '',
          created_at: l.createdAt || null,
          assigned_member_ids: l.assignedMemberships?.nodes?.map((a: any) => a.id) || [],
          assigned_member_names: l.assignedMemberships?.nodes?.map((a: any) => a.user?.name || '').filter(Boolean) || [],
          raw_data: l,
        }));
        const res = await writeCache('jt_daily_logs', rows);
        totalDailyLogs += res.count;
      }

      jobsSynced++;
    } catch (err: any) {
      errors.push(`${job.id} (${job.name}): ${err.message}`);
    }
  }

  return {
    activeJobs: activeJobs.length,
    alreadySynced: syncedJobIds.size,
    syncedThisBatch: jobsSynced,
    remaining: pendingJobs.length - jobsSynced,
    totalComments,
    totalDailyLogs,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ─── GHL Backfill Logic ───
async function backfillGHL(batchSize: number, startTime: number) {
  const supabase = createServerClient();

  // Get contacts
  const contacts = await searchContacts('', 100);

  // Find which contacts already have messages synced
  const { data: syncedRows } = await supabase
    .from('ghl_messages')
    .select('contact_id')
    .limit(5000);

  const syncedContactIds = new Set((syncedRows || []).map((r: any) => r.contact_id).filter(Boolean));

  // Find contacts that still need syncing
  const pendingContacts = contacts.filter((c: any) => !syncedContactIds.has(c.id));

  // Process a batch
  const batch = pendingContacts.slice(0, batchSize);
  let contactsSynced = 0;
  let totalMessages = 0;
  let totalNotes = 0;
  const errors: string[] = [];

  for (const contact of batch) {
    if (Date.now() - startTime > MAX_TIME_MS) break;

    try {
      // Sync messages from all conversations
      const conversations = await searchConversations(contact.id);
      await clearCacheForEntity('ghl_messages', 'contact_id', contact.id);

      let contactMsgs = 0;
      for (const convo of conversations) {
        try {
          const messages = await getAllConversationMessages(convo.id);
          if (messages && messages.length > 0) {
            const rows = messages.map((m: any) => ({
              id: m.id,
              conversation_id: convo.id,
              contact_id: contact.id,
              type: m.type || m.messageType || '',
              direction: m.direction || '',
              body: m.body || m.message || '',
              subject: m.subject || '',
              date_added: m.dateAdded || m.createdAt || null,
              raw_data: m,
            }));
            const res = await writeCache('ghl_messages', rows);
            contactMsgs += res.count;
          }
        } catch (err: any) {
          // Skip individual conversation errors
          console.warn(`[backfill] GHL convo ${convo.id} failed:`, err.message);
        }
      }

      // If no messages, write a placeholder
      if (contactMsgs === 0) {
        await writeCache('ghl_messages', [{
          id: `placeholder_${contact.id}`,
          conversation_id: 'none',
          contact_id: contact.id,
          type: 'placeholder',
          direction: '',
          body: '',
          date_added: new Date().toISOString(),
          raw_data: { _placeholder: true },
        }]);
      }
      totalMessages += contactMsgs;

      // Sync notes
      const notes = await getContactNotes(contact.id);
      if (notes && notes.length > 0) {
        await clearCacheForEntity('ghl_notes', 'contact_id', contact.id);
        const rows = notes.map((n: any) => ({
          id: n.id,
          contact_id: contact.id,
          body: n.body || '',
          created_by: n.createdBy || '',
          date_added: n.dateAdded || n.createdAt || null,
          raw_data: n,
        }));
        const res = await writeCache('ghl_notes', rows);
        totalNotes += res.count;
      }

      contactsSynced++;
    } catch (err: any) {
      errors.push(`${contact.id} (${contact.name}): ${err.message}`);
    }
  }

  return {
    totalContacts: contacts.length,
    alreadySynced: syncedContactIds.size,
    syncedThisBatch: contactsSynced,
    remaining: pendingContacts.length - contactsSynced,
    totalMessages,
    totalNotes,
    errors: errors.length > 0 ? errors : undefined,
  };
}

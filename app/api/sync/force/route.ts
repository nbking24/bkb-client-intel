/**
 * Force-sync endpoint — triggers a full sync of all JT messages
 * and GHL messages/notes on demand.
 *
 * Useful when you need data caught up during the day without
 * waiting for the daily cron.
 *
 * Usage:
 *   POST /api/sync/force                → sync all active JT jobs + GHL contacts
 *   POST /api/sync/force?source=jt      → sync only JT messages
 *   POST /api/sync/force?source=ghl     → sync only GHL messages/notes
 *   POST /api/sync/force?jobId=xxx      → sync a single JT job
 *   POST /api/sync/force?contactId=xxx  → sync a single GHL contact
 *
 * Auth: APP_PIN via Basic Auth or CRON_SECRET via Bearer token
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveJobs, getCommentsForTarget, getDailyLogsForJob } from '../../../lib/jobtread';
import { searchContacts, searchConversations, getAllConversationMessages, getContactNotes } from '../../../lib/ghl';
import { writeCache, clearCacheForEntity, createSyncState, updateSyncState } from '../../../lib/cache';

export const maxDuration = 60;

const MAX_SYNC_TIME_MS = 55 * 1000; // Stop at 55s to leave buffer

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const url = new URL(request.url);
  const source = url.searchParams.get('source'); // 'jt', 'ghl', or null (both)
  const singleJobId = url.searchParams.get('jobId');
  const singleContactId = url.searchParams.get('contactId');

  const syncState = await createSyncState('force_sync', source || 'all', 'manual');
  const syncId = syncState?.id;

  const summary: Record<string, any> = {};
  let totalItems = 0;

  try {
    // ─── JT MESSAGES SYNC ───
    if (!source || source === 'jt') {
      const jtResults: Record<string, { comments: number; dailyLogs: number }> = {};

      if (singleJobId) {
        // Sync a single job
        const r = await syncJTJob(singleJobId);
        jtResults[singleJobId] = r;
        totalItems += r.comments + r.dailyLogs;
      } else {
        // Sync all active jobs
        const activeJobs = await getActiveJobs(200);
        for (const job of activeJobs) {
          if (Date.now() - startTime > MAX_SYNC_TIME_MS) {
            summary.jtTimedOut = true;
            break;
          }
          try {
            const r = await syncJTJob(job.id);
            jtResults[job.id] = r;
            totalItems += r.comments + r.dailyLogs;
          } catch (err: any) {
            jtResults[job.id] = { comments: -1, dailyLogs: -1 };
            console.warn(`[force-sync] JT job ${job.id} failed:`, err.message);
          }
        }
      }
      summary.jt = { jobsSynced: Object.keys(jtResults).length, details: jtResults };
    }

    // ─── GHL MESSAGES & NOTES SYNC ───
    if ((!source || source === 'ghl') && (Date.now() - startTime < MAX_SYNC_TIME_MS)) {
      const ghlResults: Record<string, { messages: number; notes: number }> = {};

      if (singleContactId) {
        const r = await syncGHLContact(singleContactId);
        ghlResults[singleContactId] = r;
        totalItems += r.messages + r.notes;
      } else {
        // Sync contacts that have conversations — search broadly
        // GHL doesn't have a "list all contacts" — we get them from opportunities/recent activity
        // For now, sync contacts we already have in the cache or from recent search
        const contacts = await searchContacts('', 100); // Get recent contacts
        for (const contact of contacts) {
          if (Date.now() - startTime > MAX_SYNC_TIME_MS) {
            summary.ghlTimedOut = true;
            break;
          }
          try {
            const r = await syncGHLContact(contact.id);
            ghlResults[contact.id] = r;
            totalItems += r.messages + r.notes;
          } catch (err: any) {
            ghlResults[contact.id] = { messages: -1, notes: -1 };
            console.warn(`[force-sync] GHL contact ${contact.id} failed:`, err.message);
          }
        }
      }
      summary.ghl = { contactsSynced: Object.keys(ghlResults).length, details: ghlResults };
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncId) {
      await updateSyncState(syncId, {
        status: 'completed',
        items_processed: totalItems,
        completed_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      duration: `${duration}s`,
      totalItems,
      summary,
    });
  } catch (err: any) {
    console.error('[force-sync] Failed:', err);

    if (syncId) {
      await updateSyncState(syncId, {
        status: 'failed',
        error_message: err.message,
        items_processed: totalItems,
      });
    }

    return NextResponse.json(
      { error: err.message || 'Force sync failed', summary },
      { status: 500 }
    );
  }
}

// ─── Helpers ───

async function syncJTJob(jobId: string): Promise<{ comments: number; dailyLogs: number }> {
  let comments = 0;
  let dailyLogs = 0;

  const commentData = await getCommentsForTarget(jobId, 'job', 2000);
  if (commentData && commentData.length > 0) {
    await clearCacheForEntity('jt_comments', 'job_id', jobId);
    const rows = commentData.map((c: any) => ({
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
    const res = await writeCache('jt_comments', rows);
    comments = res.count;
  }

  const logData = await getDailyLogsForJob(jobId, 2000);
  if (logData && logData.length > 0) {
    await clearCacheForEntity('jt_daily_logs', 'job_id', jobId);
    const rows = logData.map((l: any) => ({
      id: l.id,
      job_id: jobId,
      date: l.date || null,
      notes: l.notes || '',
      created_at: l.createdAt || null,
      assigned_member_ids: l.assignedMemberships?.nodes?.map((a: any) => a.id) || [],
      assigned_member_names: l.assignedMemberships?.nodes?.map((a: any) => a.user?.name || '').filter(Boolean) || [],
      raw_data: l,
    }));
    const res = await writeCache('jt_daily_logs', rows);
    dailyLogs = res.count;
  }

  return { comments, dailyLogs };
}

async function syncGHLContact(contactId: string): Promise<{ messages: number; notes: number }> {
  let messages = 0;
  let notes = 0;

  // Sync messages from all conversations
  const conversations = await searchConversations(contactId);
  await clearCacheForEntity('ghl_messages', 'contact_id', contactId);

  for (const convo of conversations) {
    try {
      const msgData = await getAllConversationMessages(convo.id);
      if (msgData && msgData.length > 0) {
        const rows = msgData.map((m: any) => ({
          id: m.id,
          conversation_id: convo.id,
          contact_id: contactId,
          type: m.type || m.messageType || '',
          direction: m.direction || '',
          body: m.body || m.message || '',
          subject: m.subject || '',
          date_added: m.dateAdded || m.createdAt || null,
          raw_data: m,
        }));
        const res = await writeCache('ghl_messages', rows);
        messages += res.count;
      }
    } catch (err: any) {
      console.warn(`[force-sync] GHL convo ${convo.id} failed:`, err.message);
    }
  }

  // Sync notes
  const noteData = await getContactNotes(contactId);
  if (noteData && noteData.length > 0) {
    await clearCacheForEntity('ghl_notes', 'contact_id', contactId);
    const rows = noteData.map((n: any) => ({
      id: n.id,
      contact_id: contactId,
      body: n.body || '',
      created_by: n.createdBy || '',
      date_added: n.dateAdded || n.createdAt || null,
      raw_data: n,
    }));
    const res = await writeCache('ghl_notes', rows);
    notes = res.count;
  }

  return { messages, notes };
}

/**
 * Daily sync cron — syncs JT messages (comments + daily logs) for all active jobs
 * and GHL messages + notes for known contacts.
 *
 * Runs once per day at 5 AM (before the workday).
 * Only syncs message/note data that exceeds API pagination limits.
 * All other data (jobs, tasks, cost items, etc.) is read live from APIs.
 *
 * Cron schedule: 0 5 * * * (5 AM daily)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveJobs, getCommentsForTarget, getDailyLogsForJob } from '../../../lib/jobtread';
import { searchContacts, searchConversations, getAllConversationMessages, getContactNotes } from '../../../lib/ghl';
import { writeCache, clearCacheForEntity, createSyncState, updateSyncState } from '../../../lib/cache';

export const maxDuration = 60;

const MAX_SYNC_TIME_MS = 50 * 1000; // Stop after 50s to leave buffer

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Verify authorization
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    const appPin = process.env.APP_PIN;
    if (appPin) {
      const expectedAuth = `Bearer ${Buffer.from(appPin + ':').toString('base64')}`;
      if (authHeader !== expectedAuth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
  }

  const syncState = await createSyncState('daily_sync', null, 'cron');
  const syncId = syncState?.id;

  let jtJobsSynced = 0;
  let ghlContactsSynced = 0;
  let totalItems = 0;
  let errors = 0;
  const errorDetails: string[] = [];

  try {
    // ─── PHASE 1: JT Messages (comments + daily logs) ───
    const activeJobs = await getActiveJobs(100);

    for (const job of activeJobs) {
      if (Date.now() - startTime > MAX_SYNC_TIME_MS) break;

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
          totalItems += res.count;
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
          totalItems += res.count;
        }

        jtJobsSynced++;
      } catch (err: any) {
        errors++;
        errorDetails.push(`JT ${job.id}: ${err.message}`);
      }
    }

    // ─── PHASE 2: GHL Messages + Notes ───
    if (Date.now() - startTime < MAX_SYNC_TIME_MS) {
      try {
        const contacts = await searchContacts('', 100);

        for (const contact of contacts) {
          if (Date.now() - startTime > MAX_SYNC_TIME_MS) break;

          try {
            // Sync messages from all conversations
            const conversations = await searchConversations(contact.id);
            await clearCacheForEntity('ghl_messages', 'contact_id', contact.id);

            for (const convo of conversations) {
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
                totalItems += res.count;
              }
            }

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
              totalItems += res.count;
            }

            ghlContactsSynced++;
          } catch (err: any) {
            errors++;
            errorDetails.push(`GHL ${contact.id}: ${err.message}`);
          }
        }
      } catch (err: any) {
        errors++;
        errorDetails.push(`GHL contacts fetch: ${err.message}`);
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncId) {
      await updateSyncState(syncId, {
        status: 'completed',
        items_processed: totalItems,
        completed_at: new Date().toISOString(),
        error_message: errors > 0 ? `${errors} errors: ${errorDetails.slice(0, 3).join('; ')}` : null,
      });
    }

    return NextResponse.json({
      status: 'completed',
      duration: `${duration}s`,
      jtJobsSynced,
      ghlContactsSynced,
      totalItems,
      errors,
      errorDetails: errorDetails.slice(0, 5),
    });
  } catch (err: any) {
    console.error('[cron] Daily sync failed:', err);

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

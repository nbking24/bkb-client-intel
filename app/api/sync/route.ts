// @ts-nocheck
/**
 * /api/sync â Sync GHL + JobTread data into Supabase
 *
 * POST /api/sync
 * Body: { contactId: string, force?: boolean }
 *
 * Pulls all data for a contact from GHL (profile, notes, conversations,
 * messages, tasks, opportunities) and JobTread (active jobs), then
 * upserts everything into Supabase.
 *
 * Skips sync if data was synced within the last 5 minutes (unless force=true).
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getContact,
  getContactNotes,
  searchConversations,
  getConversationMessages,
  getContactTasks,
  getContactOpportunities,
  getMessageById,
  getEmailById,
} from '../lib/ghl';
import { getActiveJobs } from '../lib/jobtread';
import {
  upsertContact,
  upsertOpportunity,
  upsertConversation,
  upsertMessage,
  upsertNote,
  upsertTask,
  upsertJTJob,
  createSyncLog,
  completeSyncLog,
  getLastSyncTime,
} from '../lib/supabase';

const SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contactId, force } = body;

    if (!contactId) {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
    }

    // Check cooldown (skip if forced)
    if (!force) {
      const lastSync = await getLastSyncTime('contact_full', contactId);
      if (lastSync) {
        const elapsed = Date.now() - new Date(lastSync).getTime();
        if (elapsed < SYNC_COOLDOWN_MS) {
          return NextResponse.json({
            status: 'skipped',
            message: 'Synced recently (' + Math.round(elapsed / 1000) + 's ago). Use force=true to override.',
            lastSync,
          });
        }
      }
    }

    const logId = await createSyncLog('contact_full', contactId);
    let totalRecords = 0;
    const errors: string[] = [];

    // 1. SYNC CONTACT PROFILE
    try {
      const profile = await getContact(contactId);
      await upsertContact(profile);
      totalRecords++;
    } catch (err) {
      errors.push('Contact profile: ' + (err instanceof Error ? err.message : 'failed'));
    }

    // 2. SYNC NOTES
    try {
      const notes = await getContactNotes(contactId);
      if (Array.isArray(notes)) {
        for (const note of notes) {
          try {
            await upsertNote(note, contactId);
            totalRecords++;
          } catch (e) { /* skip individual note errors */ }
        }
      }
    } catch (err) {
      errors.push('Notes: ' + (err instanceof Error ? err.message : 'failed'));
    }

    // 3. SYNC TASKS
    try {
      const tasks = await getContactTasks(contactId);
      if (Array.isArray(tasks)) {
        for (const task of tasks) {
          try {
            await upsertTask(task, contactId);
            totalRecords++;
          } catch (e) { /* skip */ }
        }
      }
    } catch (err) {
      errors.push('Tasks: ' + (err instanceof Error ? err.message : 'failed'));
    }

    // 4. SYNC OPPORTUNITIES
    try {
      const opps = await getContactOpportunities(contactId);
      if (Array.isArray(opps)) {
        for (const opp of opps) {
          try {
            await upsertOpportunity(opp);
            totalRecords++;
          } catch (e) { /* skip */ }
        }
      }
    } catch (err) {
      errors.push('Opportunities: ' + (err instanceof Error ? err.message : 'failed'));
    }

    // 5. SYNC CONVERSATIONS + MESSAGES (most expensive â handles email bodies)
    try {
      const convos = await searchConversations(contactId);
      if (Array.isArray(convos)) {
        let emailFetches = 0;
        const MAX_EMAIL_FETCHES = 15;

        for (const conv of convos) {
          try {
            await upsertConversation(conv);
            totalRecords++;

            // Fetch messages for this conversation
            const msgs = await getConversationMessages(conv.id, 50);
            if (Array.isArray(msgs)) {
              for (const msg of msgs) {
                let body = msg.body || msg.text || msg.message || '';

                // For emails, try to fetch full body
                if (!body && msg.messageType === 'TYPE_EMAIL' && emailFetches < MAX_EMAIL_FETCHES) {
                  emailFetches++;
                  try {
                    const fullMsg = await getMessageById(msg.id);
                    const msgData = fullMsg.message || fullMsg;
                    body = msgData.body || msgData.text || msgData.html || '';
                    if (body && (msgData.contentType === 'text/html' || body.startsWith('<'))) {
                      body = stripHtml(body);
                    }
                  } catch { /* Strategy 1 failed */ }

                  if (!body && msg.meta?.email?.messageIds?.length > 0) {
                    try {
                      const emailData = await getEmailById(msg.meta.email.messageIds[0]);
                      const email = emailData.email || emailData;
                      body = email.body || email.text || email.html || email.textBody || email.htmlBody || '';
                      if (body && body.startsWith('<')) body = stripHtml(body);
                    } catch { /* Strategy 2 failed */ }
                  }
                }

                if (!body && msg.id === msgs[0]?.id && conv.lastMessageBody) {
                  body = conv.lastMessageBody;
                }

                const msgWithBody = { ...msg, body: body || msg.body };
                try {
                  await upsertMessage(msgWithBody, contactId);
                  totalRecords++;
                } catch (e) { /* skip */ }
              }
            }
          } catch (e) {
            errors.push('Conversation ' + conv.id + ': ' + (e instanceof Error ? e.message : 'failed'));
          }

          // Small delay between conversations to avoid GHL rate limits
          await new Promise(r => setTimeout(r, 200));
        }
      }
    } catch (err) {
      errors.push('Conversations: ' + (err instanceof Error ? err.message : 'failed'));
    }

    // 6. SYNC JOBTREAD JOBS
    try {
      const jobs = await getActiveJobs(50);
      if (Array.isArray(jobs)) {
        for (const job of jobs) {
          try {
            await upsertJTJob(job);
            totalRecords++;
          } catch (e) { /* skip */ }
        }
      }
    } catch (err) {
      errors.push('JT Jobs: ' + (err instanceof Error ? err.message : 'failed'));
    }

    // Complete sync log
    const errorMsg = errors.length > 0 ? errors.join('; ') : undefined;
    await completeSyncLog(logId, totalRecords, errorMsg);

    return NextResponse.json({
      status: errors.length > 0 ? 'partial' : 'completed',
      recordsSynced: totalRecords,
      errors: errors.length > 0 ? errors : undefined,
      logId,
    });

  } catch (err) {
    console.error('Sync error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 }
    );
  }
}

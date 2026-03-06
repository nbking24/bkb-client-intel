/**
 * Sync GHL messages & notes for a single contact.
 *
 * Pulls ALL conversation messages and contact notes from the GHL API
 * and upserts into Supabase. Uses clear-and-replace per contact.
 *
 * Usage:
 *   POST /api/sync/ghl/{contactId}
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  searchConversations,
  getAllConversationMessages,
  getContactNotes,
} from '../../../../lib/ghl';
import {
  writeCache,
  clearCacheForEntity,
  createSyncState,
  updateSyncState,
} from '../../../../lib/cache';

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: { contactId: string } }
) {
  const contactId = params.contactId;

  if (!contactId) {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
  }

  const syncState = await createSyncState('ghl_messages', contactId, 'manual');
  const syncId = syncState?.id;

  const results: Record<string, { count: number; error?: string }> = {};
  let totalItems = 0;

  try {
    // ─── Messages (all conversations for this contact) ───
    if (syncId) await updateSyncState(syncId, { stage: 1, status: 'in_progress' });

    const conversations = await searchConversations(contactId);

    // Clear existing messages for this contact before re-populating
    await clearCacheForEntity('ghl_messages', 'contact_id', contactId);

    let totalMsgs = 0;
    for (const convo of conversations) {
      try {
        const messages = await getAllConversationMessages(convo.id);
        if (messages && messages.length > 0) {
          const msgRows = messages.map((m: any) => ({
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
          const res = await writeCache('ghl_messages', msgRows);
          totalMsgs += res.count;
        }
      } catch (err: any) {
        console.warn(`[sync] Failed to sync conversation ${convo.id}:`, err.message);
      }
    }
    results.messages = { count: totalMsgs };
    totalItems += totalMsgs;

    // ─── Notes ───
    if (syncId) await updateSyncState(syncId, { stage: 2 });

    const notes = await getContactNotes(contactId);
    if (notes && notes.length > 0) {
      await clearCacheForEntity('ghl_notes', 'contact_id', contactId);
      const noteRows = notes.map((n: any) => ({
        id: n.id,
        contact_id: contactId,
        body: n.body || '',
        created_by: n.createdBy || '',
        date_added: n.dateAdded || n.createdAt || null,
        raw_data: n,
      }));
      const res = await writeCache('ghl_notes', noteRows);
      results.notes = { count: res.count, error: res.error };
      totalItems += res.count;
    } else {
      results.notes = { count: 0 };
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
      contactId,
      totalItems,
      results,
    });
  } catch (err: any) {
    console.error(`[sync] GHL sync failed for contact ${contactId}:`, err);

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

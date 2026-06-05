// @ts-nocheck
/**
 * Lead SMS conversation endpoint for the Leads dashboard.
 *
 * GET  /api/dashboard/lead-conversation?contactId=xxx
 *   Returns the contact's SMS thread from Loop/GHL, oldest first:
 *   { conversationId, messages: [{ id, direction, body, dateAdded, status, type }] }
 *
 * POST /api/dashboard/lead-conversation
 *   Body: { contactId: string, message: string }
 *   Sends an SMS to the contact through Loop (uses the location's SMS
 *   number, lands in the Loop conversation like any other outbound text).
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchConversations, getConversationMessages, sendSMS, getContact } from '@/app/lib/ghl';

// SMS-ish message types we show in the thread. GHL uses TYPE_SMS for
// both directions; some accounts also emit TYPE_NO_SHOW etc. which we skip.
const SMS_TYPES = new Set(['TYPE_SMS', 'SMS']);

export async function GET(req: NextRequest) {
  try {
    const contactId = req.nextUrl.searchParams.get('contactId');
    if (!contactId) {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
    }

    const conversations = await searchConversations(contactId);
    if (!conversations.length) {
      return NextResponse.json({ conversationId: null, messages: [] });
    }

    // A contact normally has a single conversation per channel group;
    // grab messages from all of them and merge so nothing is missed.
    const all: any[] = [];
    let primaryId: string | null = null;
    for (const conv of conversations.slice(0, 3)) {
      try {
        const msgs = await getConversationMessages(conv.id, 100);
        if (!primaryId && msgs.length) primaryId = conv.id;
        for (const m of msgs) all.push({ ...m, conversationId: conv.id });
      } catch (e: any) {
        console.warn('[lead-conversation] messages fetch failed:', e.message);
      }
    }

    const messages = all
      .filter((m) => SMS_TYPES.has(m.messageType || m.type))
      .map((m) => ({
        id: m.id,
        direction: m.direction || 'outbound',
        body: m.body || '',
        dateAdded: m.dateAdded,
        status: m.status || '',
        type: 'SMS',
      }))
      .sort((a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());

    return NextResponse.json({ conversationId: primaryId || conversations[0].id, messages });
  } catch (err: any) {
    console.error('[lead-conversation] GET failed:', err.message);
    return NextResponse.json({ error: err.message || 'Failed to load conversation' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { contactId, message } = await req.json();
    if (!contactId || !message?.trim()) {
      return NextResponse.json({ error: 'contactId and message are required' }, { status: 400 });
    }
    if (message.length > 1600) {
      return NextResponse.json({ error: 'Message too long (1600 char max)' }, { status: 400 });
    }

    // Guard: don't attempt to text contacts with no phone or DND enabled.
    const contactRes = await getContact(contactId).catch(() => null);
    const contact = contactRes?.contact || contactRes;
    if (contact && !contact.phone) {
      return NextResponse.json({ error: 'Contact has no phone number on file' }, { status: 422 });
    }
    if (contact?.dnd === true) {
      return NextResponse.json({ error: 'Contact has Do Not Disturb enabled in Loop' }, { status: 422 });
    }

    const result = await sendSMS(contactId, message.trim());
    return NextResponse.json({
      ok: true,
      messageId: result?.messageId || result?.id || null,
      conversationId: result?.conversationId || null,
    });
  } catch (err: any) {
    console.error('[lead-conversation] POST failed:', err.message);
    // Surface scope problems clearly so we know to fix the Private Integration scopes in Loop
    const hint = /401|403/.test(err.message)
      ? ' (the Loop API token may be missing the conversations/message write scope)'
      : '';
    return NextResponse.json({ error: (err.message || 'Failed to send') + hint }, { status: 500 });
  }
}

// @ts-nocheck
/**
 * Inbound message alerts cron.
 *
 * Every 10 minutes, checks Loop/GHL for conversations whose most recent
 * message is an inbound SMS or email from a lead/client, and emails an
 * alert to Terri (and any other configured recipients). Dedupe state
 * lives in the lead_message_alert_state table so each inbound message
 * is alerted exactly once.
 *
 * Recipients: LEAD_ALERT_EMAILS (comma separated) if set, otherwise
 * TICKET_NOTIFY_TERRI.
 *
 * Cron schedule: every 10 minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchRecentConversations } from '@/app/lib/ghl';
import { sendEmail } from '@/app/api/lib/email';
import { getSupabase } from '@/app/api/lib/supabase';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const LOOP_LOCATION = () => process.env.GHL_LOCATION_ID || '';
const LOOP_BASE = 'https://loop.thebuildersboard.com';

// Only alert on messages from the last 24h. Prevents a flood of stale
// alerts on first deploy or after the cron has been paused.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const INBOUND_TYPES = new Set(['TYPE_SMS', 'SMS', 'TYPE_EMAIL', 'EMAIL']);

function channelLabel(t: string) {
  if (!t) return 'Message';
  return /EMAIL/i.test(t) ? 'Email' : 'Text message';
}

function escapeHtml(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function GET(request: NextRequest) {
  // Same auth pattern as the other crons
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

  const recipients = (process.env.LEAD_ALERT_EMAILS || process.env.TICKET_NOTIFY_TERRI || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!recipients.length) {
    return NextResponse.json({ ok: false, error: 'No alert recipients configured (set LEAD_ALERT_EMAILS or TICKET_NOTIFY_TERRI)' });
  }

  const supabase = getSupabase();
  let checked = 0;
  let alerted = 0;
  const errors: string[] = [];

  try {
    const conversations = await searchRecentConversations(50);
    const now = Date.now();

    for (const conv of conversations) {
      checked++;
      const lastDate = conv.lastMessageDate ? new Date(conv.lastMessageDate).getTime() : 0;
      if (!lastDate || now - lastDate > MAX_AGE_MS) continue;

      const type = conv.lastMessageType || '';
      if (!INBOUND_TYPES.has(type)) continue;

      // Direction: trust lastMessageDirection when present; otherwise fall
      // back to unreadCount > 0 (unread conversations mean an inbound
      // message nobody has opened in Loop yet).
      const direction = (conv.lastMessageDirection || '').toLowerCase();
      const isInbound = direction === 'inbound' || (!direction && (conv.unreadCount || 0) > 0);
      if (!isInbound) continue;

      // Dedupe check
      const { data: state } = await supabase
        .from('lead_message_alert_state')
        .select('last_alerted_message_date')
        .eq('conversation_id', conv.id)
        .maybeSingle();
      if (state && new Date(state.last_alerted_message_date).getTime() >= lastDate) continue;

      const name = conv.fullName || conv.contactName || conv.email || conv.phone || 'Unknown contact';
      const channel = channelLabel(type);
      const preview = (conv.lastMessageBody || '').slice(0, 400);
      const loopLink = `${LOOP_BASE}/v2/location/${LOOP_LOCATION()}/conversations/conversations/${conv.id}`;

      const res = await sendEmail({
        to: recipients,
        subject: `New ${channel.toLowerCase()} from ${name}`,
        html: `
          <div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">
            <p><strong>${escapeHtml(name)}</strong> sent a new ${channel.toLowerCase()} through Loop.</p>
            ${preview ? `<blockquote style="margin:12px 0;padding:10px 14px;background:#f5f3f0;border-left:3px solid #c88c00;white-space:pre-wrap">${escapeHtml(preview)}</blockquote>` : ''}
            <p>
              <a href="${loopLink}" style="color:#1d4ed8">Open the conversation in Loop</a><br/>
              <a href="https://bkb-client-intel.vercel.app/dashboard/leads" style="color:#1d4ed8">Open the Leads dashboard</a>
            </p>
            <p style="color:#888;font-size:12px">BKB Hub automatic alert. Reply directly in Loop, not to this email.</p>
          </div>`,
        text: `${name} sent a new ${channel.toLowerCase()} through Loop.\n\n${preview}\n\nOpen in Loop: ${loopLink}`,
      });

      if (res.ok) {
        alerted++;
        await supabase.from('lead_message_alert_state').upsert({
          conversation_id: conv.id,
          last_alerted_message_date: new Date(lastDate).toISOString(),
          contact_id: conv.contactId || null,
          contact_name: name,
          updated_at: new Date().toISOString(),
        });
      } else {
        errors.push(`email failed for ${conv.id}: ${res.error}`);
      }
    }

    return NextResponse.json({ ok: true, checked, alerted, recipients: recipients.length, errors });
  } catch (err: any) {
    console.error('[inbound-message-alerts] failed:', err.message);
    return NextResponse.json({ ok: false, checked, alerted, error: err.message, errors }, { status: 500 });
  }
}

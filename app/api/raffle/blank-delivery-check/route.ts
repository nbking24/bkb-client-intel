// @ts-nocheck
/**
 * GET /api/raffle/blank-delivery-check
 *
 * For each of the 28 blank-contact entries, check Loop's conversation
 * history to see whether their Workflow C email actually delivered or
 * bounced. Returns a per-contact status.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'H3fSXP5K9fMGf0eJIkXk';

function headers() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    Version: '2021-07-28',
  };
}

async function fetchJSON(url: string) {
  const r = await fetch(url, { headers: headers() });
  const t = await r.text();
  let b: any = null;
  try { b = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, status: r.status, body: b, text: t };
}

export async function GET(_req: NextRequest) {
  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from('raffle_entries')
    .select('id, name, email, loop_contact_id')
    .eq('loop_sync_error', 'raffle_complete_blank_contact')
    .not('loop_contact_id', 'is', null);

  const results: any[] = [];
  for (const row of rows || []) {
    // Search conversations for this contact
    const convoUrl = new URL(`${GHL_BASE}/conversations/search`);
    convoUrl.searchParams.set('locationId', LOCATION_ID);
    convoUrl.searchParams.set('contactId', row.loop_contact_id);
    const cRes = await fetchJSON(convoUrl.toString());
    const conversations = cRes.body?.conversations || [];

    let emailEvents: any[] = [];
    for (const c of conversations) {
      const mUrl = new URL(`${GHL_BASE}/conversations/${c.id}/messages`);
      const mRes = await fetchJSON(mUrl.toString());
      const msgs = mRes.body?.messages?.messages || mRes.body?.messages || [];
      for (const m of msgs) {
        if ((m.messageType || '').toLowerCase().includes('email') || m.type === 'email' || m.type === 1) {
          emailEvents.push({
            id: m.id,
            type: m.type,
            messageType: m.messageType,
            status: m.status,
            direction: m.direction,
            dateAdded: m.dateAdded,
            subject: m.subject || m.meta?.email?.subject,
          });
        }
      }
    }

    results.push({
      name: row.name,
      email: row.email,
      contact_id: row.loop_contact_id,
      email_event_count: emailEvents.length,
      events: emailEvents,
    });
  }

  // Aggregate
  const summary = { total: results.length, with_email_events: 0, delivered: 0, bounced: 0, no_event: 0 };
  for (const r of results) {
    if (r.email_event_count === 0) summary.no_event++;
    else {
      summary.with_email_events++;
      const statuses = r.events.map((e: any) => (e.status || '').toLowerCase());
      if (statuses.some((s: string) => s.includes('bounce') || s === 'failed' || s === 'undelivered')) summary.bounced++;
      else if (statuses.some((s: string) => s === 'delivered' || s === 'sent' || s === 'read' || s === 'opened')) summary.delivered++;
    }
  }

  return NextResponse.json({ ok: true, summary, results });
}

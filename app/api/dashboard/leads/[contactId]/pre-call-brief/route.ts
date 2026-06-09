// @ts-nocheck
/**
 * GET /api/dashboard/leads/[contactId]/pre-call-brief
 *
 * Builds a one-paragraph AI brief for Nathan to read right before a call.
 * Pulls everything we have on the contact (Loop notes, full SMS/email
 * thread, JT comments, PML transcripts, contact / opportunity metadata)
 * and asks Claude to write the briefing.
 *
 * Cached on the row for 30 minutes via in-memory map (per Vercel instance)
 * so reopening the modal doesn't burn an Anthropic call every time.
 *
 * Auth: standard user bearer token (validateAuth).
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateAuth } from '@/app/api/lib/auth';
import {
  getContact,
  getContactNotes,
  getContactAppointments,
  getMessagesFromDB,
} from '@/app/lib/ghl';
import { getProjectMemoryForLead } from '@/app/lib/project-memory';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const BRIEF_MODEL = 'claude-sonnet-4-6';
const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; brief: string }>();

function trim(s: string | null | undefined, n: number): string {
  if (!s) return '';
  return String(s).length > n ? String(s).slice(0, n) + '...' : String(s);
}

export async function GET(req: NextRequest, { params }: { params: { contactId: string } }) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contactId } = params;
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  if (!contactId) return NextResponse.json({ error: 'contactId required' }, { status: 400 });

  if (!refresh) {
    const hit = cache.get(contactId);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return NextResponse.json({ brief: hit.brief, cached: true });
    }
  }

  // Gather sources in parallel.
  const [contactRes, notes, appointments, messages, pmlEvents] = await Promise.all([
    getContact(contactId).catch(() => null),
    getContactNotes(contactId).catch(() => []),
    getContactAppointments(contactId).catch(() => []),
    getMessagesFromDB(contactId, 50).catch(() => []),
    getProjectMemoryForLead({ ghlContactId: contactId, daysBack: 365, limit: 25 }).catch(() => []),
  ]);
  const contact = contactRes?.contact || contactRes || null;

  // Compact text payload for Claude. Keep the prompt under ~30K chars so we
  // stay well inside the context budget and the latency stays sane.
  const lines: string[] = [];
  lines.push(`CONTACT`);
  if (contact) {
    lines.push(
      `Name: ${[contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.companyName || ''}`,
    );
    if (contact.phone) lines.push(`Phone: ${contact.phone}`);
    if (contact.email) lines.push(`Email: ${contact.email}`);
    const addr = [contact.address1, contact.city, contact.state, contact.postalCode]
      .filter(Boolean)
      .join(', ');
    if (addr) lines.push(`Address: ${addr}`);
    if (contact.source) lines.push(`Source: ${contact.source}`);
    if (contact.dateAdded) lines.push(`First seen: ${contact.dateAdded}`);
    if (Array.isArray(contact.tags) && contact.tags.length) {
      lines.push(`Tags: ${contact.tags.join(', ')}`);
    }
  }

  if (notes?.length) {
    lines.push(``, `NOTES (oldest to newest)`);
    for (const n of notes.slice().reverse().slice(0, 20)) {
      lines.push(`- [${(n.dateAdded || '').slice(0, 10)}] ${trim(n.body, 800)}`);
    }
  }

  if (appointments?.length) {
    lines.push(``, `UPCOMING APPOINTMENTS`);
    for (const a of appointments.slice(0, 5)) {
      lines.push(`- ${a.startTime}: ${a.title || ''} (${a.appointmentStatus || a.status || ''})`);
    }
  }

  if (messages?.length) {
    lines.push(``, `LOOP MESSAGES (oldest to newest, capped 25)`);
    const sorted = messages
      .slice()
      .sort((a: any, b: any) => new Date(a.dateAdded || 0).getTime() - new Date(b.dateAdded || 0).getTime())
      .slice(-25);
    for (const m of sorted) {
      const dir = (m.direction || '').toString().toLowerCase() === 'inbound' ? 'IN' : 'OUT';
      const body = m.body || (m.messageHTML ? String(m.messageHTML).replace(/<[^>]+>/g, ' ') : '');
      lines.push(`- [${(m.dateAdded || '').slice(0, 16)}] ${dir} ${trim(body, 700)}`);
    }
  }

  if (pmlEvents?.length) {
    lines.push(``, `PRIOR MEETINGS / DECISIONS (Project Memory)`);
    for (const ev of pmlEvents.slice(0, 10)) {
      const summary = ev.summary || ev.detail || '';
      lines.push(`- [${(ev.event_date || ev.created_at || '').slice(0, 10)}] ${trim(summary, 500)}`);
    }
  }

  const sourcePayload = lines.join('\n');

  // No em dashes (Nathan rule). No "sub" / "subcontractor" in client copy.
  const prompt = `You are writing a pre-call brief for Nathan King at Brett King Builder, a residential renovation company in Bucks County PA. He is about to get on a call with the lead below and needs to know everything we already know in one short paragraph.

Write a concise briefing of 5 to 8 sentences in plain prose. Cover, where the data supports it:
- Who the lead is and how they came in
- What project they are interested in and any timeline / budget signals
- The current state of the conversation (last touch, what was said, where things stand)
- Anything notable from prior messages or meetings
- One or two specific things Nathan should confirm or ask about on this call

Rules:
- No em dashes or en dashes
- Never use the words "sub" or "subcontractor"; say "trade partner(s)"
- Do not invent details. If we have very little, say so.
- Plain prose, no bullet lists, no headings.

LEAD DATA
=========
${sourcePayload}

Write only the briefing paragraph.`;

  try {
    const res = await anthropic.messages.create({
      model: BRIEF_MODEL,
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    });
    const brief = (res.content || [])
      .map((b: any) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    cache.set(contactId, { at: Date.now(), brief });
    return NextResponse.json({ brief, cached: false });
  } catch (err: any) {
    return NextResponse.json({ error: 'Brief generation failed: ' + (err?.message || 'unknown') }, { status: 502 });
  }
}

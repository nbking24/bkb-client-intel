// @ts-nocheck
/**
 * Calendly webhook (invitee.created, invitee.canceled), organization scope.
 * URL: /api/webhook/calendly?key=<CALENDLY_WEBHOOK_KEY or CRON_SECRET>
 *
 * 1. Informational Call booked: make sure the person has a JobTread job
 *    (app/lib/leads.ts ensureLeadJob). New people get an account, contact,
 *    location (address answer, else "Address TBD") and a job at
 *    "2. Meeting Scheduled". An existing "1. New Lead" job moves to
 *    "2. Meeting Scheduled".
 * 2. Every event is then forwarded unchanged to the DataX "Calendly Meeting
 *    Sync" agent, which adds or removes the 🤝 meeting task on the job.
 *    Doing the job first means the agent always finds it.
 *
 * Style: no em or en dashes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ensureLeadJob } from '@/app/lib/leads';
import { sendEmail, escapeHtml } from '@/app/api/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const DATAX_URL = () =>
  process.env.DATAX_CALENDLY_WEBHOOK_URL || 'https://datax.to/api/agent-webhook/1b2786577b213b5d98b9ec46d6164f19';
const KEY = () => process.env.CALENDLY_WEBHOOK_KEY || process.env.CRON_SECRET || '';
const LEAD_EVENT = /informational call/i;

function eastern(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }) + ' ET';
  } catch { return iso; }
}

function answer(qa: any[], re: RegExp) {
  const hit = (qa || []).find((x) => re.test(String(x?.question || '')));
  return String(hit?.answer || '').trim();
}

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key') || '';
  if (!KEY() || key !== KEY()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await req.text();
  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }

  const event = body?.event;
  const p = body?.payload || {};
  const se = p.scheduled_event || {};
  const result: any = { event, meeting: se.name };

  if (event === 'invitee.created' && LEAD_EVENT.test(se.name || '') && p.email) {
    const qa = p.questions_and_answers || [];
    const phone = (se.location?.type === 'outbound_call' ? se.location?.location : '') || p.text_reminder_number || answer(qa, /phone/i);
    try {
      const lead = await ensureLeadJob({
        name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' '),
        email: p.email,
        phone,
        address: answer(qa, /address/i),
        message: answer(qa, /share|prepare|project/i),
        via: 'Informational Call',
        meetingWhen: se.start_time ? eastern(se.start_time) : undefined,
      }, { bumpToMeeting: true });
      result.lead = lead;
    } catch (e: any) {
      result.leadError = String(e?.message || e).slice(0, 500);
      console.error('[calendly] lead job error', result.leadError);
      await sendEmail({
        to: process.env.TICKET_NOTIFY_TERRI || 'brett@brettkingbuilder.com',
        subject: `Informational Call booked, JobTread job NOT created: ${p.name || p.email}`,
        html: `<p>${escapeHtml(p.name || '')} (${escapeHtml(p.email || '')}, ${escapeHtml(phone || 'no phone')}) booked an Informational Call for ${escapeHtml(eastern(se.start_time))}, but the JobTread job could not be created automatically. Please create it by hand.</p><p>${escapeHtml(result.leadError)}</p>`,
      }).catch(() => {});
    }
  }

  // Forward to the DataX agent (task on the job).
  try {
    const r = await fetch(DATAX_URL(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw, cache: 'no-store' });
    result.forwarded = r.status;
  } catch (e: any) {
    result.forwardError = String(e?.message || e).slice(0, 300);
  }

  return NextResponse.json({ ok: true, ...result });
}

export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'Calendly webhook: lead job for Informational Call, then forward to DataX' });
}

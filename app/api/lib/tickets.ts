/**
 * Shared helpers for the /api/tickets routes.
 *
 * Keeps event logging, email wiring, and storage config in one place so the
 * individual route files stay readable.
 */
import { createServerClient } from '@/app/lib/supabase';
import { sendEmail, ticketEmailTemplate, escapeHtml } from './email';

export const TICKET_BUCKET = 'ticket-screenshots';

export type TicketStatus =
  | 'new'
  | 'in_review'
  | 'fixing'
  | 'deployed'
  | 'escalated'
  | 'wont_fix'
  | 'closed';

export type TicketSeverity = 'low' | 'medium' | 'high' | 'urgent';

// Destination addresses, safe defaults so we don't lose notifications if env is missing.
export function nathanEmail(): string {
  return process.env.TICKET_NOTIFY_NATHAN || 'nathan@brettkingbuilder.com';
}

export function defaultTerriEmail(): string | null {
  return process.env.TICKET_NOTIFY_TERRI || null;
}

export function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL
    || process.env.VERCEL_URL
    || 'https://bkb-client-intel.vercel.app';
}

export function ticketUrl(ticketId: string): string {
  const base = appBaseUrl().replace(/\/$/, '');
  const prefixed = base.startsWith('http') ? base : `https://${base}`;
  return `${prefixed}/dashboard/tickets?open=${ticketId}`;
}

/**
 * Ensure the storage bucket exists. Screenshots are public for simplicity
 * (they're internal ops dashboards, not customer data).
 */
export async function ensureTicketBucket(sb: ReturnType<typeof createServerClient>) {
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some((b: any) => b.name === TICKET_BUCKET)) {
    await sb.storage.createBucket(TICKET_BUCKET, { public: true, fileSizeLimit: 10 * 1024 * 1024 });
  }
}

/**
 * Append an event to a ticket's timeline.
 */
export async function logTicketEvent(opts: {
  sb: ReturnType<typeof createServerClient>;
  ticketId: string;
  actor: string;
  actorRole?: string | null;
  eventType:
    | 'created'
    | 'status_changed'
    | 'commented'
    | 'claude_investigating'
    | 'claude_proposed_fix'
    | 'claude_deployed_fix'
    | 'claude_escalated'
    | 'email_sent'
    | 'screenshot_added';
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  metadata?: Record<string, any>;
}) {
  const { sb, ticketId, actor, actorRole, eventType, fromStatus, toStatus, note, metadata } = opts;
  const { error } = await sb.from('ticket_events').insert({
    ticket_id: ticketId,
    actor,
    actor_role: actorRole || null,
    event_type: eventType,
    from_status: fromStatus || null,
    to_status: toStatus || null,
    note: note || null,
    metadata: metadata || null,
  });
  if (error) {
    console.error('[tickets] logTicketEvent failed:', error.message);
  }
}

// ------------------------------------------------------------------
// Email helpers. Each returns { ok } so callers can log but not crash.
// ------------------------------------------------------------------

export async function notifyNathanNewTicket(ticket: any) {
  const link = ticketUrl(ticket.id);
  const body = `
    <p>A new ticket just came in from <strong>${escapeHtml(ticket.submitter_name || ticket.submitter_user_id)}</strong>.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f8f6f3;border-radius:8px;padding:14px 18px;margin:14px 0;width:100%;">
      <tr><td style="padding:4px 0;font-size:13px;color:#8a8078;width:110px;">Ticket</td><td style="font-size:13px;"><strong>#${ticket.ticket_number}</strong></td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#8a8078;">Severity</td><td style="font-size:13px;text-transform:capitalize;">${escapeHtml(ticket.severity)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#8a8078;vertical-align:top;">Title</td><td style="font-size:13px;">${escapeHtml(ticket.title)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#8a8078;vertical-align:top;">Page</td><td style="font-size:13px;word-break:break-all;">${escapeHtml(ticket.page_url || 'n/a')}</td></tr>
    </table>
    ${ticket.description ? `<p style="white-space:pre-wrap;">${escapeHtml(ticket.description)}</p>` : ''}
    ${ticket.screenshot_url ? `<p><a href="${ticket.screenshot_url}">View screenshot</a></p>` : ''}
    <p style="color:#5a5550;">Open Cowork and say "work the ticket queue" to have Claude pick this up.</p>
  `;
  return sendEmail({
    to: nathanEmail(),
    subject: `New ticket #${ticket.ticket_number}: ${ticket.title}`,
    html: ticketEmailTemplate({
      heading: `Ticket #${ticket.ticket_number} submitted`,
      preview: `${ticket.title} — from ${ticket.submitter_name || ticket.submitter_user_id}`,
      body,
      ctaLabel: 'Open in dashboard',
      ctaUrl: link,
    }),
  });
}

export async function notifySubmitterStatus(ticket: any, prevStatus: string) {
  const to = ticket.submitter_email || defaultTerriEmail();
  if (!to) return { ok: false, error: 'no submitter email' };

  const statusCopy: Record<string, { heading: string; body: string }> = {
    in_review: {
      heading: `Ticket #${ticket.ticket_number} is being looked at`,
      body: `<p>Good news. Your ticket <strong>"${escapeHtml(ticket.title)}"</strong> has been picked up and is now being investigated. You'll get another email the moment the fix is live.</p>`,
    },
    deployed: {
      heading: `Ticket #${ticket.ticket_number} is fixed`,
      body: `<p>The fix for <strong>"${escapeHtml(ticket.title)}"</strong> is deployed to the dashboard. Give it a refresh and take a look.</p>
        ${ticket.resolution_note ? `<p style="background:#f8f6f3;padding:14px;border-radius:8px;">${escapeHtml(ticket.resolution_note)}</p>` : ''}
        <p style="color:#5a5550;">If it's still not right, reply to this email or open a new ticket.</p>`,
    },
    escalated: {
      heading: `Ticket #${ticket.ticket_number} was handed off`,
      body: `<p>Your ticket <strong>"${escapeHtml(ticket.title)}"</strong> needs a closer look from Nathan before it can be fixed. He's been notified and will follow up directly.</p>`,
    },
    wont_fix: {
      heading: `Ticket #${ticket.ticket_number} closed`,
      body: `<p>Your ticket <strong>"${escapeHtml(ticket.title)}"</strong> was reviewed but won't be changed right now.</p>
        ${ticket.resolution_note ? `<p style="background:#f8f6f3;padding:14px;border-radius:8px;">${escapeHtml(ticket.resolution_note)}</p>` : ''}`,
    },
    closed: {
      heading: `Ticket #${ticket.ticket_number} closed`,
      body: `<p>Closing out ticket <strong>"${escapeHtml(ticket.title)}"</strong>. Thanks for flagging it.</p>`,
    },
  };

  const copy = statusCopy[ticket.status];
  if (!copy) return { ok: true }; // nothing to send for this transition

  return sendEmail({
    to,
    subject: copy.heading,
    html: ticketEmailTemplate({
      heading: copy.heading,
      preview: ticket.title,
      body: copy.body,
      ctaLabel: 'View ticket',
      ctaUrl: ticketUrl(ticket.id),
    }),
    replyTo: nathanEmail(),
  });
}

export async function notifyNathanEscalation(ticket: any, reason: string) {
  const body = `
    <p>Claude hit a wall on ticket <strong>#${ticket.ticket_number}</strong> and escalated it.</p>
    <p style="background:#fff6f6;border-left:3px solid #68050a;padding:12px 14px;border-radius:4px;">
      <strong>Why it was escalated:</strong><br>
      ${escapeHtml(reason)}
    </p>
    <table cellpadding="0" cellspacing="0" style="background:#f8f6f3;border-radius:8px;padding:14px 18px;margin:14px 0;width:100%;">
      <tr><td style="padding:4px 0;font-size:13px;color:#8a8078;width:110px;">Submitter</td><td style="font-size:13px;">${escapeHtml(ticket.submitter_name || ticket.submitter_user_id)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#8a8078;">Title</td><td style="font-size:13px;">${escapeHtml(ticket.title)}</td></tr>
      <tr><td style="padding:4px 0;font-size:13px;color:#8a8078;vertical-align:top;">Page</td><td style="font-size:13px;word-break:break-all;">${escapeHtml(ticket.page_url || 'n/a')}</td></tr>
    </table>
    ${ticket.description ? `<p style="white-space:pre-wrap;">${escapeHtml(ticket.description)}</p>` : ''}
    ${ticket.claude_notes ? `<p style="background:#f8f6f3;padding:12px;border-radius:6px;"><strong>Claude's notes:</strong><br>${escapeHtml(ticket.claude_notes)}</p>` : ''}
  `;
  return sendEmail({
    to: nathanEmail(),
    subject: `Escalated: Ticket #${ticket.ticket_number} — ${ticket.title}`,
    html: ticketEmailTemplate({
      heading: `Ticket #${ticket.ticket_number} escalated`,
      preview: reason,
      body,
      ctaLabel: 'Open ticket',
      ctaUrl: ticketUrl(ticket.id),
    }),
  });
}

/**
 * Thin Resend wrapper for transactional emails.
 *
 * Requires env vars:
 *   RESEND_API_KEY         — API key from resend.com
 *   RESEND_FROM_EMAIL      — e.g. "BKB Hub <hub@brettkingbuilder.com>"
 *   TICKET_NOTIFY_NATHAN   — destination for new-ticket + escalation alerts
 *   TICKET_NOTIFY_TERRI    — fallback email for Terri if not stored on the ticket
 *
 * Keeping this dependency-free (fetch against the Resend REST API) so we don't
 * have to add the `resend` npm package right now. We can swap in the SDK later.
 *
 * Style note: no em dashes. Nathan hates them.
 */

type EmailPayload = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export async function sendEmail(payload: EmailPayload): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'BKB Hub <onboarding@resend.dev>';

  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set, skipping send:', payload.subject);
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(payload.to) ? payload.to : [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        reply_to: payload.replyTo,
      }),
    });

    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[email] Resend API error:', data);
      return { ok: false, error: data?.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data?.id };
  } catch (err: any) {
    console.error('[email] Send failed:', err?.message);
    return { ok: false, error: err?.message || 'Unknown email error' };
  }
}

/**
 * Base email template. Keeps things simple and readable on phones.
 * BKB colors: maroon #68050a, gold #e8c860, warm cream #f8f6f3.
 */
export function ticketEmailTemplate(opts: {
  heading: string;
  preview: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): string {
  const { heading, preview, body, ctaLabel, ctaUrl } = opts;
  const cta = ctaLabel && ctaUrl
    ? `<p style="margin:28px 0;"><a href="${ctaUrl}" style="display:inline-block;background:#68050a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px;">${ctaLabel}</a></p>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#f8f6f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <div style="display:none;max-height:0;overflow:hidden;">${preview}</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f3;padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="background:#68050a;padding:18px 28px;">
          <div style="color:#e8c860;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;font-weight:600;">BKB Client Hub</div>
          <div style="color:#ffffff;font-size:20px;font-weight:600;margin-top:4px;">${heading}</div>
        </td></tr>
        <tr><td style="padding:28px;color:#1a1a1a;font-size:15px;line-height:1.55;">
          ${body}
          ${cta}
          <p style="margin-top:32px;color:#8a8078;font-size:12px;">Brett King Builder Operations Platform</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

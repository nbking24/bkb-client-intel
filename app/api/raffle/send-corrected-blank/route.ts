// @ts-nocheck
/**
 * POST /api/raffle/send-corrected-blank
 *
 * Send the blank-contact wrap-up email. Clears email DND first if set,
 * since Loop auto-DNDs on bounce and the email has since been corrected.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const GHL_BASE = 'https://services.leadconnectorhq.com';

const TARGETS = [
  { name: 'David Crane',     contactId: '6ifxQnsYZ7ZtjvZy22s1', email: 'davidcrane@verizon.net' },
];

const SUBJECT = 'Thank you for entering our Bucks Beautiful raffle';

function bodyFor(firstName: string) {
  const safeFirst = firstName || 'there';
  return `Hi ${safeFirst},

Thank you for stopping by during the Bucks Beautiful Tour and entering our basket raffle. We really enjoyed having you walk through.

We noticed on your entry that the "May we contact you about a project?" box was not marked yes or no, so we wanted to reach out one time in case you would like to hear more from us. If we have not heard from you, we will not reach out again.

A little about what we do at Brett King Builder, in case you are exploring something for your own home:

We are a family-owned remodeling and restoration company that has been building and caring for fine homes across Bucks County since 1982. We work on whole-home renovations, kitchens and baths, additions, historic restorations, and outdoor living projects, all under one roof. We have been honored with more than 50 NARI Contractor of the Year awards over the years.

If you would like to talk, you can grab a no-pressure 30-minute call with our office here:
https://go.brettkingbuilder.com/widget/booking/lZJviv1cDQzqDpJGYY9Y

If now is not the right time, that is totally fine. We will not follow up further unless you reach out.

Thanks again for being part of the tour.

Warmly,

The team at Brett King Builder
215.536.1145
brettkingbuilder.com`;
}

function bodyHtmlFor(firstName: string) {
  return bodyFor(firstName)
    .split('\n\n')
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    'Content-Type': 'application/json',
    Version: '2021-04-15',
  };
}

async function clearDnd(contactId: string) {
  // PUT /contacts/{id} with dndSettings clearing email
  const r = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: { ...headers(), Version: '2021-07-28' },
    body: JSON.stringify({
      dnd: false,
      dndSettings: {
        Email: { status: 'inactive', message: 'cleared after email correction', code: 'manual' },
      },
    }),
  });
  return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 200) };
}

async function sendEmail(contactId: string, subject: string, html: string, text: string) {
  const r = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ type: 'Email', contactId, subject, html, message: text }),
  });
  return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 300) };
}

export async function POST(_req: NextRequest) {
  const results: any[] = [];
  for (const t of TARGETS) {
    const dnd = await clearDnd(t.contactId);
    const firstName = t.name.split(/\s+/)[0];
    const send = await sendEmail(t.contactId, SUBJECT, bodyHtmlFor(firstName), bodyFor(firstName));
    results.push({ name: t.name, email: t.email, dnd_clear: dnd, send });
  }
  return NextResponse.json({ ok: true, results });
}

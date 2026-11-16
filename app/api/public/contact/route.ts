// @ts-nocheck
/**
 * Website contact form (replaces the Loop form on brettkingbuilder.com/contact-us).
 * Public, no auth. The page is /contact (embedded on the website in an iframe).
 *
 * On submit:
 *   1. Find or create the lead's JobTread job (app/lib/leads.ts), attach photos.
 *   2. Email Terri with everything, plus the job link.
 *   3. Email the client a thank-you with the Informational Call booking link.
 * Emails go out even if JobTread fails, so a lead is never lost; Terri's email
 * says plainly when the job still needs to be made by hand.
 *
 * Style: no em or en dashes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { sendEmail, escapeHtml } from '@/app/api/lib/email';
import { ensureLeadJob, attachUrlToJob, jobUrl, INFORMATIONAL_CALL_URL, LEAD_SOURCES } from '@/app/lib/leads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TYPES = ['Kitchen', 'Bathroom', 'Basement', 'Addition', 'Whole House', 'Detached Structure', 'Exterior', 'Other'];

const TERRI = () => process.env.TICKET_NOTIFY_TERRI || 'brett@brettkingbuilder.com';
const FROM = () => {
  const raw = process.env.RESEND_FROM_EMAIL || '';
  const addr = (raw.match(/<([^>]+)>/)?.[1] || raw).trim();
  return addr ? `Brett King Builder <${addr}>` : undefined;
};

const s = (v, n = 300) => String(v ?? '').trim().slice(0, n);

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  if (body?.website) return NextResponse.json({ ok: true }); // honeypot

  const first = s(body.firstName, 80);
  const last = s(body.lastName, 80);
  const email = s(body.email, 200);
  const phone = s(body.phone, 40);
  const street = s(body.street, 200);
  const city = s(body.city, 80);
  const state = s(body.state, 40) || 'PA';
  const zip = s(body.zip, 20);
  const message = s(body.message, 5000);
  const types = (Array.isArray(body.types) ? body.types : []).map(String).filter((t) => TYPES.includes(t));
  const heard = LEAD_SOURCES.includes(body.heard) ? body.heard : 'Other';
  const referredBy = s(body.referredBy, 200);

  if (!first || !last) return NextResponse.json({ error: 'Please enter your first and last name.' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Please enter a valid email.' }, { status: 400 });
  if (!phone) return NextResponse.json({ error: 'Please enter a phone number.' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'Please tell us a little about your project.' }, { status: 400 });

  const name = `${first} ${last}`;
  const address = [street, [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');

  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/questionnaire-uploads/`;
  const files = (Array.isArray(body?.files) ? body.files : [])
    .filter((f) => typeof f?.path === 'string' && /^[0-9a-f-]{36}\//.test(f.path))
    .slice(0, 15)
    .map((f) => ({ url: base + f.path, name: s(f.name || 'file', 150), type: s(f.type, 100) || undefined }));

  // 1. JobTread
  let lead = null;
  let jtError = '';
  const fileErrors: string[] = [];
  try {
    lead = await ensureLeadJob({
      name, email, phone, address: street ? address : '', types, message,
      leadSource: heard, referredBy, via: 'contact form',
    });
    for (const f of files) {
      try { await attachUrlToJob(lead.jobId, f); } catch (e: any) { fileErrors.push(`${f.name}: ${e?.message || e}`); }
    }
  } catch (e: any) {
    jtError = String(e?.message || e).slice(0, 500);
    console.error('[contact] JobTread error', jtError);
  }

  // 2. Terri
  const rows = [
    ['Name', name], ['Email', email], ['Phone', phone], ['Address', address || 'not given'],
    ['Project type', types.join(', ') || 'not given'], ['How they heard', heard + (referredBy ? ` (${referredBy})` : '')],
    ['Files', files.length ? `${files.length} attached` : 'none'],
  ];
  const jtLine = lead
    ? lead.action === 'existing'
      ? `<p><b>Already in JobTread:</b> <a href="${jobUrl(lead.jobId)}">${escapeHtml(lead.jobName)} (${escapeHtml(String(lead.jobNumber || ''))})</a>. No new job was made.</p>`
      : `<p><b>New JobTread job:</b> <a href="${jobUrl(lead.jobId)}">${escapeHtml(lead.jobName)} (${escapeHtml(String(lead.jobNumber || ''))})</a>, Status 1. New Lead.</p>`
    : `<p style="color:#6E1E1C"><b>The JobTread job could not be created automatically. Please create it by hand.</b><br>${escapeHtml(jtError)}</p>`;
  const fileLinks = files.map((f) => `<li><a href="${f.url}">${escapeHtml(f.name)}</a></li>`).join('');
  const terriHtml = `<p>A new lead came in through the website contact form.</p>${jtLine}
<table cellpadding="4" style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="color:#6F6A62;padding-right:12px">${k}</td><td>${escapeHtml(String(v))}</td></tr>`).join('')}</table>
<p><b>About the project</b><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
${fileLinks ? `<p><b>Files</b></p><ul>${fileLinks}</ul>` : ''}
${fileErrors.length ? `<p style="color:#6E1E1C">Some files did not attach to the job: ${escapeHtml(fileErrors.join('; '))}</p>` : ''}
<p>They were emailed the link to book an Informational Call with you. If they book, it will show up on your Calendly and on this job.</p>`;
  await sendEmail({
    to: TERRI(),
    subject: `New website lead: ${name}${types.length ? ' (' + types.join(', ') + ')' : ''}`,
    html: terriHtml,
    replyTo: email,
    from: FROM(),
  }).catch(() => {});

  // 3. Client
  const clientHtml = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1F1D1B;max-width:560px">
<p>Hi ${escapeHtml(first)},</p>
<p>Thank you for reaching out to Brett King Builder. We received your message about your project and we're glad you contacted us.</p>
<p>The next step is a short call with me, about 20 minutes, so we can hear about your home and what you have in mind. You can pick a time that works for you here:</p>
<p><a href="${INFORMATIONAL_CALL_URL}" style="display:inline-block;background:#6E1E1C;color:#F5F1EA;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold;letter-spacing:1px">Schedule a call</a></p>
<p>If you'd rather we reach out to you, just reply to this email and I'll give you a call.</p>
<p>Terri Dalavai | Office Manager<br>Brett King Builder-Contractor, Inc<br>Office: 215-536-1145<br>brett@brettkingbuilder.com<br><a href="https://www.brettkingbuilder.com">www.brettkingbuilder.com</a><br>Building Upon a Solid Foundation<br>Luke 6:47-49</p>
</div>`;
  const clientText = `Hi ${first},\n\nThank you for reaching out to Brett King Builder. We received your message about your project and we're glad you contacted us.\n\nThe next step is a short call with me, about 20 minutes, so we can hear about your home and what you have in mind. You can pick a time that works for you here:\n${INFORMATIONAL_CALL_URL}\n\nIf you'd rather we reach out to you, just reply to this email and I'll give you a call.\n\nTerri Dalavai | Office Manager\nBrett King Builder-Contractor, Inc\nOffice: 215-536-1145\nbrett@brettkingbuilder.com\nwww.brettkingbuilder.com\nBuilding Upon a Solid Foundation\nLuke 6:47-49`;
  await sendEmail({
    to: email,
    subject: 'Thank you for contacting Brett King Builder',
    html: clientHtml,
    text: clientText,
    replyTo: TERRI(),
    from: FROM(),
  }).catch(() => {});

  return NextResponse.json({ ok: true, bookingUrl: INFORMATIONAL_CALL_URL });
}

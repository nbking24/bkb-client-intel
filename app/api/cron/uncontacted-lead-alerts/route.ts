// @ts-nocheck
/**
 * Cron: alert Terri the moment a new uncontacted lead appears.
 *
 * Runs every 15 minutes via vercel.json. Calls the same bucketing logic the
 * Leads dashboard's "Needs Your Attention" zone uses, then emails Terri
 * about any contact we haven't already alerted for.
 *
 * Dedup: lead_uncontacted_alerts.contact_id is a primary key. Each contact
 * fires at most one email, ever, no matter how many cron runs see them in
 * the New & Uncontacted bucket.
 *
 * Auth: Bearer CRON_SECRET (matches the other crons in this repo). Vercel's
 * cron runner also sends x-vercel-cron which we accept as a fallback.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { sendEmail, ticketEmailTemplate, escapeHtml } from '@/app/api/lib/email';
import { computeLeadsNeedsAttention } from '@/app/lib/leads-needs-attention';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const TERRI_EMAIL = 'brett@brettkingbuilder.com';

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${expected}`) return true;
  // Vercel's built-in cron runner.
  if (req.headers.get('x-vercel-cron')) return true;
  return false;
}

function buildEmailHtml(row: any): string {
  const ageH = row.leadAgeHours ?? 0;
  const ageLabel = ageH < 24 ? `${ageH} hour(s) old` : `${Math.floor(ageH / 24)} day(s) old`;
  const phone = row.phone ? `Phone: ${escapeHtml(row.phone)}<br>` : '';
  const email = row.email ? `Email: ${escapeHtml(row.email)}<br>` : '';
  const stage = row.stage ? `Stage: ${escapeHtml(row.stage)}<br>` : '';
  const opp = row.opportunityName ? `Opportunity: ${escapeHtml(row.opportunityName)}<br>` : '';
  const link = `https://bkb-client-intel.vercel.app/dashboard/leads`;
  const body = `
    <p style="margin:0 0 12px;">A new lead just came in and has not been contacted yet.</p>
    <p style="margin:0 0 18px;font-size:18px;font-weight:600;color:#68050a;">${escapeHtml(row.contactName || 'Unknown contact')}</p>
    <p style="margin:0 0 18px;font-size:14px;color:#4a4540;">
      ${phone}${email}${stage}${opp}Lead age: ${escapeHtml(String(ageLabel))}
    </p>
    <p style="margin:0 0 12px;font-size:13px;color:#6a6058;">
      They are in an active stage in Loop with no scheduled appointment and no outbound SMS or email from us in the last 48 hours.
    </p>
  `;
  return ticketEmailTemplate({
    heading: 'New lead needs first touch',
    preview: `${row.contactName || 'A new lead'} just came in and has not been contacted yet.`,
    body,
    ctaLabel: 'Open in BKB Hub',
    ctaUrl: link,
  });
}

function buildEmailText(row: any): string {
  const ageH = row.leadAgeHours ?? 0;
  const ageLabel = ageH < 24 ? `${ageH} hour(s) old` : `${Math.floor(ageH / 24)} day(s) old`;
  return [
    `New lead needs first touch:`,
    ``,
    `Name: ${row.contactName || 'Unknown contact'}`,
    row.phone ? `Phone: ${row.phone}` : null,
    row.email ? `Email: ${row.email}` : null,
    row.stage ? `Stage: ${row.stage}` : null,
    row.opportunityName ? `Opportunity: ${row.opportunityName}` : null,
    `Lead age: ${ageLabel}`,
    ``,
    `They are in an active stage in Loop with no scheduled appointment and no outbound SMS or email from us in the last 48 hours.`,
    ``,
    `Open in BKB Hub: https://bkb-client-intel.vercel.app/dashboard/leads`,
  ].filter(Boolean).join('\n');
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let result;
  try {
    result = await computeLeadsNeedsAttention();
  } catch (err: any) {
    return NextResponse.json({ error: 'Bucketing failed: ' + (err?.message || 'unknown') }, { status: 502 });
  }
  const rows = result.newUncontacted || [];
  const sb = getSupabase();
  let attempted = 0;
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (!row?.contactId) continue;
    attempted++;
    const { data: inserted, error: insErr } = await sb
      .from('lead_uncontacted_alerts')
      .insert({
        contact_id: row.contactId,
        contact_name: row.contactName || null,
        stage: row.stage || null,
        alerted_to: TERRI_EMAIL,
        lead_age_hours: row.leadAgeHours ?? null,
        payload: row,
      })
      .select('contact_id')
      .single();
    if (insErr) {
      // Unique violation = already alerted for this contact. Idempotent path.
      if ((insErr as any).code === '23505' || /duplicate/i.test(insErr.message || '')) {
        skipped++;
        continue;
      }
      errors.push(`${row.contactId}: ${insErr.message}`);
      continue;
    }
    if (!inserted) {
      skipped++;
      continue;
    }
    const sendRes = await sendEmail({
      to: TERRI_EMAIL,
      subject: `New uncontacted lead: ${row.contactName || 'Unknown'}`,
      html: buildEmailHtml(row),
      text: buildEmailText(row),
    });
    if (sendRes.ok) {
      sent++;
      if (sendRes.id) {
        await sb
          .from('lead_uncontacted_alerts')
          .update({ message_id: sendRes.id })
          .eq('contact_id', row.contactId);
      }
    } else {
      // Email failed -> remove the sentinel so the next cron run retries.
      await sb.from('lead_uncontacted_alerts').delete().eq('contact_id', row.contactId);
      errors.push(`${row.contactId}: send failed - ${sendRes.error}`);
    }
  }

  return NextResponse.json({
    ok: true,
    attempted,
    sent,
    skipped,
    errors: errors.length ? errors : undefined,
    inUncontactedBucket: rows.length,
    generatedAt: new Date().toISOString(),
  });
}

// @ts-nocheck
/**
 * POST /api/marketing/photo-engine/notify
 *
 * Delivery route for the Marketing Photo Engine. The Cowork/Claude task composes
 * the change summary email and posts it here. This route is DRAFT-GATED: the
 * composed email only goes to the marketing advisor (Mike Roda) when BOTH
 *   settings.live_mode === true  AND  process.env.MARKETING_PHOTO_ENGINE_LIVE === 'true'
 * are set. While in draft, the same email is sent to Nathan as a preview so he
 * can review exactly what Mike will get once the engine is turned on. Mike never
 * receives anything in draft mode.
 *
 * Auth: cron-secret gated (Bearer CRON_SECRET, or App PIN base64), matching the
 * financial-snapshot cron endpoint. This is a server-to-server route.
 *
 * Body: { runId?, jobFolder, subject, html, text? }
 *
 * Style note: no em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';
import { sendEmail } from '@/app/api/lib/email';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Same auth pattern as the other crons: Bearer CRON_SECRET or App PIN base64.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    const appPin = process.env.APP_PIN;
    if (appPin) {
      const expectedAuth = `Bearer ${Buffer.from(appPin + ':').toString('base64')}`;
      if (authHeader !== expectedAuth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const runId = typeof body?.runId === 'string' ? body.runId : null;
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
  const html = typeof body?.html === 'string' ? body.html : '';
  const text = typeof body?.text === 'string' ? body.text : undefined;

  if (!subject || !html) {
    return NextResponse.json(
      { error: 'Missing required fields: subject, html' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  // Read the single settings row for live_mode + recipient + preview_recipient.
  const { data: settings } = await supabase
    .from('marketing_photo_settings')
    .select('live_mode, recipient, preview_recipient')
    .eq('id', 1)
    .maybeSingle();

  const live = settings?.live_mode === true && process.env.MARKETING_PHOTO_ENGINE_LIVE === 'true';

  // Helper: only touch the run row when a runId was provided.
  async function markRun(fields: any) {
    if (!runId) return;
    await supabase.from('marketing_photo_runs').update(fields).eq('id', runId);
  }

  if (live) {
    // Live: deliver the real email to the marketing advisor.
    const recipient = settings?.recipient || 'mike@lighthoused.com';
    const res = await sendEmail({ to: recipient, subject, html, text });

    if (!res.ok) {
      await markRun({ email_status: 'draft', error: res.error || 'Send failed' });
      return NextResponse.json(
        { sent: false, error: res.error || 'Send failed' },
        { status: 500 }
      );
    }

    await markRun({ email_status: 'sent' });
    return NextResponse.json({ sent: true, to: recipient });
  }

  // Draft: send a preview to Nathan (never Mike). Even if the preview send
  // fails, we still mark the run held and return 200 so the processor moves on.
  const previewRecipient = settings?.preview_recipient || 'nathan@brettkingbuilder.com';
  const previewNote =
    '<p style="background:#FEF3C7;padding:8px;border-radius:6px;font-size:13px">Draft preview. This is what will go to Mike once the Photo Engine is turned on. Nothing has been sent to him.</p>';
  const previewHtml = html ? previewNote + html : html;

  try {
    const res = await sendEmail({
      to: previewRecipient,
      subject: '[DRAFT PREVIEW] ' + subject,
      html: previewHtml,
      text,
    });
    await markRun({ email_status: 'held' });
    if (!res.ok) {
      return NextResponse.json({ sent: false, preview: false, held: true });
    }
    return NextResponse.json({ sent: false, preview: true, to: previewRecipient });
  } catch {
    await markRun({ email_status: 'held' });
    return NextResponse.json({ sent: false, preview: false, held: true });
  }
}

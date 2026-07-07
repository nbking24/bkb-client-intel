// @ts-nocheck
/**
 * POST /api/marketing/photo-engine/notify
 *
 * Delivery route for the Marketing Photo Engine. The Cowork/Claude task composes
 * the change summary email and posts it here. This route is DRAFT-GATED: nothing
 * is emailed to the marketing advisor (Mike Roda) or anyone external unless BOTH
 *   settings.live_mode === true  AND  process.env.MARKETING_PHOTO_ENGINE_LIVE === 'true'
 * are set. Otherwise the run is marked 'held' and no email is sent.
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

  // Read the single settings row for live_mode + recipient.
  const { data: settings } = await supabase
    .from('marketing_photo_settings')
    .select('live_mode, recipient')
    .eq('id', 1)
    .maybeSingle();

  const liveMode = settings?.live_mode === true;
  const envLive = process.env.MARKETING_PHOTO_ENGINE_LIVE === 'true';

  // DRAFT GATE: both the settings flag and the env flag must be on to send.
  if (!(liveMode && envLive)) {
    if (runId) {
      await supabase
        .from('marketing_photo_runs')
        .update({ email_status: 'held' })
        .eq('id', runId);
    }
    return NextResponse.json({ sent: false, held: true, reason: 'draft mode' });
  }

  // Live: deliver to the configured recipient.
  const recipient = settings?.recipient || 'mike@lighthoused.com';
  const res = await sendEmail({ to: recipient, subject, html, text });

  if (!res.ok) {
    if (runId) {
      await supabase
        .from('marketing_photo_runs')
        .update({ email_status: 'draft', error: res.error || 'Send failed' })
        .eq('id', runId);
    }
    return NextResponse.json({ sent: false, error: res.error || 'Send failed' }, { status: 500 });
  }

  if (runId) {
    await supabase
      .from('marketing_photo_runs')
      .update({ email_status: 'sent' })
      .eq('id', runId);
  }

  return NextResponse.json({ sent: true, id: res.id, recipient });
}

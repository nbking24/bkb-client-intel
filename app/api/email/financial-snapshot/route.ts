/**
 * POST /api/email/financial-snapshot
 *
 * Receives a pre-composed HTML + text financial snapshot from an outside
 * scheduler (Claude scheduled task on Cowork) and emails it to Nathan via
 * Resend. Cron-secret gated so only the authorized scheduler can post.
 *
 * The composition happens outside the Hub because we pull QB via the
 * QuickBooks MCP (not the Hub OAuth). The Hub just handles delivery.
 *
 * Body:
 *   { subject: string, html: string, text?: string, to?: string | string[] }
 *
 * Auth: Bearer CRON_SECRET, or App PIN base64 (matches other cron endpoints).
 *
 * Env:
 *   FINANCIAL_SNAPSHOT_TO — default recipient(s), comma-separated
 *                          Falls back to nathan@brettkingbuilder.com
 *
 * Style note: no em dashes anywhere in this file. Nathan hates them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/app/api/lib/email';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const DEFAULT_RECIPIENT = 'nathan@brettkingbuilder.com';

export async function POST(request: NextRequest) {
  // Same auth pattern as the other crons
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

  const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
  const html = typeof body?.html === 'string' ? body.html : '';
  const text = typeof body?.text === 'string' ? body.text : undefined;

  if (!subject || !html) {
    return NextResponse.json(
      { error: 'Missing required fields: subject, html' },
      { status: 400 }
    );
  }

  // Recipient resolution: request > env var > default
  let to: string[] = [];
  if (Array.isArray(body?.to)) {
    to = body.to.filter((v: any) => typeof v === 'string' && v.includes('@'));
  } else if (typeof body?.to === 'string' && body.to.includes('@')) {
    to = [body.to];
  } else {
    const envRecipients = (process.env.FINANCIAL_SNAPSHOT_TO || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.includes('@'));
    to = envRecipients.length ? envRecipients : [DEFAULT_RECIPIENT];
  }

  const res = await sendEmail({
    to,
    subject,
    html,
    text,
  });

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error || 'Send failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    id: res.id,
    recipients: to,
    subject,
  });
}

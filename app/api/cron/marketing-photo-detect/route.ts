// @ts-nocheck
/**
 * GET /api/cron/marketing-photo-detect
 *
 * Nightly change detector for the Marketing Photo Engine: flags the selected
 * jobs that have new items so the Friday run (or Run now) only works those.
 * The logic lives in app/api/lib/marketing/detect.ts, which every run also
 * calls when it starts, so files added during the day are never missed.
 *
 * Auth: Bearer CRON_SECRET, or App PIN base64 (matches the other cron endpoints).
 * Vercel Cron sends Authorization: Bearer <CRON_SECRET> automatically when the
 * CRON_SECRET env var is set.
 *
 * Style note: no em dashes anywhere in this file. Nathan hates them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { detectNewMarketingItems } from '@/app/api/lib/marketing/detect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Same auth pattern as the other crons.
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

  try {
    return NextResponse.json(await detectNewMarketingItems());
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Detection failed' }, { status: 500 });
  }
}

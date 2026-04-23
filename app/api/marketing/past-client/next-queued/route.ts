// @ts-nocheck
/**
 * GET /api/marketing/past-client/next-queued
 *
 * Returns the next past-client contact to send an initial iMessage to.
 *
 * Auth: x-agent-token (for Cowork sender) OR Bearer dashboard token.
 *
 * Response:
 *   200 { contact: {...} | null, daily_count: number, daily_cap: number }
 *   401 if auth fails
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../../lib/auth';
import { getNextQueuedContact, countSentToday } from '../../../lib/marketing/past-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAILY_CAP = Number(process.env.PCO_DAILY_CAP || 30);

export async function GET(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const [contact, dailyCount] = await Promise.all([
      getNextQueuedContact(),
      countSentToday(),
    ]);
    const atCap = dailyCount >= DAILY_CAP;
    return NextResponse.json({
      contact: atCap ? null : contact,
      daily_count: dailyCount,
      daily_cap: DAILY_CAP,
      at_cap: atCap,
    });
  } catch (e: any) {
    console.error('[pco/next-queued]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

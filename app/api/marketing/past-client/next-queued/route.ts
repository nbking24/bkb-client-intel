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

  // Caller (the sender script) passes its persistent seen-log here so the
  // query explicitly excludes contacts we've already messaged, even if
  // Supabase's read cache thinks they're still queued.
  const excludeRaw = req.nextUrl.searchParams.get('exclude_keys') || '';
  const excludeKeys = excludeRaw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => /^\d{10}$/.test(k))
    .slice(0, 500); // hard cap

  try {
    const [contact, dailyCount] = await Promise.all([
      getNextQueuedContact(excludeKeys),
      countSentToday(),
    ]);
    const atCap = dailyCount >= DAILY_CAP;
    return NextResponse.json(
      {
        contact: atCap ? null : contact,
        daily_count: dailyCount,
        daily_cap: DAILY_CAP,
        at_cap: atCap,
      },
      {
        // GET endpoints get cached aggressively by Vercel/CDN/browsers.
        // We MUST bypass that — a stale next-queued response can return a
        // contact who already had a text sent, which would cause a duplicate
        // text. Belt-and-suspenders: force-dynamic above + no-store here.
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
          Pragma: 'no-cache',
        },
      },
    );
  } catch (e: any) {
    console.error('[pco/next-queued]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

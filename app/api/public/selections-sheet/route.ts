// @ts-nocheck
/**
 * GET /api/public/selections-sheet?t=<token>
 *
 * Public endpoint — no login. Serves the client-safe selections sheet
 * for the tokened share links (/s/[token]) that BKB sends to clients.
 *
 * The token is jobId~HMAC (see makeSheetToken); an invalid signature
 * returns 404 so job IDs can't be enumerated. The response contains
 * only client-appropriate fields — no internal notes, no costs — by
 * construction of fetchSelectionsSheet.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  fetchSelectionsSheet,
  verifySheetToken,
} from '../../lib/selections-sheet';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t') || '';
  const jobId = verifySheetToken(token);
  if (!jobId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const sheet = await fetchSelectionsSheet(jobId);
    return NextResponse.json(
      { sheet },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('[SelectionsSheet public] error:', err);
    return NextResponse.json(
      { error: 'Failed to load selections sheet' },
      { status: 500 }
    );
  }
}

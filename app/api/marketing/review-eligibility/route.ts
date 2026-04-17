// @ts-nocheck
/**
 * GET /api/marketing/review-eligibility?contactId=xxx
 *
 * Used by GHL workflows as a gating step BEFORE sending any review ask.
 * Returns { eligible: true } or { eligible: false, reason: '...' }.
 *
 * GHL workflows should be configured to branch on `eligible === true`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkReviewEligibility } from '../../lib/marketing/review-dedup';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const contactId = req.nextUrl.searchParams.get('contactId');
  if (!contactId) {
    return NextResponse.json(
      { eligible: false, reason: 'missing_contact_id' },
      { status: 400 }
    );
  }
  const result = await checkReviewEligibility(contactId);
  return NextResponse.json(result);
}

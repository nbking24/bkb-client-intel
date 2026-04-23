// @ts-nocheck
/**
 * POST /api/marketing/past-client/skip
 *
 * Mark a queued past-client row as skipped (operator decided not to send).
 *
 * Body: { contact_key: string, reason?: string }
 * Auth: x-agent-token OR Bearer
 * Response: 200 { row } | 400 | 401
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../../lib/auth';
import { markSkipped } from '../../../lib/marketing/past-client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const { contact_key, reason } = body;
  if (!contact_key) {
    return NextResponse.json({ error: 'contact_key required' }, { status: 400 });
  }
  try {
    const row = await markSkipped(contact_key, reason);
    return NextResponse.json({ row });
  } catch (e: any) {
    console.error('[pco/skip]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

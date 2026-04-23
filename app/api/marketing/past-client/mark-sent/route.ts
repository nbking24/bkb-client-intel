// @ts-nocheck
/**
 * POST /api/marketing/past-client/mark-sent
 *
 * Mark a past-client row as initial_sent. Called by the Cowork sender
 * immediately after a successful AppleScript dispatch to Messages.
 *
 * Body: { contact_key: string, sent_body?: string }
 * Auth: x-agent-token (sender) OR Bearer (dashboard manual-send).
 * Response: 200 { row } | 400 | 401 | 409 if stage already advanced
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../../lib/auth';
import { markSent } from '../../../lib/marketing/past-client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const { contact_key, sent_body } = body;
  if (!contact_key) {
    return NextResponse.json({ error: 'contact_key required' }, { status: 400 });
  }
  try {
    const row = await markSent(contact_key, sent_body);
    if (!row) {
      return NextResponse.json(
        { error: 'not_found_or_already_sent' },
        { status: 409 },
      );
    }
    return NextResponse.json({ row });
  } catch (e: any) {
    console.error('[pco/mark-sent]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

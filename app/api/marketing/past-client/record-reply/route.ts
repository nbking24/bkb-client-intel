// @ts-nocheck
/**
 * POST /api/marketing/past-client/record-reply
 *
 * Called by the chat.db scanner (or dashboard manual entry) when an
 * inbound iMessage comes back from a past client. Automatically routes
 * to 'opted_out' stage if the reply contains STOP/unsubscribe language.
 *
 * Body:
 *   { contact_key: string, reply_text: string, reply_at?: ISO string }
 * Auth: x-agent-token OR Bearer
 * Response: 200 { row, opted_out: bool } | 400 | 401
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../../lib/auth';
import { recordReply } from '../../../lib/marketing/past-client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const { contact_key, reply_text, reply_at } = body;
  if (!contact_key || !reply_text) {
    return NextResponse.json(
      { error: 'contact_key and reply_text required' },
      { status: 400 },
    );
  }
  try {
    const { row, optedOut } = await recordReply(contact_key, reply_text, reply_at);
    return NextResponse.json({ row, opted_out: optedOut });
  } catch (e: any) {
    console.error('[pco/record-reply]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

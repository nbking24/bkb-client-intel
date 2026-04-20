// @ts-nocheck
/**
 * POST /api/tickets/[id]/events
 *
 * Append a comment or freeform event to a ticket's timeline.
 * Body: { note: string, actor?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../../lib/auth';
import { createServerClient } from '@/app/lib/supabase';
import { logTicketEvent } from '../../../lib/tickets';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const note = String(body?.note || '').trim();
    if (!note) return NextResponse.json({ error: 'note is required' }, { status: 400 });

    const sb = createServerClient();
    const { data: ticket } = await sb.from('tickets').select('submitter_user_id').eq('id', params.id).single();
    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    // Tickets are a shared team queue. Any authenticated team member can comment.

    const actor = body?.actor || auth.userId || 'system';
    await logTicketEvent({
      sb,
      ticketId: params.id,
      actor,
      actorRole: actor === 'claude' ? 'agent' : auth.role,
      eventType: 'commented',
      note,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to log event' }, { status: 500 });
  }
}

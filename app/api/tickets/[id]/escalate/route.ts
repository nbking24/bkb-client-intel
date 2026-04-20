// @ts-nocheck
/**
 * POST /api/tickets/[id]/escalate
 *
 * Claude calls this when it determines it can't fix a ticket on its own.
 * Body: { reason: string, actor?: 'claude' | 'nathan' }
 *
 * Moves the ticket to "escalated", logs it, emails Nathan with full context,
 * and emails the submitter a friendly "being handed off" note.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../../lib/auth';
import { createServerClient } from '@/app/lib/supabase';
import {
  logTicketEvent,
  notifyNathanEscalation,
  notifySubmitterStatus,
} from '../../../lib/tickets';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const reason = String(body?.reason || '').trim();
    const actor = body?.actor || 'claude';
    if (!reason) return NextResponse.json({ error: 'reason is required' }, { status: 400 });

    const sb = createServerClient();
    const { data: current, error: readErr } = await sb.from('tickets').select('*').eq('id', params.id).single();
    if (readErr || !current) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    const { data: updated, error: upErr } = await sb
      .from('tickets')
      .update({
        status: 'escalated',
        claude_notes: current.claude_notes
          ? `${current.claude_notes}\n\n--- Escalation reason ---\n${reason}`
          : reason,
      })
      .eq('id', params.id)
      .select()
      .single();

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    await logTicketEvent({
      sb,
      ticketId: params.id,
      actor,
      actorRole: actor === 'claude' ? 'agent' : 'owner',
      eventType: 'claude_escalated',
      fromStatus: current.status,
      toStatus: 'escalated',
      note: reason,
    });

    // Notify both sides
    const [nathanEmail, submitterEmail] = await Promise.all([
      notifyNathanEscalation(updated, reason),
      notifySubmitterStatus(updated, current.status),
    ]);

    if (nathanEmail.ok) {
      await logTicketEvent({
        sb,
        ticketId: params.id,
        actor: 'system',
        actorRole: 'system',
        eventType: 'email_sent',
        note: 'Escalation email sent to Nathan',
        metadata: { recipient: 'nathan', message_id: nathanEmail.id },
      });
    }
    if (submitterEmail.ok) {
      await logTicketEvent({
        sb,
        ticketId: params.id,
        actor: 'system',
        actorRole: 'system',
        eventType: 'email_sent',
        note: 'Handoff email sent to submitter',
        metadata: { recipient: updated.submitter_user_id, message_id: submitterEmail.id },
      });
    }

    return NextResponse.json({ ticket: updated });
  } catch (err: any) {
    console.error('[tickets escalate] error:', err?.message);
    return NextResponse.json({ error: err?.message || 'Escalation failed' }, { status: 500 });
  }
}

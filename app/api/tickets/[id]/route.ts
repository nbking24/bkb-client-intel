// @ts-nocheck
/**
 * /api/tickets/[id]
 *
 * GET   — fetch a single ticket with its event timeline
 * PATCH — update ticket fields (status, claude_notes, branch, pr_url, etc.)
 *         Used by Claude during the Cowork pickup workflow.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../lib/auth';
import { createServerClient } from '@/app/lib/supabase';
import { logTicketEvent, notifySubmitterStatus } from '../../lib/tickets';

const ALLOWED_STATUSES = ['new', 'in_review', 'fixing', 'deployed', 'escalated', 'wont_fix', 'closed'];
const NOTIFY_ON = new Set(['in_review', 'deployed', 'escalated', 'wont_fix', 'closed']);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const sb = createServerClient();
    const { data: ticket, error } = await sb.from('tickets').select('*').eq('id', params.id).single();
    if (error || !ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    // Non-owners can only see their own tickets
    if (auth.role !== 'owner' && ticket.submitter_user_id !== auth.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: events } = await sb
      .from('ticket_events')
      .select('*')
      .eq('ticket_id', params.id)
      .order('created_at', { ascending: true });

    return NextResponse.json({ ticket, events: events || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to load ticket' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Only Nathan (or Claude operating as Nathan) can mutate tickets
  if (auth.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await req.json();
    const {
      status,
      claude_notes,
      claude_branch,
      claude_commit_sha,
      claude_pr_url,
      resolution_note,
      actor, // defaults to the auth userId; Claude passes 'claude'
      note,
    } = body;

    const sb = createServerClient();
    const { data: current, error: readErr } = await sb.from('tickets').select('*').eq('id', params.id).single();
    if (readErr || !current) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    const patch: Record<string, any> = {};
    if (status !== undefined) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      patch.status = status;
      if (status === 'deployed' || status === 'closed' || status === 'wont_fix') {
        patch.resolved_at = new Date().toISOString();
      }
    }
    if (claude_notes !== undefined) patch.claude_notes = claude_notes;
    if (claude_branch !== undefined) patch.claude_branch = claude_branch;
    if (claude_commit_sha !== undefined) patch.claude_commit_sha = claude_commit_sha;
    if (claude_pr_url !== undefined) patch.claude_pr_url = claude_pr_url;
    if (resolution_note !== undefined) patch.resolution_note = resolution_note;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: updated, error: upErr } = await sb
      .from('tickets')
      .update(patch)
      .eq('id', params.id)
      .select()
      .single();

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const actingAs = actor || auth.userId || 'nathan';

    // Log a status-changed event if status moved
    if (status && status !== current.status) {
      await logTicketEvent({
        sb,
        ticketId: params.id,
        actor: actingAs,
        actorRole: actingAs === 'claude' ? 'agent' : auth.role,
        eventType: 'status_changed',
        fromStatus: current.status,
        toStatus: status,
        note: note || claude_notes || null,
        metadata: {
          claude_branch: claude_branch || null,
          claude_pr_url: claude_pr_url || null,
          claude_commit_sha: claude_commit_sha || null,
        },
      });

      // Send submitter notification for meaningful transitions
      if (NOTIFY_ON.has(status)) {
        const emailResult = await notifySubmitterStatus(updated, current.status);
        if (emailResult.ok) {
          await logTicketEvent({
            sb,
            ticketId: params.id,
            actor: 'system',
            actorRole: 'system',
            eventType: 'email_sent',
            note: `Status update email sent to ${updated.submitter_name}`,
            metadata: { to_status: status, message_id: emailResult.id },
          });
        }
      }
    } else if (note || claude_notes) {
      // Just a comment / notes update without a status change
      await logTicketEvent({
        sb,
        ticketId: params.id,
        actor: actingAs,
        actorRole: actingAs === 'claude' ? 'agent' : auth.role,
        eventType: 'commented',
        note: note || claude_notes,
      });
    }

    return NextResponse.json({ ticket: updated });
  } catch (err: any) {
    console.error('[tickets PATCH] error:', err?.message);
    return NextResponse.json({ error: err?.message || 'Failed to update ticket' }, { status: 500 });
  }
}

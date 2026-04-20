// @ts-nocheck
/**
 * POST /api/tickets/[id]/resolve
 *
 * Marks a ticket as "deployed" (fix is live in production).
 * Body: { resolution_note?: string, claude_commit_sha?: string, claude_pr_url?: string, actor?: string }
 *
 * Fires "your ticket is fixed" email to the submitter.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAgentOrUser } from '../../../lib/auth';
import { createServerClient } from '@/app/lib/supabase';
import { logTicketEvent, notifySubmitterStatus } from '../../../lib/tickets';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const resolution_note = body?.resolution_note ? String(body.resolution_note) : null;
    const claude_commit_sha = body?.claude_commit_sha ? String(body.claude_commit_sha) : null;
    const claude_pr_url = body?.claude_pr_url ? String(body.claude_pr_url) : null;
    const actor = body?.actor || 'claude';

    const sb = createServerClient();
    const { data: current, error: readErr } = await sb.from('tickets').select('*').eq('id', params.id).single();
    if (readErr || !current) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    const patch: Record<string, any> = {
      status: 'deployed',
      resolved_at: new Date().toISOString(),
    };
    if (resolution_note) patch.resolution_note = resolution_note;
    if (claude_commit_sha) patch.claude_commit_sha = claude_commit_sha;
    if (claude_pr_url) patch.claude_pr_url = claude_pr_url;

    const { data: updated, error: upErr } = await sb
      .from('tickets')
      .update(patch)
      .eq('id', params.id)
      .select()
      .single();

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    await logTicketEvent({
      sb,
      ticketId: params.id,
      actor,
      actorRole: actor === 'claude' ? 'agent' : 'owner',
      eventType: 'claude_deployed_fix',
      fromStatus: current.status,
      toStatus: 'deployed',
      note: resolution_note,
      metadata: { claude_commit_sha, claude_pr_url },
    });

    const emailResult = await notifySubmitterStatus(updated, current.status);
    if (emailResult.ok) {
      await logTicketEvent({
        sb,
        ticketId: params.id,
        actor: 'system',
        actorRole: 'system',
        eventType: 'email_sent',
        note: 'Resolution email sent to submitter',
        metadata: { recipient: updated.submitter_user_id, message_id: emailResult.id },
      });
    }

    return NextResponse.json({ ticket: updated });
  } catch (err: any) {
    console.error('[tickets resolve] error:', err?.message);
    return NextResponse.json({ error: err?.message || 'Resolve failed' }, { status: 500 });
  }
}

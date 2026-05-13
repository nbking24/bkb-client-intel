// @ts-nocheck
/**
 * GET   /api/marketing/fb-drafts/[id]  — draft detail + joined source post
 * PATCH /api/marketing/fb-drafts/[id]  — approve / edit / skip / mark posted
 *
 * Auth: user Bearer OR x-agent-token.
 *
 * PATCH body shape:
 *   { approval_status: 'approved' | 'edited' | 'skipped' | 'posted' | 'failed',
 *     approved_reply?: string,         // when Nathan edits before approving
 *     skip_reason?: string,            // when status -> skipped
 *     posted_comment_id?: string,      // when status -> posted
 *     posted_at?: string ISO,
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../lib/supabase';
import { validateAgentOrUser } from '../../../../lib/auth';

export const runtime = 'nodejs';

interface RouteCtx { params: { id: string }; }

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const draftId = params.id;

  const { data: draft, error: dErr } = await supabase
    .from('fb_drafts')
    .select('*')
    .eq('id', draftId)
    .maybeSingle();
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let sourcePost = null;
  if (draft.fb_post_id) {
    const { data: postRow } = await supabase
      .from('fb_posts')
      .select('*')
      .eq('fb_post_id', draft.fb_post_id)
      .maybeSingle();
    sourcePost = postRow || null;
  }

  // Parse the rationale field — Local Engagement packs metadata as JSON.
  let parsedRationale: any = null;
  if (draft.draft_rationale) {
    try { parsedRationale = JSON.parse(draft.draft_rationale); }
    catch { parsedRationale = { rationale: draft.draft_rationale }; }
  }

  return NextResponse.json({
    draft,
    source_post: sourcePost,
    parsed_rationale: parsedRationale,
  });
}

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const draftId = params.id;
  const body = await req.json();

  const { data: existing, error: getErr } = await supabase
    .from('fb_drafts')
    .select('*')
    .eq('id', draftId)
    .maybeSingle();
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates: any = {};
  const allowedStatuses = ['pending', 'approved', 'edited', 'skipped', 'posted', 'failed'];
  const nextStatus = body.approval_status;

  if (nextStatus) {
    if (!allowedStatuses.includes(nextStatus)) {
      return NextResponse.json({ error: 'Invalid approval_status' }, { status: 400 });
    }
    updates.approval_status = nextStatus;

    if (nextStatus === 'approved' || nextStatus === 'edited') {
      updates.approved_at = new Date().toISOString();
      updates.approved_by = auth.userId || 'unknown';
      // If Nathan tweaked the wording before approving, capture the edited version.
      if (body.approved_reply !== undefined) {
        updates.approved_reply = body.approved_reply || existing.drafted_reply;
      } else {
        // Approved as-drafted.
        updates.approved_reply = existing.drafted_reply;
      }
    }

    if (nextStatus === 'skipped') {
      if (body.skip_reason) updates.skip_reason = body.skip_reason;
    }

    if (nextStatus === 'posted') {
      updates.posted_at = body.posted_at || new Date().toISOString();
      if (body.posted_comment_id) updates.posted_comment_id = body.posted_comment_id;
    }

    if (nextStatus === 'failed') {
      if (body.skip_reason) updates.skip_reason = body.skip_reason;
    }
  } else {
    // No status change — allow plain edits to the approved_reply (e.g. Nathan tweaks copy).
    if (body.approved_reply !== undefined) updates.approved_reply = body.approved_reply;
    if (body.skip_reason !== undefined) updates.skip_reason = body.skip_reason;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
  }

  const { data: updated, error: updErr } = await supabase
    .from('fb_drafts')
    .update(updates)
    .eq('id', draftId)
    .select()
    .maybeSingle();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Audit log
  if (nextStatus) {
    await supabase
      .from('marketing_events')
      .insert({
        agent: 'hub_user',
        event_type: 'fb_draft_' + nextStatus,
        entity_type: 'fb_draft',
        entity_id: draftId,
        outcome: 'success',
        detail: {
          prev_status: existing.approval_status,
          new_status: nextStatus,
          actor: auth.userId || 'unknown',
          edited: body.approved_reply !== undefined && body.approved_reply !== existing.drafted_reply,
        },
        occurred_at: new Date().toISOString(),
      })
      .catch(() => {});
  }

  return NextResponse.json({ success: true, draft: updated });
}

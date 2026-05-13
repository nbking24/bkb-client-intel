// @ts-nocheck
/**
 * GET   /api/marketing/social-calendar/drafts/[id]  — single post detail
 * PATCH /api/marketing/social-calendar/drafts/[id]  — approve / edit / skip / mark posted
 *
 * PATCH body:
 *   {
 *     approval_status?: 'approved' | 'edited' | 'skipped' | 'posted' | 'failed',
 *     approved_caption?: string,    // Nathan's edited copy
 *     hashtags?: string[],          // edited hashtags
 *     alt_text?: string,            // edited alt
 *     skip_reason?: string,
 *     posted_url?: string,
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
  const { data, error } = await supabase
    .from('social_post_drafts')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ post: data });
}

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const postId = params.id;
  const body = await req.json();

  const { data: existing, error: getErr } = await supabase
    .from('social_post_drafts')
    .select('*')
    .eq('id', postId)
    .maybeSingle();
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates: any = { updated_at: new Date().toISOString() };
  const allowed = ['pending', 'approved', 'edited', 'skipped', 'posted', 'failed'];
  const next = body.approval_status;

  if (next) {
    if (!allowed.includes(next)) return NextResponse.json({ error: 'Invalid approval_status' }, { status: 400 });
    updates.approval_status = next;
    if (next === 'approved' || next === 'edited') {
      updates.approved_at = new Date().toISOString();
      updates.approved_by = auth.userId || 'unknown';
      if (body.approved_caption !== undefined) updates.approved_caption = body.approved_caption || existing.caption;
      else updates.approved_caption = existing.caption;
    }
    if (next === 'skipped' || next === 'failed') {
      if (body.skip_reason) updates.skip_reason = body.skip_reason;
    }
    if (next === 'posted') {
      updates.posted_at = body.posted_at || new Date().toISOString();
      if (body.posted_url) updates.posted_url = body.posted_url;
    }
  } else {
    if (body.approved_caption !== undefined) updates.approved_caption = body.approved_caption;
  }
  if (Array.isArray(body.hashtags)) updates.hashtags = body.hashtags;
  if (body.alt_text !== undefined) updates.alt_text = body.alt_text;

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
  }

  const { data: updated, error: updErr } = await supabase
    .from('social_post_drafts')
    .update(updates)
    .eq('id', postId)
    .select()
    .maybeSingle();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  if (next) {
    await supabase
      .from('marketing_events')
      .insert({
        agent: 'hub_user',
        event_type: 'social_post_' + next,
        entity_type: 'social_post_draft',
        entity_id: postId,
        outcome: 'success',
        detail: {
          prev_status: existing.approval_status,
          new_status: next,
          platform: existing.platform,
          actor: auth.userId || 'unknown',
        },
        occurred_at: new Date().toISOString(),
      })
      .catch(() => {});
  }

  return NextResponse.json({ success: true, post: updated });
}

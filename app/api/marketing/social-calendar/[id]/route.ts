// @ts-nocheck
/**
 * GET   /api/marketing/social-calendar/[id]  — week detail + ordered posts
 * PATCH /api/marketing/social-calendar/[id]  — update week status / theme / caveat / notes
 *
 * The week id (uuid). Status transitions: review → approved → scheduled → sent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../lib/supabase';
import { validateAgentOrUser } from '../../../lib/auth';

export const runtime = 'nodejs';

interface RouteCtx { params: { id: string }; }

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const weekId = params.id;

  const [weekRes, postsRes] = await Promise.all([
    supabase.from('social_calendar_weeks').select('*').eq('id', weekId).maybeSingle(),
    supabase
      .from('social_post_drafts')
      .select('*')
      .eq('week_id', weekId)
      .order('position', { ascending: true }),
  ]);

  if (weekRes.error) return NextResponse.json({ error: weekRes.error.message }, { status: 500 });
  if (!weekRes.data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let parsedNotes: any = null;
  if (weekRes.data.notes) {
    try { parsedNotes = JSON.parse(weekRes.data.notes); }
    catch { parsedNotes = { raw: weekRes.data.notes }; }
  }

  return NextResponse.json({
    week: weekRes.data,
    parsed_notes: parsedNotes,
    posts: postsRes.data || [],
  });
}

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const weekId = params.id;
  const body = await req.json();

  const { data: existing, error: getErr } = await supabase
    .from('social_calendar_weeks')
    .select('*')
    .eq('id', weekId)
    .maybeSingle();
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates: any = { updated_at: new Date().toISOString() };
  const allowedStatuses = ['drafting', 'review', 'approved', 'scheduled', 'sent', 'failed'];
  if (body.status) {
    if (!allowedStatuses.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    updates.status = body.status;
    if (body.status === 'approved') {
      updates.approved_at = new Date().toISOString();
      updates.approved_by = auth.userId || 'unknown';
    }
  }
  if (body.theme !== undefined) updates.theme = body.theme || null;
  if (body.caveat !== undefined) updates.caveat = body.caveat || null;
  if (body.notes !== undefined) {
    updates.notes = typeof body.notes === 'string' ? body.notes : JSON.stringify(body.notes);
  }

  const { error: updErr } = await supabase
    .from('social_calendar_weeks')
    .update(updates)
    .eq('id', weekId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  if (body.status) {
    await supabase
      .from('marketing_events')
      .insert({
        agent: 'hub_user',
        event_type: 'social_calendar_week_' + body.status,
        entity_type: 'social_calendar_week',
        entity_id: weekId,
        outcome: 'success',
        detail: { prev_status: existing.status, new_status: body.status, actor: auth.userId || 'unknown' },
        occurred_at: new Date().toISOString(),
      })
      .catch(() => {});
  }

  return NextResponse.json({ success: true });
}

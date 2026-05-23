// @ts-nocheck
/**
 * GET  /api/marketing/social-calendar          — list weeks (newest first), with post counts
 * POST /api/marketing/social-calendar          — agent creates a week + all its post drafts
 *
 * Auth: user Bearer OR x-agent-token.
 *
 * POST body:
 *   {
 *     week_of: '2026-05-11',
 *     theme?: 'Modern Heritage Style',
 *     caveat?: 'No new JobTread photos in 2026...',
 *     notes?: { ... structured agent notes },
 *     posts: [
 *       {
 *         scheduled_day?: '2026-05-12',
 *         scheduled_time?: '5pm ET',
 *         platform: 'instagram'|'facebook'|'google_business',
 *         format: 'carousel'|'single_image'|'long_form'|'reel'|'video'|'text_only',
 *         topic?: 'Edwards pool house',
 *         caption: '...',
 *         hashtags?: ['#bucksco', '#furlong'],
 *         alt_text?: '...',
 *         photos?: [{ path?, jobtread_id?, caption?, alt? }],
 *       }, ...
 *     ]
 *   }
 *
 * The POST upserts on week_of — re-running for the same week replaces ALL posts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAgentOrUser } from '../../lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get('limit') || 20), 200);

  const supabase = getSupabase();
  const { data: weeks, error } = await supabase
    .from('social_calendar_weeks')
    .select('*')
    .order('week_of', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Add per-week counts of pending / approved / posted drafts
  const weekIds = (weeks || []).map((w) => w.id);
  let counts: Record<string, any> = {};
  if (weekIds.length > 0) {
    const { data: posts } = await supabase
      .from('social_post_drafts')
      .select('week_id, approval_status')
      .in('week_id', weekIds);
    for (const p of posts || []) {
      const k = p.week_id;
      counts[k] ||= { total: 0, pending: 0, approved: 0, posted: 0, skipped: 0 };
      counts[k].total++;
      if (p.approval_status === 'pending') counts[k].pending++;
      else if (p.approval_status === 'approved' || p.approval_status === 'edited') counts[k].approved++;
      else if (p.approval_status === 'posted') counts[k].posted++;
      else if (p.approval_status === 'skipped' || p.approval_status === 'failed') counts[k].skipped++;
    }
  }

  const enriched = (weeks || []).map((w) => ({ ...w, counts: counts[w.id] || { total: 0 } }));
  return NextResponse.json({ weeks: enriched });
}

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  if (!body?.week_of) {
    return NextResponse.json({ error: 'week_of required (YYYY-MM-DD, Monday)' }, { status: 400 });
  }
  if (!Array.isArray(body.posts) || body.posts.length === 0) {
    return NextResponse.json({ error: 'posts[] required and non-empty' }, { status: 400 });
  }

  const supabase = getSupabase();
  const nowIso = new Date().toISOString();

  // Upsert the week
  const weekRow = {
    week_of: body.week_of,
    theme: body.theme || null,
    caveat: body.caveat || null,
    notes: body.notes ? JSON.stringify(body.notes) : null,
    status: 'review',
    drafted_by_agent: body.drafted_by_agent || 'cowork-content-strategist',
    drafted_at: nowIso,
    updated_at: nowIso,
  };

  const { data: existing } = await supabase
    .from('social_calendar_weeks')
    .select('id, status, approved_at, approved_by')
    .eq('week_of', body.week_of)
    .maybeSingle();

  let weekId: string;
  if (existing) {
    // Preserve approval if already approved — don't downgrade to review on agent re-run.
    const updateRow = existing.status === 'approved' || existing.status === 'sent'
      ? { theme: weekRow.theme, caveat: weekRow.caveat, notes: weekRow.notes, updated_at: nowIso }
      : weekRow;
    const { error: updErr } = await supabase
      .from('social_calendar_weeks')
      .update(updateRow)
      .eq('id', existing.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    weekId = existing.id;

    // Wipe and re-insert posts for idempotency
    await supabase.from('social_post_drafts').delete().eq('week_id', weekId);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('social_calendar_weeks')
      .insert(weekRow)
      .select('id')
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    weekId = inserted.id;
  }

  // Insert all posts
  const postRows = body.posts.map((p: any, idx: number) => ({
    week_id: weekId,
    position: p.position ?? idx,
    scheduled_day: p.scheduled_day || null,
    scheduled_time: p.scheduled_time || null,
    scheduled_at: p.scheduled_at || null,
    platform: p.platform,
    format: p.format,
    topic: p.topic || null,
    caption: p.caption || '',
    hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
    alt_text: p.alt_text || null,
    photos: p.photos ? JSON.stringify(p.photos) : '[]',
    approval_status: 'pending',
  }));

  const { error: postsErr } = await supabase.from('social_post_drafts').insert(postRows);
  if (postsErr) return NextResponse.json({ error: postsErr.message }, { status: 500 });

  try {
  await supabase
    .from('marketing_events')
    .insert({
      agent: 'content_strategist',
      event_type: 'social_calendar_drafted',
      entity_type: 'social_calendar_week',
      entity_id: weekId,
      outcome: 'success',
      detail: {
        week_of: body.week_of,
        post_count: postRows.length,
        actor: auth.userId || 'agent',
      },
      occurred_at: nowIso,
    })
    ;
  } catch { /* swallow logging failures */ }

  return NextResponse.json({
    success: true,
    week_id: weekId,
    post_count: postRows.length,
    review_url: `/dashboard/marketing/social-calendar`,
  });
}

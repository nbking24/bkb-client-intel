// @ts-nocheck
/**
 * GET  /api/marketing/fb-drafts            — list drafts (newest first, joined with source posts)
 * POST /api/marketing/fb-drafts            — agent posts a new draft + source post
 *
 * Auth: user Bearer OR x-agent-token.
 *
 * POST body:
 *   {
 *     source_post: {
 *       fb_post_id: 'fb_123',              // unique identifier for the source FB thread
 *       group_id?: 'bucks-co-moms',
 *       group_name?: 'Bucks County Moms',
 *       author_name?: 'Sarah K.',
 *       author_fb_id?: '...',
 *       post_url: 'https://facebook.com/...',
 *       post_text: 'Original post body',
 *       post_posted_at?: '2026-05-12T14:30:00Z',
 *       topic_match?: ['kitchen', 'older home'],
 *       never_reply_flag?: false,
 *       never_reply_reason?: null
 *     },
 *     draft: {
 *       drafted_reply: '...',
 *       draft_rationale: 'Direct ask, BKB has authentic expertise...',
 *       suggested_attribution?: 'Nathan personal',
 *       confidence?: 'High'
 *     }
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAgentOrUser } from '../../lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status'); // pending / approved / posted / skipped
  const limit = Math.min(Number(sp.get('limit') || 100), 500);

  const supabase = getSupabase();

  // Fetch drafts, then enrich with source post text (Supabase doesn't auto-join via FK
  // in the JS client without typed schema; do two queries + merge).
  let draftsQuery = supabase
    .from('fb_drafts')
    .select('*')
    .order('drafted_at', { ascending: false })
    .limit(limit);
  if (status) draftsQuery = draftsQuery.eq('approval_status', status);

  const { data: drafts, error: dErr } = await draftsQuery;
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  const fbPostIds = Array.from(new Set((drafts || []).map((d) => d.fb_post_id)));
  let posts: any[] = [];
  if (fbPostIds.length > 0) {
    const { data: postRows, error: pErr } = await supabase
      .from('fb_posts')
      .select('*')
      .in('fb_post_id', fbPostIds);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    posts = postRows || [];
  }

  const postMap = new Map(posts.map((p) => [p.fb_post_id, p]));
  const enriched = (drafts || []).map((d) => ({
    ...d,
    source_post: postMap.get(d.fb_post_id) || null,
  }));

  return NextResponse.json({ drafts: enriched });
}

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { source_post, draft } = body || {};

  if (!source_post?.fb_post_id || !source_post?.post_url) {
    return NextResponse.json(
      { error: 'source_post.fb_post_id and source_post.post_url required' },
      { status: 400 }
    );
  }
  if (!draft?.drafted_reply) {
    return NextResponse.json({ error: 'draft.drafted_reply required' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Upsert fb_posts
  const { error: upPostErr } = await supabase.from('fb_posts').upsert(
    {
      fb_post_id: source_post.fb_post_id,
      group_id: source_post.group_id || null,
      group_name: source_post.group_name || null,
      author_name: source_post.author_name || null,
      author_fb_id: source_post.author_fb_id || null,
      post_url: source_post.post_url,
      post_text: source_post.post_text || null,
      post_posted_at: source_post.post_posted_at || null,
      topic_match: source_post.topic_match || null,
      never_reply_flag: source_post.never_reply_flag || false,
      never_reply_reason: source_post.never_reply_reason || null,
    },
    { onConflict: 'fb_post_id' }
  );
  if (upPostErr) return NextResponse.json({ error: upPostErr.message }, { status: 500 });

  // Pack agent metadata (attribution, confidence, etc.) into the rationale text as JSON
  // so the dashboard can parse it back.
  const rationaleBlob = JSON.stringify({
    text: draft.draft_rationale || null,
    suggested_attribution: draft.suggested_attribution || null,
    confidence: draft.confidence || null,
    voice_note: draft.voice_note || null,
    open_questions: draft.open_questions || null,
  });

  const { data: insDraft, error: insErr } = await supabase
    .from('fb_drafts')
    .insert({
      fb_post_id: source_post.fb_post_id,
      drafted_reply: draft.drafted_reply,
      draft_rationale: rationaleBlob,
      drafted_at: new Date().toISOString(),
      drafted_by_agent: draft.drafted_by_agent || 'cowork-local-engagement',
      approval_status: 'pending',
    })
    .select('id')
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  await supabase
    .from('marketing_events')
    .insert({
      agent: 'local_engagement',
      event_type: 'fb_draft_created',
      entity_type: 'fb_draft',
      entity_id: insDraft.id,
      outcome: 'success',
      detail: {
        fb_post_id: source_post.fb_post_id,
        group_name: source_post.group_name,
        actor: auth.userId || 'agent',
      },
      occurred_at: new Date().toISOString(),
    })
    .catch(() => {});

  return NextResponse.json({
    success: true,
    draft_id: insDraft.id,
    review_url: `/dashboard/marketing/facebook`,
  });
}

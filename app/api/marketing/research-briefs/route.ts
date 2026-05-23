// @ts-nocheck
/**
 * GET  /api/marketing/research-briefs               — list (newest first), optional ?type=weekly_trends
 * POST /api/marketing/research-briefs               — agent posts a new brief; upserts on (brief_type, brief_date)
 *
 * Auth: user Bearer OR x-agent-token.
 *
 * POST body:
 *   {
 *     brief_type: 'weekly_trends' | 'seasonal_ideas' | 'aspirational_firms' | 'foundation_study' | 'other',
 *     brief_date: 'YYYY-MM-DD',
 *     title?: 'Week of May 9-15, 2026 — Modern Heritage Style hits the press',
 *     summary?: '1-2 sentence headline takeaway',
 *     content_markdown: 'Full markdown body of the brief',
 *     highlights?: [{ headline, why_it_matters, source_url }],
 *     sources?: [{ name, url, date }]
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
  const type = sp.get('type');
  const limit = Math.min(Number(sp.get('limit') || 20), 100);

  const supabase = getSupabase();
  let q = supabase
    .from('research_briefs')
    .select('id, brief_type, brief_date, title, summary, drafted_at, drafted_by_agent, highlights, sources')
    .order('brief_date', { ascending: false })
    .limit(limit);
  if (type) q = q.eq('brief_type', type);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ briefs: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  if (!body?.brief_type || !body?.brief_date) {
    return NextResponse.json({ error: 'brief_type and brief_date required' }, { status: 400 });
  }

  const supabase = getSupabase();
  const nowIso = new Date().toISOString();

  const row = {
    brief_type: body.brief_type,
    brief_date: body.brief_date,
    title: body.title || null,
    summary: body.summary || null,
    content_markdown: body.content_markdown || null,
    highlights: body.highlights ? JSON.stringify(body.highlights) : null,
    sources: body.sources ? JSON.stringify(body.sources) : null,
    drafted_by_agent: body.drafted_by_agent || 'cowork-content-researcher',
    drafted_at: nowIso,
    updated_at: nowIso,
  };

  const { data: existing } = await supabase
    .from('research_briefs')
    .select('id')
    .eq('brief_type', body.brief_type)
    .eq('brief_date', body.brief_date)
    .maybeSingle();

  let briefId: string;
  if (existing) {
    const { error: updErr } = await supabase
      .from('research_briefs')
      .update(row)
      .eq('id', existing.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    briefId = existing.id;
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('research_briefs')
      .insert(row)
      .select('id')
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    briefId = inserted.id;
  }

  try {
  await supabase
    .from('marketing_events')
    .insert({
      agent: 'content_researcher',
      event_type: 'research_brief_' + body.brief_type,
      entity_type: 'research_brief',
      entity_id: briefId,
      outcome: 'success',
      detail: { brief_date: body.brief_date, title: body.title || null, actor: auth.userId || 'agent' },
      occurred_at: nowIso,
    })
    ;
  } catch { /* swallow logging failures */ }

  return NextResponse.json({
    success: true,
    brief_id: briefId,
    view_url: `/dashboard/marketing/research-briefs/${briefId}`,
  });
}

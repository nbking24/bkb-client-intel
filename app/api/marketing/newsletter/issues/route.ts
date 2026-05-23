// @ts-nocheck
/**
 * GET  /api/marketing/newsletter/issues      — list newsletter issues (newest first)
 * POST /api/marketing/newsletter/issues      — create a new issue from the Cowork Newsletter Writer agent
 *
 * Auth:
 *   - User Bearer token (validateAgentOrUser → user path)
 *   - Or x-agent-token matching TICKET_AGENT_TOKEN env (agent path, for Cowork)
 *
 * POST body (from the Newsletter Writer agent):
 *   {
 *     issue_month: '2026-06-01',
 *     theme: 'Modern Heritage Style',
 *     featured_project_jt_id: '22P5qEW5VPq5',
 *     author_voice: 'Nathan' | 'Brett',
 *     subject_line_options: [{ text, pattern, why, preview }, ...],
 *     sections: [
 *       { section_type, title, body_markdown, image_url, position, ... }
 *     ],
 *     notes_for_nathan: '...'
 *   }
 *
 *   Agent always creates with status='review' so issues appear in the approval queue.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../lib/supabase';
import { validateAgentOrUser } from '../../../lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const limit = Math.min(Number(sp.get('limit') || 50), 200);

  const supabase = getSupabase();
  let query = supabase
    .from('newsletter_issues')
    .select('*')
    .order('issue_month', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ issues: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    issue_month,
    theme,
    featured_project_jt_id,
    author_voice,
    subject_line_options,
    sections,
    notes_for_nathan,
  } = body || {};

  if (!issue_month) {
    return NextResponse.json({ error: 'issue_month required (YYYY-MM-01)' }, { status: 400 });
  }
  if (!Array.isArray(sections) || sections.length === 0) {
    return NextResponse.json({ error: 'sections array required' }, { status: 400 });
  }

  const supabase = getSupabase();

  const notesBlob = JSON.stringify({
    author_voice: author_voice || null,
    subject_line_options: subject_line_options || [],
    agent_notes: notes_for_nathan || null,
    created_by_agent: 'cowork-newsletter-writer',
    created_by_agent_at: new Date().toISOString(),
  });

  const { data: existing, error: existErr } = await supabase
    .from('newsletter_issues')
    .select('id')
    .eq('issue_month', issue_month)
    .maybeSingle();
  if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });

  let issueId: string;

  if (existing?.id) {
    issueId = existing.id;
    const { error: updErr } = await supabase
      .from('newsletter_issues')
      .update({
        status: 'review',
        theme: theme || null,
        featured_project_jt_id: featured_project_jt_id || null,
        notes: notesBlob,
        curator_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', issueId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    await supabase.from('newsletter_sections').delete().eq('issue_id', issueId);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('newsletter_issues')
      .insert({
        issue_month,
        status: 'review',
        theme: theme || null,
        featured_project_jt_id: featured_project_jt_id || null,
        notes: notesBlob,
        curator_run_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    issueId = inserted.id;
  }

  const sectionRows = sections.map((s: any, idx: number) => ({
    issue_id: issueId,
    section_type: s.section_type || 'body',
    position: s.position ?? idx,
    applies_to_segments: s.applies_to_segments || [],
    title: s.title || null,
    body_markdown: s.body_markdown || null,
    body_html: s.body_html || null,
    image_url: s.image_url || null,
    cta_label: s.cta_label || null,
    cta_url: s.cta_url || null,
  }));

  const { error: sectErr } = await supabase.from('newsletter_sections').insert(sectionRows);
  if (sectErr) return NextResponse.json({ error: sectErr.message }, { status: 500 });

  try {
  await supabase
    .from('marketing_events')
    .insert({
      agent: 'newsletter_writer',
      event_type: 'newsletter_issue_created',
      entity_type: 'newsletter_issue',
      entity_id: issueId,
      outcome: 'success',
      detail: { issue_month, theme, sections_count: sectionRows.length, actor: auth.userId || 'agent' },
      occurred_at: new Date().toISOString(),
    })
    ;
  } catch { /* swallow logging failures */ }

  return NextResponse.json({
    success: true,
    issue_id: issueId,
    issue_month,
    sections_count: sectionRows.length,
    review_url: `/dashboard/marketing/newsletter/${issueId}`,
  });
}

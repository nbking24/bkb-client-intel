// @ts-nocheck
/**
 * GET   /api/marketing/newsletter/issues/[id]  — issue detail + sections + sends
 * PATCH /api/marketing/newsletter/issues/[id]  — update issue fields, status, or sections
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
  const issueId = params.id;

  const [issueRes, sectionsRes, sendsRes] = await Promise.all([
    supabase.from('newsletter_issues').select('*').eq('id', issueId).maybeSingle(),
    supabase
      .from('newsletter_sections')
      .select('*')
      .eq('issue_id', issueId)
      .order('position', { ascending: true }),
    supabase.from('newsletter_sends').select('*').eq('issue_id', issueId),
  ]);

  if (issueRes.error) return NextResponse.json({ error: issueRes.error.message }, { status: 500 });
  if (!issueRes.data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let parsedNotes: any = null;
  if (issueRes.data.notes) {
    try { parsedNotes = JSON.parse(issueRes.data.notes); }
    catch { parsedNotes = { raw: issueRes.data.notes }; }
  }

  return NextResponse.json({
    issue: issueRes.data,
    parsed_notes: parsedNotes,
    sections: sectionsRes.data || [],
    sends: sendsRes.data || [],
  });
}

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const issueId = params.id;
  const body = await req.json();

  const { data: existing, error: getErr } = await supabase
    .from('newsletter_issues')
    .select('*')
    .eq('id', issueId)
    .maybeSingle();
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates: any = { updated_at: new Date().toISOString() };

  if (body.status) {
    updates.status = body.status;
    if (body.status === 'approved') {
      updates.approved_at = new Date().toISOString();
      updates.approved_by = auth.userId || 'unknown';
    }
  }

  if (body.theme !== undefined) updates.theme = body.theme || null;
  if (body.featured_project_jt_id !== undefined)
    updates.featured_project_jt_id = body.featured_project_jt_id || null;

  if (body.notes !== undefined || body.chosen_subject_line !== undefined) {
    let notesObj: any = {};
    if (existing.notes) {
      try { notesObj = JSON.parse(existing.notes); }
      catch { notesObj = { raw: existing.notes }; }
    }
    if (body.notes !== undefined) {
      try {
        const parsed = JSON.parse(body.notes);
        notesObj = { ...notesObj, ...parsed };
      } catch {
        notesObj.user_notes = body.notes;
      }
    }
    if (body.chosen_subject_line !== undefined) {
      notesObj.chosen_subject_line = body.chosen_subject_line;
    }
    updates.notes = JSON.stringify(notesObj);
  }

  const { error: updErr } = await supabase
    .from('newsletter_issues')
    .update(updates)
    .eq('id', issueId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  if (Array.isArray(body.sections)) {
    await supabase.from('newsletter_sections').delete().eq('issue_id', issueId);
    const rows = body.sections.map((s: any, idx: number) => ({
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
    const { error: insErr } = await supabase.from('newsletter_sections').insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  if (body.status) {
    try {
    await supabase
      .from('marketing_events')
      .insert({
        agent: 'hub_user',
        event_type: 'newsletter_issue_' + body.status,
        entity_type: 'newsletter_issue',
        entity_id: issueId,
        outcome: 'success',
        detail: { prev_status: existing.status, new_status: body.status, actor: auth.userId || 'unknown' },
        occurred_at: new Date().toISOString(),
      })
      ;
    } catch { /* swallow logging failures */ }
  }

  return NextResponse.json({ success: true });
}

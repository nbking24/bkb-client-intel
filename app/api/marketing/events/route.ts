// @ts-nocheck
/**
 * POST /api/marketing/events  — agents log activity (roundups, runs, errors)
 *
 * Body shape:
 *   {
 *     agent: 'project_monitor',
 *     event_type: 'weekly_roundup_complete',
 *     entity_type?: 'roundup',
 *     entity_id?: '2026-05-13',
 *     outcome?: 'success' | 'skipped' | 'failed',
 *     detail?: { ... arbitrary }
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAgentOrUser } from '../../lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  if (!body?.agent || !body?.event_type) {
    return NextResponse.json({ error: 'agent and event_type required' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('marketing_events')
    .insert({
      agent: body.agent,
      event_type: body.event_type,
      entity_type: body.entity_type || null,
      entity_id: body.entity_id || null,
      outcome: body.outcome || 'success',
      detail: body.detail || null,
      occurred_at: body.occurred_at || new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, event_id: data.id });
}

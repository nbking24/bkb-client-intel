// @ts-nocheck
/**
 * GET /api/marketing/research-briefs/[id]  — full brief including markdown body
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
  const { data, error } = await supabase
    .from('research_briefs')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let highlights = null, sources = null;
  if (data.highlights) { try { highlights = JSON.parse(data.highlights); } catch { highlights = data.highlights; } }
  if (data.sources)    { try { sources = JSON.parse(data.sources);       } catch { sources = data.sources; } }

  return NextResponse.json({ brief: { ...data, highlights, sources } });
}

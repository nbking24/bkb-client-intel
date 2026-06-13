// @ts-nocheck
/**
 * POST /api/raffle/contacted
 *
 * Mark a raffle entry as followed-up (or undo). Admin-only.
 *
 * Body: { id: string; contacted?: boolean; notes?: string }
 *   contacted: true  -> set contacted_at = now(), contacted_by = userId
 *   contacted: false -> clear contacted_at / contacted_by (undo)
 *   notes: optional free-form notes (overwrites)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAuth } from '../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 });

  const contacted = body.contacted !== false;       // default to marking contacted
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : undefined;

  const patch: Record<string, any> = {};
  if (contacted) {
    patch.contacted_at = new Date().toISOString();
    patch.contacted_by = auth.userId || 'unknown';
  } else {
    patch.contacted_at = null;
    patch.contacted_by = null;
  }
  if (notes !== undefined) patch.contact_notes = notes;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('raffle_entries')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id, name, contacted_at, contacted_by, contact_notes')
    .single();

  if (error) return NextResponse.json({ error: 'update_failed', detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry: data });
}

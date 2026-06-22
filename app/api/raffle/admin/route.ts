// @ts-nocheck
/**
 * /api/raffle/admin
 *
 * Owner/admin-only routes for the raffle:
 *
 *   GET     — full list of entries (with PII) for the admin page
 *   POST    — manually create an entry (source='admin_manual')
 *   PATCH   — update an entry's fields by id
 *   DELETE  — soft-delete an entry by id (?id=...)
 *
 * Bearer-token auth (same pattern as other admin endpoints).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { validateAuth } from '../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INTEREST_VALUES = new Set([
  'kitchen', 'bathroom', 'addition', 'interior',
  'exterior', 'landscaping', 'historic', 'other',
]);

function clean(s: any, max = 200): string | null {
  if (s == null) return null;
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function normalizePhone(s: string | null): string | null {
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 7) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function authed(req: NextRequest) {
  return validateAuth(req.headers.get('authorization')).valid;
}

// ============================================================
// GET: list all entries (admin view, with PII)
// ============================================================
export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('raffle_entries')
    .select('id, name, first_name, last_name, phone, email, contact_ok, interests, source, entered_by, is_winner, drawn_at, created_at, loop_contact_id, loop_synced_at, loop_sync_error, contacted_at, contacted_by, contact_notes')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'list_failed', detail: error.message }, { status: 500 });
  return NextResponse.json({ entries: data || [] });
}

// ============================================================
// POST: manually add an entry (admin form)
// Body: { name, phone?, email?, contact_ok?, interests?, entered_by? }
// ============================================================
export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const firstName = clean(body.first_name, 80);
  const lastName  = clean(body.last_name, 80);
  const nameRaw   = clean(body.name, 120);
  const name = (firstName || lastName)
    ? [firstName, lastName].filter(Boolean).join(' ')
    : nameRaw;
  const phone = normalizePhone(clean(body.phone, 40));
  const emailRaw = clean(body.email, 200);
  const email = emailRaw && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw) ? emailRaw.toLowerCase() : null;
  const contact_ok =
    body.contact_ok === true  ? true  :
    body.contact_ok === false ? false :
    null;
  const interests = Array.isArray(body.interests)
    ? body.interests.filter((x: any) => typeof x === 'string' && INTEREST_VALUES.has(x))
    : [];
  const entered_by = clean(body.entered_by, 80);

  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('raffle_entries')
    .insert({
      name,
      first_name: firstName,
      last_name:  lastName,
      phone, email, contact_ok, interests,
      source: 'admin_manual',
      entered_by,
    })
    .select('id, name, first_name, last_name, phone, email, contact_ok, interests, source, entered_by, is_winner, drawn_at, created_at, loop_contact_id, loop_synced_at, loop_sync_error, contacted_at, contacted_by, contact_notes')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'duplicate', message: 'A non-deleted entry already exists with that phone or email.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'insert_failed', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, entry: data });
}

// ============================================================
// PATCH: update an entry by id
// Body: { id, ...fields }
// ============================================================
export async function PATCH(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const id = clean(body.id, 60);
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 });

  const patch: Record<string, any> = {};
  if (typeof body.first_name === 'string')   patch.first_name = body.first_name.trim().slice(0, 80);
  if (typeof body.last_name === 'string')    patch.last_name  = body.last_name.trim().slice(0, 80);
  if (typeof body.name === 'string')         patch.name       = body.name.trim().slice(0, 120);
  // If first/last provided but no composed name, recompose
  if ((typeof body.first_name === 'string' || typeof body.last_name === 'string') &&
      typeof body.name !== 'string') {
    const f = (patch.first_name ?? '').trim();
    const l = (patch.last_name  ?? '').trim();
    if (f || l) patch.name = [f, l].filter(Boolean).join(' ');
  }
  if (typeof body.phone === 'string')       patch.phone = normalizePhone(body.phone);
  if (typeof body.email === 'string')       patch.email = body.email.trim().toLowerCase().slice(0, 200);
  if (typeof body.contact_ok === 'boolean') patch.contact_ok = body.contact_ok;
  if (Array.isArray(body.interests))        patch.interests = body.interests.filter((x: any) => typeof x === 'string' && INTEREST_VALUES.has(x));

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'no_fields_to_update' }, { status: 400 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('raffle_entries')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) return NextResponse.json({ error: 'update_failed', detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry: data });
}

// ============================================================
// DELETE: soft-delete an entry by id (?id=...)
// ============================================================
export async function DELETE(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase
    .from('raffle_entries')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: 'delete_failed', detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// @ts-nocheck
/**
 * POST /api/raffle/entry
 *
 * Public endpoint — no auth. Visitor-facing raffle sign-up form posts here
 * after a person scans the QR on the basket flyer / popcorn bag and fills
 * out the entry on /raffle/enter.
 *
 * Behavior:
 *   - Validates required fields (name + at least one of phone/email)
 *   - Dedupes by phone or email (case-insensitive). Returns 409 if already entered.
 *   - Inserts row with source='public_qr'
 *
 * Request body:
 *   {
 *     name: string,
 *     phone?: string,
 *     email?: string,
 *     contact_ok: boolean,            // "May we contact you about a project?"
 *     interests: string[]             // 8-checkbox list, may be empty
 *   }
 *
 * Response:
 *   200 { ok: true, id: uuid, contact_ok: boolean }
 *   400 missing/invalid input
 *   409 already entered
 *   500 server error
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INTEREST_VALUES = new Set([
  'kitchen',
  'bathroom',
  'addition',
  'interior',
  'exterior',
  'landscaping',
  'historic',
  'other',
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
  // strip everything but digits + leading +
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 7) return null;
  // 10-digit US → +1NNNNNNNNNN; 11-digit starting with 1 → +1NNNNNNNNNN
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function isValidEmail(s: string | null): boolean {
  if (!s) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const name = clean(body.name, 120);
  const phoneRaw = clean(body.phone, 40);
  const phone = normalizePhone(phoneRaw);
  const emailRaw = clean(body.email, 200);
  const email = emailRaw && isValidEmail(emailRaw) ? emailRaw.toLowerCase() : null;
  const contact_ok = body.contact_ok === true;
  const interests = Array.isArray(body.interests)
    ? body.interests.filter((x: any) => typeof x === 'string' && INTEREST_VALUES.has(x))
    : [];

  if (!name) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: 'email_required' }, { status: 400 });
  }
  if (emailRaw && !email) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Dedupe check — phone OR email matches an active entry
  const orParts: string[] = [];
  if (phone) orParts.push(`phone.eq.${encodeURIComponent(phone)}`);
  if (email) orParts.push(`email.eq.${encodeURIComponent(email)}`);

  if (orParts.length) {
    const { data: existing, error: dupErr } = await supabase
      .from('raffle_entries')
      .select('id, name, contact_ok')
      .or(orParts.join(','))
      .is('deleted_at', null)
      .limit(1);
    if (dupErr) {
      return NextResponse.json({ error: 'dedupe_check_failed', detail: dupErr.message }, { status: 500 });
    }
    if (existing && existing.length > 0) {
      return NextResponse.json(
        {
          error: 'already_entered',
          message: `You're already entered, ${existing[0].name}. Good luck!`,
          contact_ok: existing[0].contact_ok,
        },
        { status: 409 },
      );
    }
  }

  const userAgent = req.headers.get('user-agent') || null;
  const ipCountry = req.headers.get('x-vercel-ip-country') || null;

  const { data, error } = await supabase
    .from('raffle_entries')
    .insert({
      name,
      phone,
      email,
      contact_ok,
      interests,
      source: 'public_qr',
      user_agent: userAgent,
      ip_country: ipCountry,
    })
    .select('id, contact_ok')
    .single();

  if (error) {
    // Could be a race-condition unique violation. Normalize to 409.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'already_entered', message: "You're already entered. Good luck!" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'insert_failed', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id, contact_ok: data.contact_ok });
}

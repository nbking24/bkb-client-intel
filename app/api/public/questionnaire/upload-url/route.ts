// @ts-nocheck
/**
 * Signed upload URLs for questionnaire photos, so large phone photos go
 * straight to Supabase Storage instead of through Vercel's 4.5 MB body limit.
 * POST { batch?: uuid, files: [{ name, type, size }] } -> { batch, uploads: [{ path, signedUrl, token }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/app/lib/supabase';
import { BUCKET } from '@/app/lib/questionnaire';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX = 25 * 1024 * 1024;
const UUID_RE = /^[0-9a-f-]{36}$/;

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const batch = UUID_RE.test(body?.batch || '') ? body.batch : crypto.randomUUID();
  const files = (Array.isArray(body?.files) ? body.files : []).slice(0, 15);
  const sb = createServerClient();
  const uploads = [];
  for (const f of files) {
    if (Number(f?.size || 0) > MAX) { uploads.push({ name: f?.name, error: 'too large' }); continue; }
    const safe = String(f?.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const path = `${batch}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) { uploads.push({ name: f?.name, error: 'could not prepare upload' }); continue; }
    uploads.push({ name: f?.name, path, signedUrl: data.signedUrl, token: data.token });
  }
  return NextResponse.json({ batch, uploads });
}

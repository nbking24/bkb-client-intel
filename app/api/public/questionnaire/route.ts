// @ts-nocheck
/**
 * Public Project Questionnaire endpoint (no auth; the page is /start).
 *   GET  ?email=   -> { submitted: boolean }  (shows "We already have your answers")
 *   POST JSON      -> saves the submission, then tries to land it in JobTread now.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/app/lib/supabase';
import { pushSubmission, hasSubmitted } from '@/app/lib/questionnaire';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(req: NextRequest) {
  const email = (req.nextUrl.searchParams.get('email') || '').trim();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ submitted: false });
  try { return NextResponse.json({ submitted: await hasSubmitted(email) }); }
  catch { return NextResponse.json({ submitted: false }); }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  if (body?.website) return NextResponse.json({ ok: true }); // honeypot

  const name = String(body?.name || '').trim().slice(0, 200);
  const email = String(body?.email || '').trim().slice(0, 200);
  const phone = String(body?.phone || '').trim().slice(0, 50);
  if (!name || !EMAIL_RE.test(email)) return NextResponse.json({ error: 'Name and a valid email are required' }, { status: 400 });

  const types = Array.isArray(body?.projectTypes) ? body.projectTypes.map(String).slice(0, 8) : [];
  const answers: Record<string, any> = {};
  for (const [k, v] of Object.entries(body?.answers || {})) {
    if (typeof v === 'string') answers[k] = v.slice(0, 4000);
    else if (Array.isArray(v)) answers[k] = v.map((x) => String(x).slice(0, 300)).slice(0, 20);
  }
  if (!String(answers.not_working || '').trim()) return NextResponse.json({ error: 'Please tell us what isn\'t working' }, { status: 400 });

  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/questionnaire-uploads/`;
  const files = (Array.isArray(body?.files) ? body.files : [])
    .filter((f) => typeof f?.path === 'string' && /^[0-9a-f-]{36}\//.test(f.path))
    .slice(0, 30)
    .map((f) => ({ path: f.path, url: base + f.path, name: String(f.name || 'photo').slice(0, 150), type: String(f.type || '') || undefined }));

  const sb = createServerClient();
  const { data, error } = await sb.from('project_questionnaires').insert({
    name, email, phone: phone || null, project_types: types, answers, files,
    source: String(body?.source || '').slice(0, 100) || null,
  }).select('id').single();
  if (error || !data) return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 });

  const result = await pushSubmission(data.id);
  return NextResponse.json({ ok: true, status: result.status });
}

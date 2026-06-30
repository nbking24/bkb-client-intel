// @ts-nocheck
// POST /api/dashboard/briefing/dismiss — mark an email thread as "replied elsewhere"
//   body: { threadId, subject?, messageDate? }
// DELETE /api/dashboard/briefing/dismiss?threadId=... — undo a dismissal
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { createServerClient } from '@/app/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isNathan(auth: any): boolean {
  return auth?.valid && (auth.userId === 'nathan' || auth.role === 'owner');
}

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!isNathan(auth)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const threadId = body?.threadId;
    if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });
    const sb = createServerClient();
    const { error } = await sb.from('briefing_email_dismissals').upsert({
      gmail_thread_id: threadId,
      subject: body?.subject || null,
      dismissed_at: new Date().toISOString(),
      last_inbound_at: body?.messageDate || null,
      dismissed_by: auth.userId || 'nathan',
    }, { onConflict: 'gmail_thread_id' });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!isNathan(auth)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const threadId = new URL(req.url).searchParams.get('threadId');
    if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });
    const sb = createServerClient();
    const { error } = await sb.from('briefing_email_dismissals').delete().eq('gmail_thread_id', threadId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}

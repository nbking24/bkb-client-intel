// @ts-nocheck
/**
 * POST /api/marketing/photo-engine/ftp/upload
 *
 * Multipart form upload into a marketing folder on the designer's FTP server.
 * Fields:
 *   path  the target folder subpath (relative to the marketing root)
 *   file  the file to upload
 *
 * Owner/admin only.
 *
 * Style note: no em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { isConfigured, uploadFile } from '@/app/api/lib/ftp';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['owner', 'admin'].includes(auth.role || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!isConfigured()) {
    return NextResponse.json({ ok: false, error: 'FTP not configured' }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid form data' }, { status: 400 });
  }

  const path = String(form.get('path') || '');
  const file = form.get('file');

  if (!file || typeof (file as any).arrayBuffer !== 'function') {
    return NextResponse.json({ ok: false, error: 'file required' }, { status: 400 });
  }

  const name = (file as any).name || 'upload';
  const target = (path ? path.replace(/\/+$/, '') + '/' : '') + name;

  try {
    const buffer = Buffer.from(await (file as any).arrayBuffer());
    await uploadFile(target, buffer);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Upload failed' },
      { status: 500 }
    );
  }
}

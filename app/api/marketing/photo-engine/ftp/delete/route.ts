// @ts-nocheck
/**
 * POST /api/marketing/photo-engine/ftp/delete
 *
 * Delete a single file from a marketing folder on the designer's FTP server.
 * Body JSON:
 *   path  the file subpath (relative to the marketing root)
 *
 * Files only. Directories and empty paths are rejected. Owner/admin only.
 *
 * Style note: no em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { isConfigured, deleteFile } from '@/app/api/lib/ftp';

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

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const path = String(body?.path || '');
  if (!path || path.replace(/\\/g, '/').endsWith('/')) {
    return NextResponse.json({ ok: false, error: 'A file path is required' }, { status: 400 });
  }

  try {
    await deleteFile(path);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Delete failed' },
      { status: 500 }
    );
  }
}

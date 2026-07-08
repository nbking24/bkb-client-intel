// @ts-nocheck
/**
 * GET /api/marketing/photo-engine/ftp/list?path=<subpath>
 *
 * Lists the marketing folders and files on the web designer's FTP server, under
 * the configured root. Directories first, then files.
 *
 * If FTP is not configured, returns { configured: false, path: "", entries: [] }
 * so the UI can show a friendly notice instead of crashing. Any FTP failure is
 * returned as { configured: true, path, entries: [], error } with status 200.
 *
 * Owner/admin only.
 *
 * Style note: no em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { isConfigured, listPath } from '@/app/api/lib/ftp';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['owner', 'admin'].includes(auth.role || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!isConfigured()) {
    return NextResponse.json({ configured: false, path: '', entries: [] });
  }

  const path = req.nextUrl.searchParams.get('path') || '';

  try {
    const entries = await listPath(path);
    return NextResponse.json({ configured: true, path, entries });
  } catch (err: any) {
    return NextResponse.json({
      configured: true,
      path,
      entries: [],
      error: err?.message || 'Could not read that folder',
    });
  }
}

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
 * After a successful delete we record a permanent exclusion in
 * marketing_photo_assets so the scheduled photo engine never re-adds the same
 * JobTread source file on future runs. Manually uploaded files that have no
 * asset row simply match nothing, which is fine.
 *
 * Style note: no em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { isConfigured, deleteFile } from '@/app/api/lib/ftp';
import { getSupabase } from '@/app/api/lib/supabase';

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

    // Record a permanent exclusion for the matching asset. This must never
    // fail the delete: the file is already gone from FTP either way.
    let excluded = false;
    try {
      const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
      const folderName = segments[0] || '';
      const fileName = segments[segments.length - 1] || '';
      if (folderName && fileName) {
        const { data } = await getSupabase()
          .from('marketing_photo_assets')
          .update({ excluded: true, excluded_at: new Date().toISOString() })
          .eq('folder_name', folderName)
          .eq('ftp_filename', fileName)
          .select('id');
        excluded = Array.isArray(data) && data.length > 0;
      }
    } catch (exErr: any) {
      console.error('Failed to record photo exclusion:', exErr?.message || exErr);
    }

    return NextResponse.json({ ok: true, excluded });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Delete failed' },
      { status: 500 }
    );
  }
}

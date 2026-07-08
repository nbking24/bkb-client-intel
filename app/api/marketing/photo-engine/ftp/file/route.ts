// @ts-nocheck
/**
 * GET /api/marketing/photo-engine/ftp/file?path=<subpath>
 *
 * Downloads a single file from the designer's FTP server and returns it inline
 * with a Content-Type guessed from the file extension. The UI fetches this with
 * the Bearer token and opens the resulting blob in a new tab.
 *
 * Owner/admin only.
 *
 * Style note: no em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { downloadFile } from '@/app/api/lib/ftp';

export const runtime = 'nodejs';
export const maxDuration = 30;

function contentTypeFor(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return 'application/octet-stream';
  }
}

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['owner', 'admin'].includes(auth.role || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const path = req.nextUrl.searchParams.get('path') || '';
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 });

  const basename = path.split('/').pop() || 'file';

  try {
    const buffer = await downloadFile(path);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(basename),
        'Content-Disposition': `inline; filename="${basename.replace(/"/g, '')}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Could not download that file' },
      { status: 500 }
    );
  }
}

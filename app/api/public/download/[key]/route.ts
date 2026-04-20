// @ts-nocheck
/**
 * GET /api/public/download/[key]
 *
 * Serves a binary file previously stashed via /api/public/stash as base64.
 * The key maps to a stash entry whose `data` field is base64-encoded bytes.
 *
 * Query params:
 *   - filename: suggested filename for Content-Disposition (default: download.bin)
 *   - ct: content-type override (default: application/octet-stream, with sensible
 *     defaults for common extensions)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../lib/supabase';

export const runtime = 'nodejs';

const CT_BY_EXT: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  zip: 'application/zip',
  txt: 'text/plain; charset=utf-8',
};

function ctForFilename(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return CT_BY_EXT[ext] || 'application/octet-stream';
}

export async function GET(req: NextRequest, { params }: { params: { key: string } }) {
  const key = params.key;
  const { searchParams } = new URL(req.url);
  const filename = searchParams.get('filename') || 'download.bin';
  const ct = searchParams.get('ct') || ctForFilename(filename);

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('marketing_events')
    .select('detail')
    .eq('agent', 'stash')
    .eq('entity_id', key)
    .order('occurred_at', { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const b64 = data[0].detail?.data || '';
  const buf = Buffer.from(b64, 'base64');

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': ct,
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  });
}

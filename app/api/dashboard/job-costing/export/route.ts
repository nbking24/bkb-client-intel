// @ts-nocheck
/**
 * POST /api/dashboard/job-costing/export   Body: { jobId }
 *
 * Returns the job's Job Costing workbook (.xlsx): Costs by Group and Labor
 * Hours. Built on the server from exactly what the detail view shows, by
 * calling the detail endpoint itself (its saved snapshot, no refresh), so
 * the numbers and the "Data as of" time match the page.
 *
 * Signed in users only.
 *
 * Style note: no em or en dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { POST as detailPOST } from '../detail/route';
import { buildJobCostingWorkbook } from '@/app/lib/job-costing-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Sign in again, then retry the export.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const jobId = String(body.jobId || '');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  try {
    const res = await detailPOST(
      new Request(new URL('/api/dashboard/job-costing/detail', req.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
    );
    const detail: any = await res.json();
    if (detail?.error) return NextResponse.json({ error: detail.error }, { status: 502 });
    if (!Array.isArray(detail?.costCodeBreakdown) || detail.costCodeBreakdown.length === 0) {
      return NextResponse.json({ error: 'This job has no cost groups to export yet.' }, { status: 404 });
    }
    const { buffer, fileName } = await buildJobCostingWorkbook(detail);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Export failed: ' + (err?.message || err) }, { status: 500 });
  }
}

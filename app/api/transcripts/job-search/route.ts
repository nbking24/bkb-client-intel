// @ts-nocheck
/**
 * GET /api/transcripts/job-search?q=<text>
 *
 * Job lookup for the transcript confirm picker that is NOT limited to open
 * jobs. The picker's normal dropdown comes from getActiveJobs(), which filters
 * on closedOn = null — right for day-to-day, wrong when a meeting happens
 * after a job closes (a thank-you visit, a warranty call, a post-mortem). The
 * transcript still belongs on the original job, so this endpoint goes through
 * searchJobsByText(), which searches the whole job list — open and closed —
 * by job name, job number or client name.
 *
 * Returns at most 25 rows, open jobs first. Closed rows carry `closedOn` so
 * the UI can label them instead of making them look like live work.
 *
 * Auth: validateAuth only. This is a read of job names — the same list the
 * confirm dropdown already shows — so it needs no extra privilege.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { searchJobsByText } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (q.length < 2) return NextResponse.json({ query: q, jobs: [] });

  try {
    const rows = await searchJobsByText(q, 25);
    const jobs = rows.map((j) => ({
      id: j.id,
      name: j.name,
      number: j.number || null,
      clientName: j.clientName || '',
      closedOn: j.closedOn || null,
    }));
    return NextResponse.json({ query: q, jobs });
  } catch (err: any) {
    console.error('[api/transcripts/job-search]', err);
    return NextResponse.json({ error: err?.message || 'Job search failed' }, { status: 500 });
  }
}

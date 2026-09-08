// @ts-nocheck
/**
 * GET /api/dashboard/selections-sheet
 *
 * Internal (dashboard-auth) endpoint for the Client Selections Sheet tool.
 *
 *   GET  ?jobId=<id>   → { sheet, shareUrl } — the client-safe sheet data
 *                        for one job plus its tokened public link.
 *   GET  (no jobId)    → { jobs: [...] } — active jobs for the picker.
 *
 * The sheet data is client-safe by construction: register lines only,
 * no internal notes, no costs. See app/api/lib/selections-sheet.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../../lib/auth';
import {
  fetchSelectionsSheet,
  makeSheetToken,
} from '../../lib/selections-sheet';
import { getActiveJobs } from '../../lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get('jobId');

  try {
    if (!jobId) {
      const jobs = await getActiveJobs(100);
      jobs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return NextResponse.json({ jobs });
    }

    const sheet = await fetchSelectionsSheet(jobId);
    const origin = req.nextUrl.origin;
    const shareUrl = origin + '/s/' + makeSheetToken(jobId);
    return NextResponse.json({ sheet, shareUrl });
  } catch (err) {
    console.error('[SelectionsSheet] error:', err);
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to load selections sheet' },
      { status: 500 }
    );
  }
}

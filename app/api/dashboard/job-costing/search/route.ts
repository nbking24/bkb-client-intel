// @ts-nocheck
/**
 * GET /api/dashboard/job-costing/search?q=<query>
 *
 * Free-text search across every job in JobTread — including closed
 * ones. Powers the "search past jobs" control on the job-costing
 * dashboard so Nathan can pull up a historical job for ad-hoc costing
 * analysis without the index loading every job in the org by default.
 *
 * Returns id, name, number, custom status, closed date, client name,
 * and price type so the UI can render meaningful result rows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { searchJobsByText } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() || '';
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }
  try {
    const results = await searchJobsByText(q, 25);
    return NextResponse.json({ results });
  } catch (err: any) {
    console.error('[job-costing/search] error:', err?.message || err);
    return NextResponse.json(
      { error: err?.message || 'Search failed' },
      { status: 500 }
    );
  }
}

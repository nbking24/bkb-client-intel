// @ts-nocheck
/**
 * GET /api/cron/job-costing-refresh
 *
 * Nightly recompute of the job-costing summary cache.
 *
 * Why this exists: the Job Costing page never auto-refreshes on load (that
 * was deliberate — a full JobTread scan takes ~30s and Nathan asked the
 * page to open instantly from the cached snapshot). The side effect was
 * that the cache only ever updated when somebody clicked Refresh, so it
 * had gone 20 days stale, and every consumer of it — the Job Costing list
 * and the Company Financials per-job drawer — was quietly showing old
 * numbers.
 *
 * Recomputing on a schedule keeps the instant page load AND fresh figures:
 * the pages still read the snapshot, the snapshot is just never old.
 *
 * Implemented as a thin self-call to the existing refresh path so the
 * compute logic stays in one place (that route owns computeSummaries +
 * writeCache).
 *
 * Auth: Bearer CRON_SECRET, same as the other cron routes.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The full JT scan measured ~30s; allow generous headroom for a slow day.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(`${req.nextUrl.origin}/api/dashboard/job-costing?refresh=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: body?.error || `Refresh failed (${res.status})` },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      jobs: Array.isArray(body?.summaries) ? body.summaries.length : null,
      cachedAt: body?.cachedAt || null,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err: any) {
    console.error('[cron/job-costing-refresh] failed:', err?.message || err);
    return NextResponse.json({ ok: false, error: err?.message || 'unknown' }, { status: 500 });
  }
}

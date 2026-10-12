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
 * Calls the existing refresh handler directly (in-process, not over HTTP)
 * so the compute logic stays in one place (that route owns computeSummaries +
 * writeCache).
 *
 * Auth: Bearer CRON_SECRET, same as the other cron routes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { POST as refreshJobCosting } from '@/app/api/dashboard/job-costing/route';

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
    // Call the refresh handler in-process. The old self-call over HTTP never
    // landed a refresh: the cache sat at 18 Sep 12:50 UTC (a manual Refresh,
    // not this 09:00 run) until another manual Refresh on 12 Oct, while the
    // same refresh takes about 6 s when called directly. In-process removes
    // the HTTP hop, whatever was stopping it.
    const res = await refreshJobCosting(
      new NextRequest(new URL('/api/dashboard/job-costing?refresh=1', req.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      }),
    );
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

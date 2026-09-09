// @ts-nocheck
/**
 * POST /api/dashboard/company-financials/snapshot
 *
 * Ingest endpoint for the owner-only Company Financials dashboard.
 *
 * The Hub cannot query QuickBooks itself (no QB OAuth here — QB is only
 * reachable from a Cowork session holding the QB MCP connection), so a
 * scheduled Claude task pulls the figures and POSTs them here. This route
 * validates the shape, then upserts the payload into
 * company_financials_snapshot under key 'current'.
 *
 * Auth: Bearer CRON_SECRET, or the App-PIN base64 fallback used by the
 * other cron endpoints.
 *
 * Body: the full dashboard payload (see EXPECTED SHAPE below). Anything
 * extra is stored as-is so the task can add fields without a Hub deploy.
 *
 * EXPECTED SHAPE (all money in dollars, all periods inclusive):
 * {
 *   asOf: '2026-09-09',                 // QB data date
 *   fiscalYear: 2026,
 *   ytd:      { periodStart, periodEnd, revenue, cogs, overhead, netIncome },
 *   priorYtd: { ...same, for the same calendar window last year },
 *   years:    [ { year, revenue, cogs, overhead, netIncome } ],   // full years
 *   goal:     { year, revenue, cogs, overhead, netIncome },
 *   months:   [ { month: '2026-01', revenue, cogs, overhead, net } ],
 *   overheadCategories: [ { label, amount } ],
 *   ownerDraws: { ytd, priorYearEndBalance, currentBalance },
 *   position: { cash, accountsReceivable, accountsPayable, workingCapital,
 *               currentRatio, debtToEquity, equity, billingsInExcess,
 *               priorYearEnd: { cash, accountsReceivable, workingCapital, currentRatio } },
 *   receivables: { total, over90, topCustomers: [ { name, amount } ], note },
 *   payables:    { total, over90, topVendors:   [ { name, amount } ] }
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/app/api/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  const appPin = process.env.APP_PIN;
  if (appPin) {
    const expected = `Bearer ${Buffer.from(appPin + ':').toString('base64')}`;
    if (authHeader === expected) return true;
  }
  // When neither secret is configured, refuse rather than fail open.
  return false;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Minimum viable payload: we need a YTD block with a revenue figure,
  // otherwise the page has nothing to lead with.
  const ytd = body?.ytd;
  if (!ytd || typeof ytd.revenue !== 'number') {
    return NextResponse.json(
      { error: 'Payload must include ytd.revenue (number). See route docs for the expected shape.' },
      { status: 400 },
    );
  }

  const payload = {
    ...body,
    asOf: body.asOf || new Date().toISOString().slice(0, 10),
    ingestedAt: new Date().toISOString(),
  };

  const sb = getSupabase();
  const { error } = await sb
    .from('company_financials_snapshot')
    .upsert(
      {
        key: 'current',
        payload,
        computed_at: new Date().toISOString(),
        source: body.source || 'cowork-scheduled-task',
      },
      { onConflict: 'key' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, asOf: payload.asOf });
}

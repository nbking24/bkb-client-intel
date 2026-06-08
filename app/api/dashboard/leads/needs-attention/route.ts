// @ts-nocheck
/**
 * GET /api/dashboard/leads/needs-attention
 *
 * Thin route wrapper; the bucketing lives in @/app/lib/leads-needs-attention
 * so the dashboard and the uncontacted-lead-alerts cron classify identically.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { computeLeadsNeedsAttention } from '@/app/lib/leads-needs-attention';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await computeLeadsNeedsAttention();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to compute needs-attention' },
      { status: 502 },
    );
  }
}

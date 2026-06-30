// @ts-nocheck
// GET /api/dashboard/briefing — returns the latest pre-computed briefing payload.
// Owner-only (Nathan). Read-only.
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getLatestBriefing } from '@/app/lib/daily-briefing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isNathan(auth: any): boolean {
  return auth?.valid && (auth.userId === 'nathan' || auth.role === 'owner');
}

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!isNathan(auth)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const row = await getLatestBriefing();
    if (!row) return NextResponse.json({ payload: null });
    return NextResponse.json({ payload: row.payload, generatedAt: row.generated_at, briefingDate: row.briefing_date });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}

// @ts-nocheck
/**
 * GET /api/dashboard/bill-review/budget-items?jobId=XXX
 *
 * Returns every job-level budget item on the job that's a valid target for
 * re-linking a bill line — i.e. excludes JT's auto "Uncategorized XX ..."
 * placeholder buckets (we never want to route a bill from one placeholder
 * onto another).
 *
 * Used by the searchable picker on the bill-review queue so the user can
 * pick ANY approved budget item, not just the top 5 candidates the matcher
 * suggested.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getJobBudgetItems } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  try {
    const items = await getJobBudgetItems(jobId);
    const filtered = items
      .filter((b: any) => !/^uncategorized\b/i.test((b.name || '').trim()))
      .map((b: any) => ({
        id: b.id,
        name: b.name || null,
        costCodeId: b.costCodeId || null,
        costCodeNumber: b.costCodeNumber || null,
        costCodeName: b.costCodeName || null,
        cost: Number(b.cost) || 0,
      }))
      // Sort by cost code number then by name for predictable scanning
      .sort((a, b) => {
        const aCc = a.costCodeNumber || 'zz';
        const bCc = b.costCodeNumber || 'zz';
        if (aCc !== bCc) return aCc.localeCompare(bCc);
        return (a.name || '').localeCompare(b.name || '');
      });

    return NextResponse.json({ items: filtered });
  } catch (err: any) {
    console.error('[bill-review/budget-items] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Failed to load budget items' }, { status: 500 });
  }
}

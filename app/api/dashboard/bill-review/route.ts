// @ts-nocheck
/**
 * GET /api/dashboard/bill-review
 *
 * Returns pending bill-review rows for the overview / review dashboard
 * (plus optional counts, last scan timestamp, and per-job rollup).
 *
 * Query params:
 *   issueType=uncategorized|miscategorized|budget_gap    filter
 *   jobId=<jt job id>                                     filter
 *   limit=<n>                                             default 100
 *   includeStats=1                                        append scan stats
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const supabase = getSupabase();

  const issueType = req.nextUrl.searchParams.get('issueType');
  const jobId = req.nextUrl.searchParams.get('jobId');
  const limit = Math.min(500, Number(req.nextUrl.searchParams.get('limit') || 100));
  const includeStats = req.nextUrl.searchParams.get('includeStats') === '1';

  let query = supabase
    .from('bill_review_queue')
    .select('*')
    .eq('status', 'pending')
    .order('first_seen_at', { ascending: true })
    .limit(limit);

  if (issueType) query = query.eq('issue_type', issueType);
  if (jobId) query = query.eq('job_id', jobId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const response: any = { rows: data || [] };

  if (includeStats) {
    // Pending counts by issue_type
    const { data: counts } = await supabase
      .from('bill_review_queue')
      .select('issue_type')
      .eq('status', 'pending');
    const byType: Record<string, number> = {
      uncategorized: 0,
      miscategorized: 0,
      budget_gap: 0,
    };
    for (const r of counts || []) {
      if (r.issue_type in byType) byType[r.issue_type]++;
    }

    // Most recent scan run
    const { data: lastScan } = await supabase
      .from('bill_scan_runs')
      .select('started_at, finished_at, jobs_scanned, lines_scanned, newly_flagged, auto_cleared, error_count')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Per-job rollup of pending rows
    const { data: byJob } = await supabase
      .from('bill_review_queue')
      .select('job_id, job_name, job_number, issue_type')
      .eq('status', 'pending');
    const jobMap = new Map<string, any>();
    for (const r of byJob || []) {
      if (!jobMap.has(r.job_id)) {
        jobMap.set(r.job_id, {
          jobId: r.job_id,
          jobName: r.job_name,
          jobNumber: r.job_number,
          uncategorized: 0,
          miscategorized: 0,
          budgetGap: 0,
          total: 0,
        });
      }
      const row = jobMap.get(r.job_id);
      row.total++;
      if (r.issue_type === 'uncategorized') row.uncategorized++;
      else if (r.issue_type === 'miscategorized') row.miscategorized++;
      else if (r.issue_type === 'budget_gap') row.budgetGap++;
    }

    response.stats = {
      pendingTotal: (counts || []).length,
      pendingByType: byType,
      byJob: [...jobMap.values()].sort((a, b) => b.total - a.total),
      lastScan,
    };
  }

  return NextResponse.json(response);
}

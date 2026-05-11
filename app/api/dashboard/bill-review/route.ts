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

  // Include both 'pending' (waiting for review) and 'failed' (a prior apply
  // attempt failed in JT — the line is still uncategorized and needs another
  // try). 'failed' rows surface a retry-indicator in the UI so they don't
  // silently disappear from view after a transient JT error.
  let query = supabase
    .from('bill_review_queue')
    .select('*')
    .in('status', ['pending', 'failed'])
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
    // Pending counts by issue_type (counts both pending and failed since
    // both surface in the queue UI).
    const { data: counts } = await supabase
      .from('bill_review_queue')
      .select('issue_type')
      .in('status', ['pending', 'failed']);
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

    // Per-job rollup (pending + failed since both surface in the queue UI)
    const { data: byJob } = await supabase
      .from('bill_review_queue')
      .select('job_id, job_name, job_number, issue_type')
      .in('status', ['pending', 'failed']);
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
      // Alphabetical by job name so the filter dropdown is easy to scan;
      // ties fall back to job number then pending count.
      byJob: [...jobMap.values()].sort((a, b) =>
        (a.jobName || '').localeCompare(b.jobName || '') ||
        (a.jobNumber || '').localeCompare(b.jobNumber || '') ||
        (b.total - a.total)
      ),
      lastScan,
    };
  }

  return NextResponse.json(response);
}

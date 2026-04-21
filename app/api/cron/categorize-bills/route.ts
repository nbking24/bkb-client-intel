// @ts-nocheck
/**
 * Bill Categorization Cron — nightly 4am Eastern (0 9 * * * UTC)
 *
 * For each active job:
 *   1. Pull every vendor-bill line in JT via MCP/PAVE
 *   2. Pull the job's approved budget items
 *   3. Classify each line (uncategorized / miscategorized / budget_gap / good)
 *   4. Match unclassified lines to candidate budget items
 *   5. Upsert flagged rows into bill_review_queue
 *   6. Auto-dismiss stale rows
 *
 * The scan NEVER mutates JT. Nathan approves from the review card
 * and the approval endpoint (/api/dashboard/bill-review) is what
 * actually writes back to JT.
 *
 * Auth: CRON_SECRET bearer, same as other crons on this deployment.
 *       Also supports ?trigger=manual with the same bearer so Nathan
 *       can force a run from the UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import {
  getActiveJobs,
  getJobBillLines,
  getJobBudgetItems,
} from '@/app/lib/jobtread';
import {
  scanJobBills,
  loadAllPatterns,
  type ScanJobResult,
} from '@/app/lib/bill-categorization';

export const runtime = 'nodejs';
export const maxDuration = 300;  // this scan can take a while on a full org

// Jobs flagged with these custom statuses are considered "active" enough
// to care about bill categorization. Historic / archived / lost jobs
// would just generate noise. Uses StatusCategoryKey values from
// constants.ts. Leads (no bills yet) and Design (pre-construction) are
// skipped; scans run on jobs that are actively spending.
const SCAN_STATUS_CATEGORIES = new Set<string>([
  'READY',
  'IN_PRODUCTION',
  'FINAL_BILLING',
]);

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const trigger = (req.nextUrl.searchParams.get('trigger') as 'cron' | 'manual' | null) || 'cron';
  const startedAt = new Date();
  const supabase = getSupabase();

  // Start a run log row so we can track progress / failures.
  const { data: runRow, error: runInsertErr } = await supabase
    .from('bill_scan_runs')
    .insert({ started_at: startedAt.toISOString(), trigger })
    .select('id')
    .single();
  if (runInsertErr) {
    console.error('[CategorizeBills] failed to insert scan run:', runInsertErr.message);
  }
  const runId = runRow?.id || null;

  console.log('[CategorizeBills] start', { startedAt: startedAt.toISOString(), trigger });

  // Aggregate counters
  let jobsScanned = 0;
  let linesScanned = 0;
  let billsScanned = 0;
  let linesUncategorized = 0;
  let linesMiscategorized = 0;
  let linesBudgetGap = 0;
  let linesGood = 0;
  let newlyFlagged = 0;
  let autoCleared = 0;
  const errors: Array<{ jobId: string; jobName?: string; message: string }> = [];

  // Load learned patterns once — they apply across all jobs.
  let patterns: any[] = [];
  try {
    patterns = await loadAllPatterns(supabase);
  } catch (err: any) {
    console.error('[CategorizeBills] loadAllPatterns error:', err.message);
  }

  // Pull active jobs
  let jobs: any[] = [];
  try {
    jobs = await getActiveJobs(200);
  } catch (err: any) {
    errors.push({ jobId: '-', message: 'getActiveJobs failed: ' + err.message });
    jobs = [];
  }

  const perJobResults: ScanJobResult[] = [];

  for (const job of jobs) {
    // Skip non-construction jobs — they shouldn't drive the queue.
    if (job.statusCategory && !SCAN_STATUS_CATEGORIES.has(job.statusCategory)) {
      continue;
    }

    try {
      const [lines, budgetItems] = await Promise.all([
        getJobBillLines(job.id),
        getJobBudgetItems(job.id),
      ]);

      // Count bills per job (distinct doc ids)
      const docIds = new Set(lines.map(l => l.documentId));
      billsScanned += docIds.size;

      const result = await scanJobBills(
        supabase,
        { id: job.id, name: job.name, number: job.number },
        lines,
        budgetItems,
        patterns
      );
      perJobResults.push(result);

      jobsScanned++;
      linesScanned += result.linesScanned;
      linesUncategorized += result.linesUncategorized;
      linesMiscategorized += result.linesMiscategorized;
      linesBudgetGap += result.linesBudgetGap;
      linesGood += result.linesGood;
      newlyFlagged += result.newlyFlagged;
      autoCleared += result.autoCleared;
    } catch (err: any) {
      console.error('[CategorizeBills] job scan failed', job.id, err.message);
      errors.push({ jobId: job.id, jobName: job.name, message: err.message });
    }
  }

  const finishedAt = new Date();
  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    jobsScanned,
    billsScanned,
    linesScanned,
    linesUncategorized,
    linesMiscategorized,
    linesBudgetGap,
    linesGood,
    newlyFlagged,
    autoCleared,
    errorCount: errors.length,
  };

  if (runId) {
    await supabase
      .from('bill_scan_runs')
      .update({
        finished_at: finishedAt.toISOString(),
        jobs_scanned: jobsScanned,
        bills_scanned: billsScanned,
        lines_scanned: linesScanned,
        lines_uncategorized: linesUncategorized,
        lines_miscategorized: linesMiscategorized,
        lines_budget_gap: linesBudgetGap,
        lines_good: linesGood,
        newly_flagged: newlyFlagged,
        auto_cleared: autoCleared,
        error_count: errors.length,
        errors: errors.length ? errors : null,
      })
      .eq('id', runId);
  }

  console.log('[CategorizeBills] done', summary);

  return NextResponse.json({
    ...summary,
    errors,
    perJob: perJobResults.map(r => ({
      jobId: r.jobId,
      jobName: r.jobName,
      linesScanned: r.linesScanned,
      uncategorized: r.linesUncategorized,
      miscategorized: r.linesMiscategorized,
      budgetGap: r.linesBudgetGap,
      newlyFlagged: r.newlyFlagged,
    })),
  });
}

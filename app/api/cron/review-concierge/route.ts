// @ts-nocheck
/**
 * Review Concierge Cron — nightly scan
 *
 * Runs once/day. Scans JobTread for:
 *   1. Jobs whose status changed to "Complete" since last run → trigger 'completion'
 *   2. Jobs whose design phase wrapped since last run → trigger 'post_design'
 *
 * Nurture-pipeline-entry triggers come in via GHL webhook (not this cron).
 *
 * Protected by CRON_SECRET (Vercel sets this automatically for configured cron jobs).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';
import { processReviewTrigger } from '../../lib/marketing/review-concierge';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Name of the JobTread custom status we treat as "project complete"
// Can be overridden by env in case Nathan uses a different label
const COMPLETE_STATUS = process.env.JT_COMPLETE_STATUS || 'Complete';
const DESIGN_COMPLETE_STATUS =
  process.env.JT_DESIGN_COMPLETE_STATUS || 'Design Phase Complete';

export async function GET(req: NextRequest) {
  // Auth
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = new Date();
  console.log('[ReviewConcierge] cron start', startedAt.toISOString());

  const supabase = getSupabase();

  // Last run tracking via sync_state so we only look at new status changes
  const lastRunIso = await getLastRunIso(supabase);
  const sinceIso = lastRunIso || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  console.log('[ReviewConcierge] scanning since', sinceIso);

  let processed = 0;
  let queued = 0;
  let skipped = 0;
  let failed = 0;

  // Scan 1 — completion trigger
  try {
    const candidates = await findJobsWithRecentStatus(supabase, COMPLETE_STATUS, sinceIso);
    console.log('[ReviewConcierge] completion candidates:', candidates.length);
    for (const c of candidates) {
      if (!c.clientContactId) continue;
      const result = await processReviewTrigger({
        triggerType: 'completion',
        triggerSource: 'jobtread_status_change',
        clientContactId: c.clientContactId,
        jobtreadJobId: c.jobId,
        jobtreadAccountId: c.accountId,
        clientName: c.clientName,
        clientEmail: c.clientEmail,
        clientPhone: c.clientPhone,
        rawEventDetail: { statusName: COMPLETE_STATUS, changedAt: c.changedAt },
      });
      processed++;
      if (result.status === 'queued') queued++;
      else if (result.status === 'skipped') skipped++;
      else failed++;
    }
  } catch (err: any) {
    console.error('[ReviewConcierge] completion scan failed', err);
  }

  // Scan 2 — post-design trigger
  try {
    const candidates = await findJobsWithRecentStatus(
      supabase,
      DESIGN_COMPLETE_STATUS,
      sinceIso
    );
    console.log('[ReviewConcierge] post-design candidates:', candidates.length);
    for (const c of candidates) {
      if (!c.clientContactId) continue;
      const result = await processReviewTrigger({
        triggerType: 'post_design',
        triggerSource: 'jobtread_status_change',
        clientContactId: c.clientContactId,
        jobtreadJobId: c.jobId,
        jobtreadAccountId: c.accountId,
        clientName: c.clientName,
        clientEmail: c.clientEmail,
        clientPhone: c.clientPhone,
        rawEventDetail: { statusName: DESIGN_COMPLETE_STATUS, changedAt: c.changedAt },
      });
      processed++;
      if (result.status === 'queued') queued++;
      else if (result.status === 'skipped') skipped++;
      else failed++;
    }
  } catch (err: any) {
    console.error('[ReviewConcierge] post-design scan failed', err);
  }

  await setLastRunIso(supabase, startedAt.toISOString());

  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    processed,
    queued,
    skipped,
    failed,
  };
  console.log('[ReviewConcierge] done', summary);
  return NextResponse.json(summary);
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

async function getLastRunIso(supabase: any): Promise<string | null> {
  const { data } = await supabase
    .from('sync_state')
    .select('completed_at')
    .eq('entity_type', 'review_concierge_cron')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1);
  if (data && data.length > 0) return data[0].completed_at;
  return null;
}

async function setLastRunIso(supabase: any, iso: string) {
  await supabase.from('sync_state').insert({
    entity_type: 'review_concierge_cron',
    status: 'completed',
    completed_at: iso,
    items_processed: 0,
    initiated_by: 'cron',
  });
}

/**
 * Find JobTread jobs whose custom_status matches the given name AND whose
 * status last changed since `sinceIso`.
 *
 * Expects the Client Hub's JobTread cache to contain jobs with `custom_status`
 * and a `status_changed_at` column. If that column isn't present yet,
 * this function returns an empty list (safe no-op until the cache is extended).
 *
 * The returned shape includes client contact info resolved from the cache.
 */
async function findJobsWithRecentStatus(
  supabase: any,
  statusName: string,
  sinceIso: string
): Promise<
  Array<{
    jobId: string;
    accountId?: string;
    clientContactId?: string;
    clientName?: string;
    clientEmail?: string;
    clientPhone?: string;
    changedAt?: string;
  }>
> {
  // Try querying a jobs cache. Multiple naming conventions exist in the repo,
  // so we try the most likely ones in order.
  const tableCandidates = ['jt_jobs_cache', 'jobs_cache', 'jt_jobs'];
  for (const table of tableCandidates) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('custom_status', statusName)
      .gte('status_changed_at', sinceIso)
      .limit(500);
    if (!error && data) {
      return data.map((row: any) => ({
        jobId: row.job_id || row.id,
        accountId: row.account_id,
        clientContactId: row.ghl_contact_id || row.client_contact_id,
        clientName: row.client_name,
        clientEmail: row.client_email,
        clientPhone: row.client_phone,
        changedAt: row.status_changed_at,
      }));
    }
  }
  // No matching cache table — return empty. Nathan's team can wire this up once
  // the cache schema is finalized.
  return [];
}

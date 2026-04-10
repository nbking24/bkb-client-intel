// @ts-nocheck
import { NextResponse } from 'next/server';
import { getActiveJobs, getJobActivitySummary } from '@/app/lib/jobtread';
import type { JobActivitySummary } from '@/app/lib/jobtread';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_KEY = () => process.env.GHL_API_KEY || '';
const GHL_LOC = () => process.env.GHL_LOCATION_ID || '';

const ESTIMATING_STAGE_ID = 'c4012dfe-bc76-4447-8947-96a9e846ff2b';

function ghlHeaders() {
  return {
    Authorization: `Bearer ${GHL_KEY()}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

async function ghlPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GHL POST ${res.status}`);
  return res.json();
}

/** Fetch all GHL opportunities via paginated POST search */
async function fetchEstimatingOpportunities(): Promise<any[]> {
  const allOpps: any[] = [];
  let startAfterId = '';
  let page = 0;

  while (page < 5) {
    const body: Record<string, unknown> = {
      locationId: GHL_LOC(),
      limit: 100,
    };
    if (startAfterId) body.startAfterId = startAfterId;

    const data = await ghlPost('/opportunities/search', body);
    const opps = data.opportunities || [];
    allOpps.push(...opps);

    if (opps.length < 100) break;
    startAfterId = opps[opps.length - 1]?.id || '';
    if (!startAfterId) break;
    page++;
  }

  // Filter to Estimating stage + open status
  return allOpps.filter(
    (o: any) => o.pipelineStageId === ESTIMATING_STAGE_ID && o.status === 'open'
  );
}

export interface EstimatingJob {
  ghlOpportunityId: string;
  ghlName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  daysInEstimating: number;
  enteredEstimatingAt: string;
  // JT-sourced fields (null if no matching JT job found)
  jtJobId: string | null;
  jtJobName: string | null;
  jtJobNumber: string | null;
  activity: JobActivitySummary | null;
}

export async function GET() {
  try {
    const now = new Date();

    // Fetch GHL estimating opportunities + JT active jobs in parallel
    const [estimatingOpps, activeJobs] = await Promise.all([
      fetchEstimatingOpportunities(),
      getActiveJobs(),
    ]);

    // Build name-based lookup for JT jobs (lowercase for fuzzy matching)
    const jtJobsByName = new Map<string, typeof activeJobs[0]>();
    for (const job of activeJobs) {
      jtJobsByName.set(job.name.toLowerCase().trim(), job);
    }

    // For each estimating opportunity, find matching JT job and get activity
    const results: EstimatingJob[] = [];

    // Process in parallel batches of 5 to avoid overwhelming JT API
    const BATCH_SIZE = 5;
    for (let i = 0; i < estimatingOpps.length; i += BATCH_SIZE) {
      const batch = estimatingOpps.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (opp: any) => {
          const oppName = (opp.name || '').toLowerCase().trim();
          const contactName = opp.contact
            ? `${opp.contact.firstName || ''} ${opp.contact.lastName || ''}`.trim()
            : opp.name || '';

          // Try to find matching JT job by name
          let jtJob = jtJobsByName.get(oppName) || null;

          // If no exact match, try partial matching (GHL name contained in JT name or vice versa)
          if (!jtJob) {
            for (const [jtName, job] of jtJobsByName) {
              if (jtName.includes(oppName) || oppName.includes(jtName)) {
                jtJob = job;
                break;
              }
            }
          }

          // Also try matching by client name
          if (!jtJob && contactName) {
            const contactLower = contactName.toLowerCase().trim();
            for (const [jtName, job] of jtJobsByName) {
              if (jtName.includes(contactLower) || job.clientName?.toLowerCase().includes(contactLower)) {
                jtJob = job;
                break;
              }
            }
          }

          // Fetch activity summary from JT if we found a match
          let activity: JobActivitySummary | null = null;
          if (jtJob) {
            try {
              activity = await getJobActivitySummary(jtJob.id);
            } catch (err) {
              console.error(`[EstimatingTracker] Activity fetch failed for ${jtJob.id}:`, err);
            }
          }

          // Calculate days in estimating
          const enteredAt = opp.lastStageChangeAt || opp.createdAt;
          const daysInEstimating = Math.floor(
            (now.getTime() - new Date(enteredAt).getTime()) / (1000 * 60 * 60 * 24)
          );

          return {
            ghlOpportunityId: opp.id,
            ghlName: opp.name || '',
            contactName,
            contactPhone: opp.contact?.phone || '',
            contactEmail: opp.contact?.email || '',
            daysInEstimating,
            enteredEstimatingAt: enteredAt,
            jtJobId: jtJob?.id || null,
            jtJobName: jtJob?.name || null,
            jtJobNumber: jtJob?.number || null,
            activity,
          };
        })
      );
      results.push(...batchResults);
    }

    // Sort: stale jobs first (most days since activity), then jobs with no JT match, then by days in estimating
    results.sort((a, b) => {
      // Jobs with no activity data → top priority (lost jobs)
      const aDays = a.activity?.daysSinceActivity ?? 999;
      const bDays = b.activity?.daysSinceActivity ?? 999;
      if (aDays !== bDays) return bDays - aDays; // most stale first
      return b.daysInEstimating - a.daysInEstimating;
    });

    return NextResponse.json({ jobs: results, count: results.length });
  } catch (err: any) {
    console.error('[EstimatingTracker] Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load estimating tracker' }, { status: 500 });
  }
}

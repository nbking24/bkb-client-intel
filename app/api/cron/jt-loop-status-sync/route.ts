// @ts-nocheck
/**
 * Cron: JobTread -> Loop status sync (the "close the loop" reverse sync).
 *
 * Once a lead is handed off (Loop stage "Meeting Set" -> a JobTread job is
 * created and its id written to the Loop opportunity's "JT Job ID" field),
 * the deal is managed in JobTread. This cron watches those linked JobTread
 * jobs and, when the job advances to the design phase or beyond (or is
 * closed / lost), moves the matching Loop opportunity to the Loop "Closed"
 * stage so it drops off the active sales board automatically.
 *
 * Mapping (confirmed with Nathan, Aug 2026 — "Design Phase and beyond"):
 *   JT Status = 5. Design Phase / 10. Ready / 6. In Production /
 *               7. Final Billing / 6.5 Ongoing-Punch / 11. Closed,
 *               OR the job is closed (closedOn set)   -> Loop Closed (won)
 *   JT Status = 8. Lost                                -> Loop Closed (lost)
 *   Everything earlier (Lead Contacted / Appt Scheduled / Pricing /
 *               Agreement Pending / On Hold)           -> leave in place
 *
 * Match key: the "JT Job ID" custom field on the Loop opportunity
 * (GjwWvbGyh7CQfGmFir5p) == the JobTread job id.
 *
 * Auth: Bearer CRON_SECRET, or Vercel's x-vercel-cron header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchAllActiveOpportunities } from '@/app/lib/leads-needs-attention';
import { getPipelines, updateOpportunity } from '@/app/lib/ghl';
import { getJob } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const JT_JOB_ID_FIELD = 'GjwWvbGyh7CQfGmFir5p'; // "JT Job ID" on opportunities
const CLOSED_STAGE_NAME = 'Closed';

// JobTread Status values that mean "design phase or beyond" -> Loop won-close.
const WON_STATUSES = new Set([
  '5. Design Phase',
  '10. Ready',
  '6. In Production',
  '6.5 Ongoing / Punch List',
  '7. Final Billing',
  '11. Closed',
]);
const LOST_STATUSES = new Set(['8. Lost']);

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') || '';
  if (expected && auth === `Bearer ${expected}`) return true;
  if (req.headers.get('x-vercel-cron')) return true;
  return false;
}

function readJtJobId(opp: any): string | null {
  const cfs = opp?.customFields;
  if (!Array.isArray(cfs)) return null;
  for (const cf of cfs) {
    if ((cf?.id || '') === JT_JOB_ID_FIELD) {
      const v = cf.fieldValueString ?? cf.value ?? '';
      const s = String(v).trim();
      if (s) return s;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = {
    checked: 0,
    linked: 0,
    movedWon: 0,
    movedLost: 0,
    skipped: 0,
    errors: [] as string[],
    moved: [] as Array<{ name: string; jtStatus: string | null; to: 'won' | 'lost' }>,
  };

  try {
    // Resolve the "Closed" stage id (robust to future renames).
    const pipelines = await getPipelines();
    let closedStageId = '';
    for (const p of pipelines) {
      for (const s of p.stages || []) {
        if ((s.name || '').trim() === CLOSED_STAGE_NAME) closedStageId = s.id;
      }
    }
    if (!closedStageId) {
      return NextResponse.json({ error: `Could not find a "${CLOSED_STAGE_NAME}" stage` }, { status: 500 });
    }

    const opps = await fetchAllActiveOpportunities();
    result.checked = opps.length;

    for (const opp of opps) {
      const stageName = (opp.pipelineStageName || opp.stageName || '').trim();
      if (stageName === CLOSED_STAGE_NAME) continue; // already closed in Loop

      const jtJobId = readJtJobId(opp);
      if (!jtJobId) continue; // not handed off yet
      result.linked++;

      try {
        const job = await getJob(jtJobId);
        if (!job) { result.skipped++; continue; }
        const status: string | null = job.customStatus || null;

        let decision: 'won' | 'lost' | null = null;
        if (status && LOST_STATUSES.has(status)) decision = 'lost';
        else if ((status && WON_STATUSES.has(status)) || job.closedOn) decision = 'won';

        if (!decision) { result.skipped++; continue; }

        await updateOpportunity(opp.id, {
          pipelineStageId: closedStageId,
          status: decision, // GHL: 'won' | 'lost'
        });

        if (decision === 'won') result.movedWon++; else result.movedLost++;
        result.moved.push({ name: opp.name || opp.contact?.name || opp.id, jtStatus: status, to: decision });
      } catch (err: any) {
        result.errors.push(`${opp.name || opp.id}: ${err?.message || 'update failed'}`);
      }
    }

    return NextResponse.json({ ok: true, ...result, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'sync failed', ...result }, { status: 500 });
  }
}

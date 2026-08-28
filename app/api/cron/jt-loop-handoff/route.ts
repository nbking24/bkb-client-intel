// @ts-nocheck
/**
 * Cron: Loop -> JobTread forward hand-off.
 *
 * Replaces the old Loop workflow that fired on the (now deleted) "Estimating"
 * stage. Watches for Loop opportunities that have reached "Meeting Set" (an
 * in-person meeting is booked) but do NOT yet have a JobTread job, and creates
 * the JobTread customer/contact/location/job, writing the JT job id back onto
 * the opportunity so the two stay linked.
 *
 * Safety: skips any lead that already has a JobTread job with a matching client
 * name (prevents duplicates if a prior write-back failed), and caps how many it
 * creates per run.
 *
 * Auth: Bearer CRON_SECRET, or Vercel's x-vercel-cron header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchAllActiveOpportunities } from '@/app/lib/leads-needs-attention';
import { getContact } from '@/app/lib/ghl';
import { searchJobsByText } from '@/app/lib/jobtread';
import { createJobTreadJobForLead } from '@/app/lib/jt-handoff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const HANDOFF_STAGE = 'Meeting Set';
const JT_JOB_ID_FIELD = 'GjwWvbGyh7CQfGmFir5p';
const MAX_PER_RUN = 10;
// Only hand off leads that ENTER Meeting Set after this deploy cutoff, so the
// automation never sweeps the pre-existing Meeting Set backlog. Leads that move
// into Meeting Set going forward get a fresh last-status-change timestamp.
const CUTOFF_MS = Date.parse('2026-08-28T02:00:00Z');

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') || '';
  if (expected && auth === `Bearer ${expected}`) return true;
  if (req.headers.get('x-vercel-cron')) return true;
  return false;
}

function enteredStageMs(opp: any): number {
  const cands = [opp?.lastStatusChangeAt, opp?.lastStageChangeAt, opp?.updatedAt, opp?.dateUpdated];
  let best = 0;
  for (const c of cands) {
    const t = c ? Date.parse(c) : 0;
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best; // 0 when no timestamp present -> treated as "unknown" (skipped)
}

function hasJtJobId(opp: any): boolean {
  const cfs = opp?.customFields;
  if (!Array.isArray(cfs)) return false;
  for (const cf of cfs) {
    if ((cf?.id || '') === JT_JOB_ID_FIELD) {
      const v = String(cf.fieldValueString ?? cf.value ?? '').trim();
      if (v) return true;
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = {
    candidates: 0,
    created: [] as Array<{ name: string; jobNumber?: string; jobId?: string }>,
    skippedExisting: [] as string[],
    errors: [] as string[],
  };

  try {
    const opps = await fetchAllActiveOpportunities();
    const candidates = opps.filter((o: any) => {
      const stage = (o.pipelineStageName || o.stageName || '').trim();
      return stage === HANDOFF_STAGE && !hasJtJobId(o) && enteredStageMs(o) >= CUTOFF_MS;
    });
    result.candidates = candidates.length;

    for (const opp of candidates) {
      if (result.created.length >= MAX_PER_RUN) break;
      const displayName = opp.name || opp.contact?.name || opp.id;
      try {
        const contactId = opp.contactId || opp.contact?.id;
        if (!contactId) { result.errors.push(`${displayName}: no contactId`); continue; }

        const c = (await getContact(contactId))?.contact || {};
        const fullName =
          [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
          c.name || opp.contact?.name || '';
        if (!fullName) { result.errors.push(`${displayName}: no contact name`); continue; }

        // Duplicate guard: is there already a JT job under this client name?
        const existing = (await searchJobsByText(fullName, 10)).find(
          (j: any) => (j.clientName || '').trim().toLowerCase() === fullName.toLowerCase()
        );
        if (existing) { result.skippedExisting.push(`${fullName} (JT #${existing.number})`); continue; }

        const res = await createJobTreadJobForLead({
          fullName,
          email: c.email || '',
          phone: c.phone || '',
          address: c.address1 || c.address || '',
          city: c.city || '',
          state: c.state || '',
          zip: c.postalCode || '',
          opportunityName: opp.name || '',
          ghlOpportunityId: opp.id,
        });
        if (res.ok) result.created.push({ name: fullName, jobNumber: res.jobNumber, jobId: res.jobId });
        else result.errors.push(`${fullName}: ${res.error || 'create failed'}`);
      } catch (err: any) {
        result.errors.push(`${displayName}: ${err?.message || 'error'}`);
      }
    }

    return NextResponse.json({ ok: true, ...result, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'handoff failed', ...result }, { status: 500 });
  }
}

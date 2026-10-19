// @ts-nocheck
/**
 * POST /api/dashboard/planning-meeting/setup
 *   { jobId? , jobNumber?, dryRun?: true }
 * Sets a job up with the planning structure copied from A-TEST PROJECT (#100):
 * 📋 Project Details budget group (the Job Plan), Project Gates (8 gates, unticked) and Planning Milestones (7 undated markers).
 * dryRun returns what the job has and what would be added, without writing,
 * plus the projected build block status (and the Job Plan's target start and length).
 *
 *   { jobId, action: 'block', start: 'YYYY-MM-DD', weeks: number, dateMarkers?: boolean }
 * Adds the projected build block to 🤖 PRODUCTION MILESTONES (refused if the job
 * already has production milestones) and optionally dates the undated gate markers.
 *
 *   { jobId, action: 'markers', start?: 'YYYY-MM-DD', replace?: boolean }
 * Dates the gate markers counted back from the build start on the schedule
 * (or `start`). Only undated markers unless replace is true.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pave } from '@/app/lib/jobtread';
import { authorize } from '@/app/lib/planning-meeting/store';
import { planSetup, runSetup, runBuildBlock, runDateMarkers } from '@/app/lib/planning-meeting/setup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const JT_ORG = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';

async function resolveJob(body: any): Promise<string | null> {
  if (body.jobId) return String(body.jobId);
  const n = String(body.jobNumber || '').replace(/[^0-9]/g, '');
  if (!n) return null;
  const d: any = await pave({ organization: { $: { id: JT_ORG() }, jobs: { $: { size: 5, where: { and: [['number', '=', n]] } }, nodes: { id: {} } } } });
  return d?.organization?.jobs?.nodes?.[0]?.id || null;
}

export async function POST(req: NextRequest) {
  const who = await authorize(req);
  if (!who.ok) return NextResponse.json({ error: who.error }, { status: who.status });
  const body = await req.json().catch(() => ({}));
  try {
    const jobId = await resolveJob(body);
    if (!jobId) return NextResponse.json({ error: 'No job with that number' }, { status: 404 });
    if (body.action === 'block') {
      const res = await runBuildBlock(jobId, String(body.start || ''), Number(body.weeks), body.dateMarkers !== false);
      const after = await planSetup(jobId);
      return NextResponse.json({ ok: true, ...res, block: after.block });
    }
    if (body.action === 'markers') {
      const res = await runDateMarkers(jobId, body.start ? String(body.start) : null, body.replace === true);
      const after = await planSetup(jobId);
      return NextResponse.json({ ok: true, ...res, block: after.block });
    }
    if (body.dryRun) {
      const plan = await planSetup(jobId);
      const missing = [!plan.has.plan && '📋 Project Details budget group (Job Plan)', !plan.has.gates && 'Project Gates (8 gates)', !plan.has.markers && 'Planning Milestones (7 markers)'].filter(Boolean);
      return NextResponse.json({ ok: true, ...plan, missing });
    }
    const res = await runSetup(jobId);
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    console.error('[planning-meeting setup]', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

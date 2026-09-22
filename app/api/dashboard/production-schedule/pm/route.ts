// @ts-nocheck
/**
 * POST /api/dashboard/production-schedule/pm
 *   body: { jobId: string, pm: string }   // pm = roster key ('evan', 'brett',
 *                                         //      'josh', 'nate') or '' / 'unassigned'
 *
 * Assigns the project manager for a job by writing JobTread's "Project
 * Manager" option custom field (22P5TA732Mu9). JobTread stays the system of
 * record — the Hub never keeps its own copy — so the assignment is visible
 * in JobTread dataviews and reports too, and the Production Schedule simply
 * re-reads it on the next load.
 *
 * Auth: validateAuth + (role owner OR 'jt_write' feature), same gate as the
 * baseline endpoint, because this writes to JobTread.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getEffectiveAccess } from '@/app/lib/access';
import { setJobProjectManager } from '@/app/lib/jobtread';
import { PM_LANES, resolvePm, isValidPmValue } from '@/app/lib/project-managers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getEffectiveAccess(auth.userId);
  const canWrite = access && (access.role === 'owner' || (access.features || []).includes('jt_write'));
  if (!canWrite) return NextResponse.json({ error: 'JobTread write access required' }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const jobId = String(body?.jobId || '').trim();
  const pmKey = String(body?.pm ?? '').trim();
  if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });

  // Accept either the roster key or the raw JobTread option value.
  const lane = PM_LANES.find((p) => p.key === pmKey);
  const value = lane ? lane.value : pmKey;
  if (!isValidPmValue(value)) {
    return NextResponse.json(
      { error: `Unknown project manager "${pmKey}". Expected one of: ${PM_LANES.map((p) => p.key).join(', ')}.` },
      { status: 400 },
    );
  }

  try {
    const saved = await setJobProjectManager(jobId, value);
    // Trust what JobTread echoed back, not what we sent.
    const pm = resolvePm(saved.value ?? value);
    return NextResponse.json({
      ok: true,
      jobId,
      projectManager: saved.value ?? null,
      pmKey: pm.key,
      pmLabel: pm.label,
      color: pm.color,
    });
  } catch (err: any) {
    console.error('[production-schedule/pm]', err);
    return NextResponse.json({ error: err?.message || 'Failed to set project manager' }, { status: 500 });
  }
}

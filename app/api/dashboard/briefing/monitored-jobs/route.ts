// @ts-nocheck
// Monitored-jobs config for the daily-log-gap check.
//   GET  — returns all active jobs joined with their monitor settings
//   POST — { jobId, jobName?, jobNumber?, expectLogs, frequencyPerWeek } upsert one job
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { createServerClient } from '@/app/lib/supabase';
import { getActiveJobs } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isNathan(auth: any): boolean {
  return auth?.valid && (auth.userId === 'nathan' || auth.role === 'owner');
}

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!isNathan(auth)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const sb = createServerClient();
    const [jobs, cfgRes] = await Promise.all([
      getActiveJobs().catch(() => []),
      sb.from('briefing_monitored_jobs').select('*'),
    ]);
    const cfg = new Map<string, any>();
    for (const r of cfgRes.data || []) cfg.set(r.jt_job_id, r);
    const rows = (jobs || []).map((j: any) => {
      const c = cfg.get(j.id);
      return {
        jobId: j.id,
        jobName: j.name,
        jobNumber: j.number,
        expectLogs: c?.expect_logs ?? false,
        frequencyPerWeek: c?.frequency_per_week ?? 2,
      };
    });
    rows.sort((a, b) => (b.expectLogs ? 1 : 0) - (a.expectLogs ? 1 : 0) || a.jobName.localeCompare(b.jobName));
    return NextResponse.json({ jobs: rows });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!isNathan(auth)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const b = await req.json();
    if (!b?.jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });
    const sb = createServerClient();
    const { error } = await sb.from('briefing_monitored_jobs').upsert({
      jt_job_id: b.jobId,
      job_name: b.jobName || null,
      job_number: b.jobNumber || null,
      expect_logs: !!b.expectLogs,
      frequency_per_week: Number(b.frequencyPerWeek) || 2,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId || 'nathan',
    }, { onConflict: 'jt_job_id' });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 });
  }
}

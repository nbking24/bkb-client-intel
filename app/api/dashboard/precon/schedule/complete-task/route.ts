// @ts-nocheck
/**
 * POST /api/dashboard/precon/schedule/complete-task
 *
 * Body: { taskId: string }
 *
 * Marks a JobTread task as 100% complete by writing progress=1.0 via
 * the PAVE updateTask mutation. Returns { ok: true } on success or a
 * 4xx/5xx with a useful error message on failure.
 *
 * This is the only write surface the Gantt has into JT today. Drag-
 * to-edit and create/delete are deliberately out of scope for now;
 * Nathan asked for the smallest interaction that gives day-to-day
 * value (closing out completed work without bouncing into JT), and
 * this is it. If/when we add more mutations we'll route them through
 * sibling endpoints in this folder rather than expanding this one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { updateTaskProgress } from '@/app/lib/jobtread';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const taskId: string | undefined = body?.taskId;
  if (!taskId || typeof taskId !== 'string') {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }
  try {
    await updateTaskProgress(taskId, 1.0);
    return NextResponse.json({ ok: true, taskId, progress: 1.0 });
  } catch (err: any) {
    console.error('[precon/schedule/complete-task] failed:', err?.message || err);
    return NextResponse.json(
      { error: err?.message || 'Failed to mark task complete in JobTread' },
      { status: 502 },
    );
  }
}

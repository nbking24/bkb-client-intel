// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../../lib/auth';
import { updateTaskProgress } from '@/app/lib/jobtread';

/**
 * POST /api/field-task-update
 * Quick task progress update for field staff dashboard.
 * Body: { taskId: string, progress: number }
 */
export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { taskId, progress } = await req.json();
    if (!taskId || progress === undefined) {
      return NextResponse.json({ error: 'taskId and progress required' }, { status: 400 });
    }

    await updateTaskProgress(taskId, progress);
    const label = progress === 1 ? 'complete' : progress === 0.5 ? 'in progress' : 'not started';
    return NextResponse.json({ success: true, message: 'Task marked as ' + label });
  } catch (err: any) {
    console.error('Field task update error:', err);
    return NextResponse.json({ error: err?.message || 'Update failed' }, { status: 500 });
  }
}

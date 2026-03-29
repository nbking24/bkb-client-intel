// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { updateTask } from '@/app/lib/jobtread';

/**
 * POST /api/field-schedule-task-update
 * Update a schedule task from the field dashboard.
 * Body: { taskId: string, completed?: boolean, endDate?: string }
 */
export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { taskId, completed, endDate } = await req.json();
    if (!taskId) {
      return NextResponse.json({ error: 'taskId required' }, { status: 400 });
    }

    const fields: any = {};

    // Mark as complete (progress = 1) or incomplete (progress = 0)
    if (completed !== undefined) {
      fields.progress = completed ? 1 : 0;
    }

    // Update the end date (due date)
    if (endDate !== undefined) {
      fields.endDate = endDate;
    }

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'No update fields provided' }, { status: 400 });
    }

    const result = await updateTask(taskId, fields);
    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    console.error('Field schedule task update error:', err);
    return NextResponse.json({ error: err?.message || 'Update failed' }, { status: 500 });
  }
}

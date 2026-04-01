// ============================================================
// Waiting On - Create & manage tracking tasks
//
// POST  - Create a new Waiting On task (prefix, Admin Tasks phase,
//          multi-assignee, optional initial comment)
// GET   - Fetch comments for a specific task (pass ?taskId=xxx)
// PUT   - Post a new comment on a Waiting On task
// PATCH - Update a Waiting On task (date change or mark complete)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getJobSchedule,
  createPhaseGroup,
  createPhaseTask,
  createComment,
  getCommentsForTarget,
  updateTask,
  updateTaskProgress,
} from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 30;

// -- POST: Create a Waiting On task --------------------------
export async function POST(req: NextRequest) {
  try {
    const {
      jobId,
      taskName,
      description,
      endDate,
      assigneeMembershipId,   // Who Terri is waiting on
      terriMembershipId,      // Terri's own membership ID
    } = await req.json();

    if (!jobId || !taskName || !assigneeMembershipId || !terriMembershipId) {
      return NextResponse.json(
        { error: 'jobId, taskName, assigneeMembershipId, and terriMembershipId are required' },
        { status: 400 }
      );
    }

    // 1. Find or create "Admin Tasks" phase
    const schedule = await getJobSchedule(jobId);
    if (!schedule) {
      return NextResponse.json(
        { error: 'Could not load job schedule' },
        { status: 404 }
      );
    }

    const allTasks = flattenTasks(schedule.phases);
    let phaseGroupId = '';

    const adminPhase = allTasks.find(
      (t: any) => t.isGroup && t.name.toLowerCase().replace(/\*/g, '').trim() === 'admin tasks'
    );

    if (adminPhase) {
      phaseGroupId = adminPhase.id;
    } else {
      const created = await createPhaseGroup({ jobId, name: 'Admin Tasks' });
      phaseGroupId = created.id;
    }

    // 2. Build formatted task name
    const formattedName = `\u23F3 ${taskName}`;

    // 3. Default due date: 3 business days from now if not provided
    const dueDate = endDate || getBusinessDaysFromNow(3);

    // 4. Create the task - assigned to both Terri and the person she's waiting on
    const uniqueIds = terriMembershipId === assigneeMembershipId
      ? [terriMembershipId]
      : [terriMembershipId, assigneeMembershipId];

    const result = await createPhaseTask({
      jobId,
      parentGroupId: phaseGroupId,
      name: formattedName,
      description: description || undefined,
      endDate: dueDate,
      assignedMembershipIds: uniqueIds,
    });

    // 5. If description provided, post it as the first comment for context
    if (description?.trim()) {
      try {
        await createComment({
          targetId: result.id,
          targetType: 'task',
          message: description.trim(),
          name: 'Terri King',
        });
      } catch (commentErr: any) {
        console.warn('Could not add initial comment:', commentErr.message);
      }
    }

    return NextResponse.json({
      success: true,
      task: result,
      formattedName,
      dueDate,
    });
  } catch (err: any) {
    console.error('Create waiting-on task failed:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to create waiting-on task' },
      { status: 500 }
    );
  }
}

// -- GET: Fetch comments for a task --------------------------
export async function GET(req: NextRequest) {
  try {
    const taskId = req.nextUrl.searchParams.get('taskId');
    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }
    const comments = await getCommentsForTarget(taskId, 'task', 50);
    return NextResponse.json({ comments });
  } catch (err: any) {
    console.error('Fetch task comments failed:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}

// -- PUT: Post a comment on a task ---------------------------
export async function PUT(req: NextRequest) {
  try {
    const { taskId, message, authorName } = await req.json();
    if (!taskId || !message) {
      return NextResponse.json({ error: 'taskId and message are required' }, { status: 400 });
    }
    const comment = await createComment({
      targetId: taskId,
      targetType: 'task',
      message,
      name: authorName || 'Terri King',
    });
    return NextResponse.json({ success: true, comment });
  } catch (err: any) {
    console.error('Post comment failed:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to post comment' },
      { status: 500 }
    );
  }
}

// -- PATCH: Update a Waiting On task (date or mark complete) --
export async function PATCH(req: NextRequest) {
  try {
    const { taskId, endDate, markComplete } = await req.json();
    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    // Update end date if provided
    if (endDate) {
      await updateTask(taskId, { endDate });
    }

    // Mark task as complete (progress = 1)
    if (markComplete) {
      await updateTaskProgress(taskId, 1);
    }

    return NextResponse.json({
      success: true,
      taskId,
      updated: { endDate: endDate || undefined, markComplete: markComplete || false },
    });
  } catch (err: any) {
    console.error('Update waiting-on task failed:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to update waiting-on task' },
      { status: 500 }
    );
  }
}

// -- Helpers -------------------------------------------------

function flattenTasks(tasks: any[]): any[] {
  const result: any[] = [];
  for (const t of tasks) {
    result.push(t);
    if (t.childTasks?.nodes?.length) {
      result.push(...flattenTasks(t.childTasks.nodes));
    }
  }
  return result;
}

/** Get a date string N business days from now (skip weekends) */
function getBusinessDaysFromNow(days: number): string {
  const d = new Date();
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().split('T')[0];
}

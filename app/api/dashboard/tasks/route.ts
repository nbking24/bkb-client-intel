import { NextRequest, NextResponse } from 'next/server';
import { getOpenTasksForMember, getAllOpenTasks, updateTaskProgress, pave } from '@/app/lib/jobtread';

// GET /api/dashboard/tasks?membershipId=xxx
// GET /api/dashboard/tasks?all=true  (Nathan's team view)
export async function GET(req: NextRequest) {
  try {
    const membershipId = req.nextUrl.searchParams.get('membershipId');
    const all = req.nextUrl.searchParams.get('all');

    let tasks;
    if (all === 'true') {
      tasks = await getAllOpenTasks();
    } else if (membershipId) {
      tasks = await getOpenTasksForMember(membershipId);
    } else {
      return NextResponse.json({ error: 'membershipId or all=true required' }, { status: 400 });
    }

    // Classify urgency — only mark 'urgent' (red) for truly overdue tasks
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const classified = tasks.map((task: any) => {
      let urgency: 'normal' | 'high' | 'urgent' = 'normal';

      if (task.endDate) {
        const deadline = new Date(task.endDate);
        deadline.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          urgency = 'urgent'; // Past due only
        } else if (diffDays <= 2) {
          urgency = 'high'; // Due today, tomorrow, or day after
        }
        // Everything else stays 'normal'
      }

      return { ...task, urgency };
    });

    // Sort: urgent first, then high, then normal. Within each, by endDate
    classified.sort((a: any, b: any) => {
      const order: Record<string, number> = { urgent: 0, high: 1, normal: 2 };
      if (order[a.urgency] !== order[b.urgency]) return order[a.urgency] - order[b.urgency];
      if (!a.endDate) return 1;
      if (!b.endDate) return -1;
      return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
    });

    return NextResponse.json({ tasks: classified, count: classified.length });
  } catch (err: any) {
    console.error('Dashboard tasks error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PATCH /api/dashboard/tasks
 * Update a task — supports completing (progress=1) and updating due date.
 * Body: { taskId: string, action: 'complete' | 'update', endDate?: string }
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskId, action, endDate } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    if (action === 'complete') {
      await updateTaskProgress(taskId, 1);
      return NextResponse.json({ success: true, taskId, action: 'completed' });
    }

    if (action === 'update') {
      // Build PAVE update params
      const params: any = { id: taskId };
      if (endDate) {
        params.endDate = endDate;
        // Also update startDate to match if task is a 1-day task
        params.startDate = endDate;
      }
      await pave({ updateTask: { $: params } });
      return NextResponse.json({ success: true, taskId, action: 'updated', endDate });
    }

    return NextResponse.json({ error: 'action must be "complete" or "update"' }, { status: 400 });
  } catch (err: any) {
    console.error('Dashboard task update error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

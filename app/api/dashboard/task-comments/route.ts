import { NextRequest, NextResponse } from 'next/server';
import { getTaskCommentsWithUser, createComment } from '@/app/lib/jobtread';

/**
 * GET /api/dashboard/task-comments?taskId=xxx
 * Lazy-load comments for a specific task. Only called when user expands comments.
 * Returns comments with author (userName) field.
 */
export async function GET(req: NextRequest) {
  try {
    const taskId = req.nextUrl.searchParams.get('taskId');
    if (!taskId) {
      return NextResponse.json({ error: 'taskId required' }, { status: 400 });
    }

    const comments = await getTaskCommentsWithUser(taskId, 50);

    // Sort oldest-first for chat-style display
    comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Debug: also try a direct PAVE query for the first comment to see what comes back
    let debug: any = null;
    if (comments.length > 0) {
      try {
        const { pave } = await import('@/app/lib/jobtread');
        const d = await pave({ comment: { $: { id: comments[0].id }, id: {}, message: {}, user: { name: {} } } });
        debug = d;
      } catch (e: any) {
        debug = { error: e.message };
      }
    }

    return NextResponse.json({ comments, count: comments.length, debug });
  } catch (err: any) {
    console.error('Task comments fetch error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/task-comments
 * Post a new comment on a task. JT handles notifying assigned members.
 * Body: { taskId, message, authorName }
 */
export async function POST(req: NextRequest) {
  try {
    const { taskId, message, authorName } = await req.json();

    if (!taskId || !message?.trim()) {
      return NextResponse.json({ error: 'taskId and message required' }, { status: 400 });
    }

    const result = await createComment({
      targetId: taskId,
      targetType: 'task',
      message: message.trim(),
      name: authorName || 'BKB Dashboard',
    });

    return NextResponse.json({ success: true, comment: result });
  } catch (err: any) {
    console.error('Task comment create error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

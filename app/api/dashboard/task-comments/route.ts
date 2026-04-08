import { NextRequest, NextResponse } from 'next/server';
import { getCommentsForTarget, createComment } from '@/app/lib/jobtread';

/**
 * GET /api/dashboard/task-comments?taskId=xxx
 * Lazy-load comments for a specific task. Only called when user expands comments.
 */
export async function GET(req: NextRequest) {
  try {
    const taskId = req.nextUrl.searchParams.get('taskId');
    if (!taskId) {
      return NextResponse.json({ error: 'taskId required' }, { status: 400 });
    }

    const comments = await getCommentsForTarget(taskId, 'task', 50);

    // Sort oldest-first for chat-style display
    comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return NextResponse.json({ comments, count: comments.length });
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

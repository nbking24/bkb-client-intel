import { NextRequest, NextResponse } from 'next/server';
import { getOpenTasksForMember, getAllOpenTasks } from '@/app/lib/jobtread';

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

    // Classify urgency
    const now = new Date();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;

    const classified = tasks.map((task: any) => {
      let urgency: 'normal' | 'high' | 'urgent' = 'normal';

      if (task.endDate) {
        const deadline = new Date(task.endDate);
        const daysUntil = deadline.getTime() - now.getTime();

        if (daysUntil < 0) {
          urgency = 'urgent'; // Past due
        } else if (daysUntil < twoDaysMs) {
          urgency = 'urgent'; // Within 2 days
        } else if (daysUntil < 5 * 24 * 60 * 60 * 1000) {
          urgency = 'high'; // Within 5 days
        }
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

// ============================================================
// AR Hold / Resume — Toggle automated AR reminders for a job
//
// POST { jobId, action: 'hold' | 'resume', reason?: string }
//   → Posts an internal-only [AR-HOLD] or [AR-RESUME] comment
//     on the job in JobTread.
//
// GET { jobId } (query param)
//   → Returns current hold status by scanning job comments.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { pave } from '@/app/lib/jobtread';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { jobId, action, reason } = await req.json();

    if (!jobId || !action) {
      return NextResponse.json(
        { error: 'jobId and action (hold/resume) are required' },
        { status: 400 }
      );
    }

    if (action !== 'hold' && action !== 'resume') {
      return NextResponse.json(
        { error: 'action must be "hold" or "resume"' },
        { status: 400 }
      );
    }

    const tag = action === 'hold' ? '[AR-HOLD]' : '[AR-RESUME]';
    const message = reason
      ? `${tag} ${reason}`
      : action === 'hold'
        ? `${tag} Automated AR reminders paused for this job.`
        : `${tag} Automated AR reminders resumed for this job.`;

    const data = await pave({
      createComment: {
        $: {
          targetId: jobId,
          targetType: 'job',
          message,
          name: action === 'hold' ? 'AR Reminders Paused' : 'AR Reminders Resumed',
        },
        createdComment: { id: {}, message: {}, createdAt: {} },
      },
    });

    const created = (data as any)?.createComment?.createdComment;
    if (!created?.id) {
      throw new Error('Failed to create comment: ' + JSON.stringify(data));
    }

    return NextResponse.json({
      success: true,
      action,
      commentId: created.id,
      isHeld: action === 'hold',
    });
  } catch (err: any) {
    console.error('[AR-Hold] Error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get('jobId');
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const resp = await pave({
      job: {
        $: { id: jobId },
        comments: {
          $: { size: 100 },
          nodes: {
            id: {}, message: {}, createdAt: {},
          },
        },
      },
    });

    const comments = (resp as any)?.job?.comments?.nodes || [];
    let lastHoldDate = 0;
    let lastResumeDate = 0;

    for (const c of comments) {
      const body = (c.message || '');
      if (/\[AR-HOLD\]/i.test(body)) {
        const d = new Date(c.createdAt).getTime();
        if (d > lastHoldDate) lastHoldDate = d;
      }
      if (/\[AR-RESUME\]/i.test(body)) {
        const d = new Date(c.createdAt).getTime();
        if (d > lastResumeDate) lastResumeDate = d;
      }
    }

    return NextResponse.json({
      jobId,
      isHeld: lastHoldDate > 0 && lastHoldDate > lastResumeDate,
    });
  } catch (err: any) {
    console.error('[AR-Hold] GET Error:', err.message);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

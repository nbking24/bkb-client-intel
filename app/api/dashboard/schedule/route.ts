import { NextRequest, NextResponse } from 'next/server';
import {
  getJobSchedule,
  getActiveJobSchedules,
  getScheduleAudit,
  createPhaseGroup,
  createPhaseTask,
  updateTaskProgress,
  deleteJTTask,
  applyStandardTemplate,
  applyPhaseDefaults,
  moveTaskToPhase,
} from '@/app/lib/jobtread';

// GET /api/dashboard/schedule?jobId=xxx  → single job schedule (includes orphans)
// GET /api/dashboard/schedule?overview=true → all active jobs with phases + status categories
// GET /api/dashboard/schedule?audit=true → universal schedule audit across all active jobs
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    const overview = searchParams.get('overview');
    const audit = searchParams.get('audit');

    if (jobId) {
      const schedule = await getJobSchedule(jobId);
      if (!schedule) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }
      return NextResponse.json({ schedule });
    }

    if (audit === 'true') {
      const result = await getScheduleAudit();
      return NextResponse.json(result);
    }

    if (overview === 'true') {
      const schedules = await getActiveJobSchedules();
      return NextResponse.json({ schedules });
    }

    return NextResponse.json({ error: 'Provide jobId, overview=true, or audit=true' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/dashboard/schedule
// { action: "createPhase", jobId, name, description? }
// { action: "createTask", jobId, parentGroupId, name, description?, startDate?, endDate? }
// { action: "updateProgress", taskId, progress }
// { action: "deleteTask", taskId }
// { action: "applyTemplate", jobId }  — Apply full BKB standard template
// { action: "applyPhaseDefaults", jobId, parentGroupId, phaseNumber }  — Fill a single phase
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'createPhase': {
        const result = await createPhaseGroup({
          jobId: body.jobId,
          name: body.name,
          description: body.description,
        });
        return NextResponse.json({ phase: result });
      }
      case 'createTask': {
        const result = await createPhaseTask({
          jobId: body.jobId,
          parentGroupId: body.parentGroupId,
          name: body.name,
          description: body.description,
          startDate: body.startDate,
          endDate: body.endDate,
          assignedMembershipIds: body.assignedMembershipIds,
        });
        return NextResponse.json({
          task: result,
          ...(result.warning ? { warning: result.warning } : {}),
        });
      }
      case 'updateProgress': {
        await updateTaskProgress(body.taskId, body.progress);
        return NextResponse.json({ ok: true });
      }
      case 'deleteTask': {
        await deleteJTTask(body.taskId);
        return NextResponse.json({ ok: true });
      }
      case 'applyTemplate': {
        const result = await applyStandardTemplate(body.jobId);
        return NextResponse.json({
          ok: true,
          ...result,
        });
      }
      case 'applyPhaseDefaults': {
        const result = await applyPhaseDefaults(
          body.jobId,
          body.parentGroupId,
          body.phaseNumber
        );
        return NextResponse.json({
          ok: true,
          ...result,
        });
      }
      case 'moveTask': {
        const result = await moveTaskToPhase({
          jobId: body.jobId,
          taskId: body.taskId,
          taskName: body.taskName,
          newParentGroupId: body.newParentGroupId,
          startDate: body.startDate,
          endDate: body.endDate,
        });
        return NextResponse.json({ ok: true, ...result });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

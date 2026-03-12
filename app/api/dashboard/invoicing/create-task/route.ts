// ============================================================
// Create $ Schedule Task for Unmatched Draft Invoice
//
// POST → Creates a "$ <invoiceName>" task under the "In Production"
//        phase group for the given job. Creates the group if it
//        doesn't exist.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getJobSchedule, createPhaseGroup, createPhaseTask, JTScheduleTask } from '@/app/lib/jobtread';

export const runtime = 'nodejs';

const IN_PRODUCTION_GROUP_NAME = 'In Production';

export async function POST(req: NextRequest) {
  try {
    const { jobId, documentName, documentSubject } = await req.json();

    if (!jobId || !documentName) {
      return NextResponse.json(
        { error: 'jobId and documentName are required' },
        { status: 400 }
      );
    }

    // 1. Get the job's schedule to find the "In Production" group
    const schedule = await getJobSchedule(jobId);
    if (!schedule) {
      return NextResponse.json(
        { error: 'Could not load job schedule' },
        { status: 404 }
      );
    }
    const allTasks = flattenTasks([...schedule.phases, ...schedule.orphanTasks]);

    let inProductionGroupId = '';

    // Look for an existing "In Production" group (may have * suffix)
    const inProdGroup = allTasks.find(
      (t) => t.isGroup && t.name.toLowerCase().replace(/\*/g, '').trim() === IN_PRODUCTION_GROUP_NAME.toLowerCase()
    );

    if (inProdGroup) {
      inProductionGroupId = inProdGroup.id;
    } else {
      // Create the "In Production" group
      const created = await createPhaseGroup({
        jobId,
        name: IN_PRODUCTION_GROUP_NAME,
      });
      inProductionGroupId = created.id;
    }

    // 2. Build the task name: "$ - (Subject)" or "$ - (Invoice)" if no subject
    const label = documentSubject || documentName;
    const taskName = `$ - (${label})`;

    // Check if a task with this name already exists
    const existingTask = allTasks.find(
      (t) => !t.isGroup && t.name.toLowerCase() === taskName.toLowerCase()
    );
    if (existingTask) {
      return NextResponse.json({
        success: true,
        alreadyExists: true,
        taskId: existingTask.id,
        taskName: existingTask.name,
        message: `Task "${taskName}" already exists`,
      });
    }

    // 3. Create the task under the "In Production" group
    const created = await createPhaseTask({
      jobId,
      parentGroupId: inProductionGroupId,
      name: taskName,
    });

    return NextResponse.json({
      success: true,
      alreadyExists: false,
      taskId: created.id,
      taskName: created.name,
      warning: created.warning || null,
      message: `Created task "${taskName}" under ${IN_PRODUCTION_GROUP_NAME}`,
    });
  } catch (error: any) {
    console.error('Failed to create $ task:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create task' },
      { status: 500 }
    );
  }
}

// Flatten nested schedule task tree into a flat array
function flattenTasks(tasks: JTScheduleTask[]): JTScheduleTask[] {
  const result: JTScheduleTask[] = [];
  for (const task of tasks) {
    result.push(task);
    if (task.childTasks?.nodes?.length) {
      result.push(...flattenTasks(task.childTasks.nodes));
    }
  }
  return result;
}

// ============================================================
// Create Task under a Phase for a Job
//
// POST → Creates a task under the specified phase group.
//        Looks up the phase by name in the job's schedule.
//        If the phase doesn't exist, creates it.
//        Optionally attaches files (public URLs) to the task.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getJobSchedule, createPhaseGroup, createPhaseTask, pave } from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { jobId, taskName, phaseName, endDate, description, fileUrls } = await req.json();

    if (!jobId || !taskName || !phaseName) {
      return NextResponse.json(
        { error: 'jobId, taskName, and phaseName are required' },
        { status: 400 }
      );
    }

    // 1. Get the job's schedule to find the phase group
    const schedule = await getJobSchedule(jobId);
    if (!schedule) {
      return NextResponse.json(
        { error: 'Could not load job schedule' },
        { status: 404 }
      );
    }

    // Flatten all tasks to find the phase group
    const allTasks = flattenTasks(schedule.phases);
    let phaseGroupId = '';

    // Look for an existing phase group (may have * suffix from templates)
    const phaseGroup = allTasks.find(
      (t: any) => t.isGroup && t.name.toLowerCase().replace(/\*/g, '').trim() === phaseName.toLowerCase()
    );

    if (phaseGroup) {
      phaseGroupId = phaseGroup.id;
    } else {
      // Create the phase group if it doesn't exist
      const created = await createPhaseGroup({
        jobId,
        name: phaseName,
      });
      phaseGroupId = created.id;
    }

    // 2. Create the task under the phase
    const result = await createPhaseTask({
      jobId,
      parentGroupId: phaseGroupId,
      name: taskName,
      ...(endDate ? { endDate } : {}),
      ...(description ? { description } : {}),
    });

    // 3. Attach files to the task if provided
    const fileResults: string[] = [];
    if (fileUrls && Array.isArray(fileUrls) && fileUrls.length > 0 && result.id) {
      for (const file of fileUrls) {
        try {
          await pave({
            createFile: {
              $: {
                targetType: 'task',
                targetId: result.id,
                url: file.url,
                name: file.name || file.url.split('/').pop() || 'attachment',
              },
              createdFile: { id: {}, name: {} },
            },
          });
          fileResults.push(file.name || 'file');
        } catch (fileErr: any) {
          console.error('File attach failed:', fileErr?.message);
          fileResults.push(`✗ ${file.name || 'file'}: ${fileErr?.message}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      task: result,
      phase: phaseName,
      filesAttached: fileResults.length,
    });
  } catch (err: any) {
    console.error('Create task failed:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to create task' },
      { status: 500 }
    );
  }
}

// Helper to flatten nested task tree
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

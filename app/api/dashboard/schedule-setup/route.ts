import { NextRequest, NextResponse } from 'next/server';
import {
  getJobSchedule,
  getActiveJobs,
  createPhaseGroup,
  createPhaseTask,
  moveTaskToPhase,
  deleteJTTask,
} from '@/app/lib/jobtread';
import {
  BKB_STANDARD_TEMPLATE,
  recommendPhaseForTask,
} from '@/app/lib/schedule-templates';
import {
  type ProjectScope,
  getQuestionsForScope,
  getDefaultAnswers,
  getIncludedTasksByPhase,
  type SurveyAnswers,
} from '@/app/lib/survey-templates';
import { STANDARD_PHASES } from '@/app/lib/constants';

// ============================================================
// POST /api/dashboard/schedule-setup
//
// Handles the full schedule standardization workflow:
//
// { action: "preview", jobId }
//   -> Fetches existing schedule, audits every task, returns
//     a preview of what would change (re-categorize, create, skip)
//
// { action: "apply", jobId, scope, surveyAnswers, plan }
//   -> Actually applies the standardization: creates missing phases,
//     moves misplaced tasks, creates new tasks from template
//
// { action: "survey", scope }
//   -> Returns the survey questions for a given project scope
//     with default answers pre-filled
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      // -------------------------------------------------------
      // SURVEY -- Get questions for a project scope
      // -------------------------------------------------------
      case 'survey': {
        const scope = body.scope as ProjectScope;
        if (!scope) {
          return NextResponse.json({ error: 'scope is required' }, { status: 400 });
        }
        const questions = getQuestionsForScope(scope);
        const defaults = getDefaultAnswers(scope);
        return NextResponse.json({ questions, defaults });
      }

      // -------------------------------------------------------
      // PREVIEW -- Analyze existing schedule and plan changes
      // -------------------------------------------------------
      case 'preview': {
        const { jobId, scope, surveyAnswers } = body;
        if (!jobId) {
          return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
        }

        // 1. Get the existing schedule for this job
        const schedule = await getJobSchedule(jobId);
        if (!schedule) {
          return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        // 2. Get the template tasks (filtered by scope if provided)
        const templatePhases = scope && surveyAnswers
          ? getIncludedTasksByPhase(scope as ProjectScope, surveyAnswers as SurveyAnswers)
          : BKB_STANDARD_TEMPLATE.map((p) => ({
              phaseNumber: p.phaseNumber,
              name: p.name,
              description: p.description,
              tasks: p.tasks,
            }));

        // 3. Map existing phases to standard phase numbers
        const existingPhaseMap: Record<number, {
          id: string;
          name: string;
          tasks: { id: string; name: string; progress: number | null }[];
        }> = {};

        for (const phase of schedule.phases) {
          const lower = phase.name.toLowerCase().trim();
          let phaseNum: number | null = null;

          for (const sp of STANDARD_PHASES) {
            if (lower === sp.name.toLowerCase() || lower.includes(sp.short.toLowerCase())) {
              phaseNum = sp.number;
              break;
            }
          }
          if (phaseNum === null) {
            if (lower.includes('admin')) phaseNum = 1;
            else if (lower.includes('conceptual')) phaseNum = 2;
            else if (lower.includes('design dev') || lower.includes('selections')) phaseNum = 3;
            else if (lower.includes('contract')) phaseNum = 4;
            else if (lower.includes('precon') || lower.includes('pre-con') || lower.includes('preconstruction')) phaseNum = 5;
            else if (lower.includes('production')) phaseNum = 6;
            else if (lower.includes('inspection')) phaseNum = 7;
            else if (lower.includes('punch')) phaseNum = 8;
            else if (lower.includes('completion') || lower.includes('closeout')) phaseNum = 9;
          }

          if (phaseNum !== null) {
            existingPhaseMap[phaseNum] = {
              id: phase.id,
              name: phase.name,
              tasks: (phase.childTasks?.nodes || []).map((t: any) => ({
                id: t.id,
                name: t.name,
                progress: t.progress,
              })),
            };
          }
        }

        // 4. Build the plan
        const plan: {
          phasesToCreate: { phaseNumber: number; name: string; description: string }[];
          tasksToCreate: { phaseNumber: number; phaseName: string; taskName: string; description?: string }[];
          tasksToMove: { taskId: string; taskName: string; fromPhase: string; toPhaseNumber: number; toPhaseName: string; confidence: string; reason: string }[];
          orphansToAssign: { taskId: string; taskName: string; toPhaseNumber: number; toPhaseName: string; confidence: string; reason: string }[];
          existingTasksKept: { phaseNumber: number; phaseName: string; taskName: string }[];
          skippedTasks: { phaseNumber: number; phaseName: string; taskName: string; reason: string }[];
        } = {
          phasesToCreate: [],
          tasksToCreate: [],
          tasksToMove: [],
          orphansToAssign: [],
          existingTasksKept: [],
          skippedTasks: [],
        };

        // 4a. Identify missing phases
        for (const tp of templatePhases) {
          if (!existingPhaseMap[tp.phaseNumber]) {
            plan.phasesToCreate.push({
              phaseNumber: tp.phaseNumber,
              name: tp.name,
              description: tp.description,
            });
          }
        }

        // 4b. For each template phase, check which tasks exist vs need creation
        for (const tp of templatePhases) {
          const existing = existingPhaseMap[tp.phaseNumber];
          const existingNames = new Set(
            (existing?.tasks || []).map((t) => t.name.toLowerCase().trim())
          );

          for (const task of tp.tasks) {
            const taskLower = task.name.toLowerCase().trim();
            if (existingNames.has(taskLower)) {
              plan.existingTasksKept.push({
                phaseNumber: tp.phaseNumber,
                phaseName: tp.name,
                taskName: task.name,
              });
            } else {
              plan.tasksToCreate.push({
                phaseNumber: tp.phaseNumber,
                phaseName: tp.name,
                taskName: task.name,
                description: task.description,
              });
            }
          }
        }

        // 4c. Check for misplaced tasks (tasks in wrong phase)
        for (const [phaseNumStr, phaseData] of Object.entries(existingPhaseMap)) {
          const phaseNum = parseInt(phaseNumStr);
          for (const task of phaseData.tasks) {
            const rec = recommendPhaseForTask(task.name);
            if (rec && rec.confidence !== 'low' && rec.phaseNumber !== phaseNum) {
              plan.tasksToMove.push({
                taskId: task.id,
                taskName: task.name,
                fromPhase: phaseData.name,
                toPhaseNumber: rec.phaseNumber,
                toPhaseName: rec.phaseName,
                confidence: rec.confidence,
                reason: rec.reason,
              });
            }
          }
        }

        // 4d. Handle orphan tasks
        for (const orphan of schedule.orphanTasks) {
          const rec = recommendPhaseForTask(orphan.name);
          if (rec && rec.confidence !== 'low') {
            plan.orphansToAssign.push({
              taskId: orphan.id,
              taskName: orphan.name,
              toPhaseNumber: rec.phaseNumber,
              toPhaseName: rec.phaseName,
              confidence: rec.confidence,
              reason: rec.reason,
            });
          }
        }

        return NextResponse.json({
          jobId: schedule.id,
          jobName: schedule.name,
          existingPhases: Object.entries(existingPhaseMap).map(([num, data]) => ({
            phaseNumber: parseInt(num),
            name: data.name,
            id: data.id,
            taskCount: data.tasks.length,
          })),
          plan,
          summary: {
            phasesToCreate: plan.phasesToCreate.length,
            tasksToCreate: plan.tasksToCreate.length,
            tasksToMove: plan.tasksToMove.length,
            orphansToAssign: plan.orphansToAssign.length,
            existingTasksKept: plan.existingTasksKept.length,
          },
        });
      }

      // -------------------------------------------------------
      // APPLY -- Execute the standardization plan
      // -------------------------------------------------------
      case 'apply': {
        const { jobId, scope, surveyAnswers, plan } = body;
        if (!jobId || !plan) {
          return NextResponse.json(
            { error: 'jobId and plan are required' },
            { status: 400 }
          );
        }

        const results = {
          phasesCreated: 0,
          tasksCreated: 0,
          tasksMoved: 0,
          orphansAssigned: 0,
          errors: [] as string[],
        };

        // Track phase IDs: phaseNumber -> groupId
        const schedule = await getJobSchedule(jobId);
        if (!schedule) {
          return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        const phaseIdMap: Record<number, string> = {};

        // Map existing phases
        for (const phase of schedule.phases) {
          const lower = phase.name.toLowerCase().trim();
          let phaseNum: number | null = null;
          for (const sp of STANDARD_PHASES) {
            if (lower === sp.name.toLowerCase() || lower.includes(sp.short.toLowerCase())) {
              phaseNum = sp.number;
              break;
            }
          }
          if (phaseNum === null) {
            if (lower.includes('admin')) phaseNum = 1;
            else if (lower.includes('conceptual')) phaseNum = 2;
            else if (lower.includes('design dev') || lower.includes('selections')) phaseNum = 3;
            else if (lower.includes('contract')) phaseNum = 4;
            else if (lower.includes('precon') || lower.includes('pre-con') || lower.includes('preconstruction')) phaseNum = 5;
            else if (lower.includes('production')) phaseNum = 6;
            else if (lower.includes('inspection')) phaseNum = 7;
            else if (lower.includes('punch')) phaseNum = 8;
            else if (lower.includes('completion') || lower.includes('closeout')) phaseNum = 9;
          }
          if (phaseNum !== null) {
            phaseIdMap[phaseNum] = phase.id;
          }
        }

        // Step 1: Create missing phases
        if (plan.phasesToCreate?.length) {
          for (const phase of plan.phasesToCreate) {
            try {
              const created = await createPhaseGroup({
                jobId,
                name: phase.name,
                description: phase.description,
              });
              phaseIdMap[phase.phaseNumber] = created.id;
              results.phasesCreated++;
            } catch (err: any) {
              results.errors.push(`Create phase "${phase.name}": ${err.message}`);
            }
          }
        }

        // Step 2: Create missing tasks
        if (plan.tasksToCreate?.length) {
          for (const task of plan.tasksToCreate) {
            const parentGroupId = phaseIdMap[task.phaseNumber];
            if (!parentGroupId) {
              results.errors.push(
                `Skip task "${task.taskName}": no phase group for phase ${task.phaseNumber}`
              );
              continue;
            }
            try {
              await createPhaseTask({
                jobId,
                parentGroupId,
                name: task.taskName,
                description: task.description,
              });
              results.tasksCreated++;
            } catch (err: any) {
              results.errors.push(`Create task "${task.taskName}": ${err.message}`);
            }
          }
        }

        // Step 3: Move misplaced tasks
        if (plan.tasksToMove?.length) {
          for (const move of plan.tasksToMove) {
            const newParentId = phaseIdMap[move.toPhaseNumber];
            if (!newParentId) {
              results.errors.push(
                `Skip move "${move.taskName}": no phase group for phase ${move.toPhaseNumber}`
              );
              continue;
            }
            try {
              await moveTaskToPhase({
                jobId,
                taskId: move.taskId,
                taskName: move.taskName,
                newParentGroupId: newParentId,
              });
              results.tasksMoved++;
            } catch (err: any) {
              results.errors.push(`Move task "${move.taskName}": ${err.message}`);
            }
          }
        }

        // Step 4: Assign orphan tasks
        if (plan.orphansToAssign?.length) {
          for (const orphan of plan.orphansToAssign) {
            const newParentId = phaseIdMap[orphan.toPhaseNumber];
            if (!newParentId) {
              results.errors.push(
                `Skip orphan "${orphan.taskName}": no phase group for phase ${orphan.toPhaseNumber}`
              );
              continue;
            }
            try {
              await moveTaskToPhase({
                jobId,
                taskId: orphan.taskId,
                taskName: orphan.taskName,
                newParentGroupId: newParentId,
              });
              results.orphansAssigned++;
            } catch (err: any) {
              results.errors.push(`Assign orphan "${orphan.taskName}": ${err.message}`);
            }
          }
        }

        return NextResponse.json({
          ok: true,
          jobId,
          results,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err: any) {
    console.error('schedule-setup error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

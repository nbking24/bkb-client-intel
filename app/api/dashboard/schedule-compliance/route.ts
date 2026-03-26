export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import {
  getJobSchedule,
  getActiveJobs,
  createPhaseGroup,
  moveTaskToPhase,
} from '@/app/lib/jobtread';
import {
  BKB_STANDARD_TEMPLATE,
  recommendPhaseForTask,
} from '@/app/lib/schedule-templates';
import { STANDARD_PHASES } from '@/app/lib/constants';
import { createServerClient } from '@/app/lib/supabase';

interface ComplianceIssue {
  taskId: string;
  taskName: string;
  suggestedPhase: number;
  suggestedPhaseName: string;
  confidence: string;
  reason: string;
}

interface MisplacedTask extends ComplianceIssue {
  currentPhase: string;
}

interface JobComplianceReport {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  customStatus: string | null;
  isCompliant: boolean;
  missingPhases: Array<{ number: number; name: string; description: string }>;
  orphanTasks: ComplianceIssue[];
  misplacedTasks: MisplacedTask[];
}

interface ComplianceScanReport {
  scannedAt: string;
  totalJobs: number;
  compliantJobs: number;
  nonCompliantJobs: number;
  jobs: JobComplianceReport[];
}

interface JobFixResult {
  jobId: string;
  jobName: string;
  phasesCreated: number;
  orphansMoved: number;
  misplacedMoved: number;
  errors: string[];
}

interface StandardizationResult {
  startedAt: string;
  completedAt: string;
  totalJobs: number;
  jobResults: JobFixResult[];
  totals: {
    phasesCreated: number;
    orphansMoved: number;
    misplacedMoved: number;
    errors: number;
  };
}

function matchPhaseNumber(phaseName: string): number | null {
  const lower = phaseName.toLowerCase().trim();
  for (const sp of STANDARD_PHASES) {
    if (
      lower === sp.name.toLowerCase() ||
      lower.includes(sp.short.toLowerCase())
    ) {
      return sp.number;
    }
  }
  if (lower.includes('admin')) return 1;
  else if (lower.includes('conceptual')) return 2;
  else if (lower.includes('design dev') || lower.includes('selections'))
    return 3;
  else if (lower.includes('contract')) return 4;
  else if (
    lower.includes('precon') ||
    lower.includes('pre-con') ||
    lower.includes('preconstruction')
  )
    return 5;
  else if (lower.includes('production')) return 6;
  else if (lower.includes('inspection')) return 7;
  else if (lower.includes('punch')) return 8;
  else if (lower.includes('completion') || lower.includes('closeout'))
    return 9;
  return null;
}

function getPhaseByNumber(
  number: number
): { number: number; name: string; short: string; description: string } | null {
  return STANDARD_PHASES.find((p) => p.number === number) || null;
}

async function scanJobCompliance(jobId: string): Promise<JobComplianceReport | null> {
  try {
    const schedule = await getJobSchedule(jobId);
    if (!schedule) {
      return null;
    }

    // getJobSchedule returns { id, name, number, clientName, customStatus, phases, orphanTasks, ... }
    const jobName = schedule.name || '';
    const jobNumber = schedule.number || '';
    const clientName = schedule.clientName || '';
    const customStatus = schedule.customStatus || null;

    const existingPhaseNumbers = new Set<number>();
    const phaseMap = new Map<string, string>();

    if (schedule.phases && Array.isArray(schedule.phases)) {
      for (const phase of schedule.phases) {
        const phaseNumber = matchPhaseNumber(phase.name);
        if (phaseNumber !== null) {
          existingPhaseNumbers.add(phaseNumber);
        }
        phaseMap.set(phase.id, phase.name);
      }
    }

    const missingPhases: Array<{
      number: number;
      name: string;
      description: string;
    }> = [];
    for (const stdPhase of STANDARD_PHASES) {
      if (!existingPhaseNumbers.has(stdPhase.number)) {
        missingPhases.push({
          number: stdPhase.number,
          name: stdPhase.name,
          description: stdPhase.description,
        });
      }
    }

    const orphanTasks: ComplianceIssue[] = [];
    if (schedule.orphanTasks && Array.isArray(schedule.orphanTasks)) {
      for (const task of schedule.orphanTasks) {
        const recommendation = recommendPhaseForTask(task.name);
        if (recommendation) {
          orphanTasks.push({
            taskId: task.id,
            taskName: task.name,
            suggestedPhase: recommendation.phaseNumber,
            suggestedPhaseName: recommendation.phaseName,
            confidence: recommendation.confidence,
            reason: recommendation.reason,
          });
        }
      }
    }

    const misplacedTasks: MisplacedTask[] = [];
    if (schedule.phases && Array.isArray(schedule.phases)) {
      for (const phase of schedule.phases) {
        const currentPhaseNumber = matchPhaseNumber(phase.name);
        if (phase.childTasks && phase.childTasks.nodes && Array.isArray(phase.childTasks.nodes)) {
          for (const task of phase.childTasks.nodes) {
            const recommendation = recommendPhaseForTask(task.name);
            if (
              recommendation &&
              recommendation.confidence !== 'low' &&
              recommendation.phaseNumber !== currentPhaseNumber
            ) {
              misplacedTasks.push({
                taskId: task.id,
                taskName: task.name,
                currentPhase: phase.name,
                suggestedPhase: recommendation.phaseNumber,
                suggestedPhaseName: recommendation.phaseName,
                confidence: recommendation.confidence,
                reason: recommendation.reason,
              });
            }
          }
        }
      }
    }

    const isCompliant =
      missingPhases.length === 0 &&
      orphanTasks.length === 0 &&
      misplacedTasks.length === 0;

    return {
      jobId,
      jobName,
      jobNumber,
      clientName,
      customStatus,
      isCompliant,
      missingPhases,
      orphanTasks,
      misplacedTasks,
    };
  } catch (error) {
    console.error(`Error scanning job ${jobId}:`, error);
    return null;
  }
}

async function standardizeJob(jobId: string): Promise<JobFixResult> {
  const result: JobFixResult = {
    jobId,
    jobName: '',
    phasesCreated: 0,
    orphansMoved: 0,
    misplacedMoved: 0,
    errors: [],
  };

  try {
    const schedule = await getJobSchedule(jobId);
    if (!schedule) {
      result.errors.push('Failed to fetch job schedule');
      return result;
    }

    result.jobName = schedule.name || '';
    const existingPhaseNumbers = new Set<number>();
    const phaseMap = new Map<number, string>();

    if (schedule.phases && Array.isArray(schedule.phases)) {
      for (const phase of schedule.phases) {
        const phaseNumber = matchPhaseNumber(phase.name);
        if (phaseNumber !== null) {
          existingPhaseNumbers.add(phaseNumber);
          phaseMap.set(phaseNumber, phase.id);
        }
      }
    }

    for (const stdPhase of STANDARD_PHASES) {
      if (!existingPhaseNumbers.has(stdPhase.number)) {
        try {
          const newPhase = await createPhaseGroup({
            jobId,
            name: stdPhase.name,
            description: stdPhase.description,
          });
          if (newPhase && newPhase.id) {
            phaseMap.set(stdPhase.number, newPhase.id);
            result.phasesCreated++;
          }
        } catch (error) {
          result.errors.push(
            `Failed to create phase ${stdPhase.name}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }
      }
    }

    if (schedule.orphanTasks && Array.isArray(schedule.orphanTasks)) {
      for (const task of schedule.orphanTasks) {
        const recommendation = recommendPhaseForTask(task.name);
        if (
          recommendation &&
          (recommendation.confidence === 'high' ||
            recommendation.confidence === 'medium')
        ) {
          const targetPhaseId = phaseMap.get(recommendation.phaseNumber);
          if (targetPhaseId) {
            try {
              await moveTaskToPhase({
                jobId,
                taskId: task.id,
                taskName: task.name,
                newParentGroupId: targetPhaseId,
              });
              result.orphansMoved++;
            } catch (error) {
              result.errors.push(
                `Failed to move orphan task ${task.name}: ${
                  error instanceof Error ? error.message : 'Unknown error'
                }`
              );
            }
          }
        }
      }
    }

    if (schedule.phases && Array.isArray(schedule.phases)) {
      for (const phase of schedule.phases) {
        const currentPhaseNumber = matchPhaseNumber(phase.name);
        if (
          phase.childTasks &&
          phase.childTasks.nodes &&
          Array.isArray(phase.childTasks.nodes)
        ) {
          for (const task of phase.childTasks.nodes) {
            const recommendation = recommendPhaseForTask(task.name);
            if (
              recommendation &&
              (recommendation.confidence === 'high' ||
                recommendation.confidence === 'medium') &&
              recommendation.phaseNumber !== currentPhaseNumber
            ) {
              const targetPhaseId = phaseMap.get(recommendation.phaseNumber);
              if (targetPhaseId) {
                try {
                  await moveTaskToPhase({
                    jobId,
                    taskId: task.id,
                    taskName: task.name,
                    newParentGroupId: targetPhaseId,
                  });
                  result.misplacedMoved++;
                } catch (error) {
                  result.errors.push(
                    `Failed to move misplaced task ${task.name}: ${
                      error instanceof Error ? error.message : 'Unknown error'
                    }`
                  );
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    result.errors.push(
      `Job standardization failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }

  return result;
}

export async function GET(request: NextRequest) {
  const startTime = new Date();

  try {
    const jobs = await getActiveJobs(50);
    if (!jobs || jobs.length === 0) {
      return NextResponse.json({
        scannedAt: startTime.toISOString(),
        totalJobs: 0,
        compliantJobs: 0,
        nonCompliantJobs: 0,
        jobs: [],
      } as ComplianceScanReport);
    }

    const jobReports: JobComplianceReport[] = [];
    let compliantCount = 0;

    for (const job of jobs) {
      const report = await scanJobCompliance(job.id);
      if (report) {
        if (report.isCompliant) {
          compliantCount++;
        } else {
          jobReports.push(report);
        }
      }
    }

    const result: ComplianceScanReport = {
      scannedAt: startTime.toISOString(),
      totalJobs: jobs.length,
      compliantJobs: compliantCount,
      nonCompliantJobs: jobReports.length,
      jobs: jobReports,
    };

    const supabase = createServerClient();
    try {
      await supabase.from('agent_cache').upsert(
        {
          key: 'schedule-compliance-report',
          data: result,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
    } catch (cacheError) {
      console.error('Failed to cache compliance report:', cacheError);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('GET /api/dashboard/schedule-compliance error:', error);
    return NextResponse.json(
      {
        error: 'Failed to scan schedule compliance',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const startTime = new Date();

  try {
    const body = await request.json();
    const { action, jobId, jobIds } = body;

    if (action === 'autoFix' && jobId) {
      const result = await standardizeJob(jobId);
      return NextResponse.json({
        startedAt: startTime.toISOString(),
        completedAt: new Date().toISOString(),
        totalJobs: 1,
        jobResults: [result],
        totals: {
          phasesCreated: result.phasesCreated,
          orphansMoved: result.orphansMoved,
          misplacedMoved: result.misplacedMoved,
          errors: result.errors.length,
        },
      } as StandardizationResult);
    }

    if (action === 'bulkStandardize') {
      let targetJobIds: string[] = [];

      if (Array.isArray(jobIds) && jobIds.length > 0) {
        targetJobIds = jobIds;
      } else {
        const jobs = await getActiveJobs(50);
        targetJobIds = jobs.map((j) => j.id);
      }

      const jobResults: JobFixResult[] = [];
      let totalPhasesCreated = 0;
      let totalOrphansMoved = 0;
      let totalMisplacedMoved = 0;
      let totalErrors = 0;

      for (const jId of targetJobIds) {
        const result = await standardizeJob(jId);
        jobResults.push(result);
        totalPhasesCreated += result.phasesCreated;
        totalOrphansMoved += result.orphansMoved;
        totalMisplacedMoved += result.misplacedMoved;
        totalErrors += result.errors.length;
      }

      const result: StandardizationResult = {
        startedAt: startTime.toISOString(),
        completedAt: new Date().toISOString(),
        totalJobs: targetJobIds.length,
        jobResults,
        totals: {
          phasesCreated: totalPhasesCreated,
          orphansMoved: totalOrphansMoved,
          misplacedMoved: totalMisplacedMoved,
          errors: totalErrors,
        },
      };

      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: 'Invalid action. Must be "bulkStandardize" or "autoFix".' },
      { status: 400 }
    );
  } catch (error) {
    console.error('POST /api/dashboard/schedule-compliance error:', error);
    return NextResponse.json(
      {
        error: 'Failed to standardize schedules',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

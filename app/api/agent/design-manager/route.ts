// ============================================================
// Design Manager Agent — API Route
//
// GET  → Run agent analysis (gather data + Claude assessment)
//        ?cached=true → return cached result from Supabase
// POST → Execute agent actions (create tasks, draft messages,
//         standardize schedules, dismiss/complete recommendations)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  buildAgentContext,
  analyzeProjectSchedule,
  getClientContactInfo,
  type AgentFullContext,
  type AgentProjectContext,
} from '@/app/lib/design-agent';
import {
  createPhaseGroup,
  createPhaseTask,
  createTask,
  getJobSchedule,
} from '@/app/lib/jobtread';
import {
  STANDARD_PHASES,
  AGENT_RULES,
  JT_MEMBERS,
} from '@/app/lib/constants';
import { BKB_STANDARD_TEMPLATE } from '@/app/lib/schedule-templates';
import { createServerClient } from '@/app/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300; // Allow up to 5 min for full agent analysis (Vercel Pro)

// ============================================================
// Types for Agent Response
// ============================================================

interface AgentProjectAssessment {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
  category: 'In-Design' | 'Ready';
  status: 'on_track' | 'at_risk' | 'stalled' | 'blocked' | 'complete';
  currentPhase: string | null;
  nextStep: string;
  nextStepAssignee: string;
  lastClientContact: string | null;
  daysSinceContact: number | null;
  nextMeeting: string | null;
  totalProgress: number;
  alerts: string[];
  recommendations: AgentRecommendation[];
}

interface AgentRecommendation {
  action: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  actionType: 'createTask' | 'draftMessage' | 'standardizeSchedule' | 'other';
  actionPayload?: Record<string, unknown>;
}

interface AgentReport {
  generatedAt: string;
  summary: string;
  projectCount: number;
  alertCount: number;
  projects: AgentProjectAssessment[];
  topPriorities: string[];
}

// ============================================================
// Supabase Cache Helpers
// ============================================================

const CACHE_KEY = 'design-manager-report';

async function getCachedReport(): Promise<AgentReport | null> {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('agent_cache')
      .select('data, updated_at')
      .eq('key', CACHE_KEY)
      .single();

    if (error || !data) return null;
    return data.data as AgentReport;
  } catch (err) {
    console.error('Cache read error:', err);
    return null;
  }
}

async function saveCachedReport(report: AgentReport): Promise<void> {
  try {
    const supabase = createServerClient();
    await supabase
      .from('agent_cache')
      .upsert(
        {
          key: CACHE_KEY,
          data: report,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
  } catch (err) {
    console.error('Cache write error:', err);
  }
}

// ============================================================
// Recommendation Dismissal Helpers
// ============================================================

interface DismissalRecord {
  job_id: string;
  rec_action: string;
  rec_action_type: string;
  dismissal_type: 'ignored' | 'completed';
}

async function getDismissals(): Promise<DismissalRecord[]> {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('agent_dismissals')
      .select('job_id, rec_action, rec_action_type, dismissal_type');

    if (error) {
      console.error('Dismissals read error:', error);
      return [];
    }
    return (data || []) as DismissalRecord[];
  } catch (err) {
    console.error('Dismissals read error:', err);
    return [];
  }
}

function buildDismissalSet(dismissals: DismissalRecord[]): Set<string> {
  return new Set(
    dismissals.map((d) => `${d.job_id}|${d.rec_action}|${d.rec_action_type}`)
  );
}

function isRecDismissed(
  dismissalSet: Set<string>,
  jobId: string,
  rec: AgentRecommendation
): boolean {
  return dismissalSet.has(`${jobId}|${rec.action}|${rec.actionType}`);
}

function filterDismissedRecs(
  report: AgentReport,
  dismissals: DismissalRecord[]
): AgentReport {
  if (dismissals.length === 0) return report;
  const dismissalSet = buildDismissalSet(dismissals);
  return {
    ...report,
    projects: report.projects.map((project) => ({
      ...project,
      recommendations: project.recommendations.filter(
        (rec) => !isRecDismissed(dismissalSet, project.jobId, rec)
      ),
    })),
  };
}

async function saveDismissal(params: {
  jobId: string;
  recAction: string;
  recActionType: string;
  recDescription: string;
  dismissalType: 'ignored' | 'completed';
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from('agent_dismissals')
      .upsert(
        {
          job_id: params.jobId,
          rec_action: params.recAction,
          rec_action_type: params.recActionType,
          rec_description: params.recDescription,
          dismissal_type: params.dismissalType,
          dismissed_at: new Date().toISOString(),
          dismissed_by: 'nathan',
        },
        { onConflict: 'job_id,rec_action,rec_action_type' }
      );

    if (error) {
      console.error('Dismissal save error:', error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.error('Dismissal save error:', err);
    return { success: false, error: err.message };
  }
}

async function removeDismissal(params: {
  jobId: string;
  recAction: string;
  recActionType: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from('agent_dismissals')
      .delete()
      .eq('job_id', params.jobId)
      .eq('rec_action', params.recAction)
      .eq('rec_action_type', params.recActionType);

    if (error) {
      console.error('Dismissal remove error:', error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.error('Dismissal remove error:', err);
    return { success: false, error: err.message };
  }
}

// ============================================================
// Claude API Call
// ============================================================

async function callClaude(prompt: string, systemPrompt: string): Promise<string> {
  const apiK = process.env.ANTHROPIC_API_KEY;
  if (!apiK) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const MAX_RETRIES = 3;
  const INITIAL_DELAY = 5000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiK,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16384,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (res.status === 429 && attempt < MAX_RETRIES - 1) {
      const delay = INITIAL_DELAY * Math.pow(2, attempt);
      console.log(`Claude API 429 rate limit — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text || '';
  }

  throw new Error('Claude API failed after all retries');
}

// Helper: map JT custom status to dashboard category
function getProjectCategory(customStatus: string | null): 'In-Design' | 'Ready' {
  if (customStatus && customStatus.toLowerCase().includes('ready')) return 'Ready';
  return 'In-Design';
}


// ============================================================
// Build the Agent System Prompt
// ============================================================

const SYSTEM_PROMPT = `You are the BKB Design Manager Agent — an AI project manager for Brett King Builder's design-phase construction projects.

Your role is to evaluate each project, identify risks, and recommend specific next actions to keep projects moving efficiently through the design phase.

BRETT KING BUILDER RULES:
1. Every project must have the 9 standard schedule categories: ${STANDARD_PHASES.map(p => p.name).join(', ')}
2. Every project must have a clear NEXT TASK with someone ASSIGNED to it
3. Every project must have a next CLIENT MEETING on the calendar (design meeting, budget meeting, or selections meeting)
4. No more than ${AGENT_RULES.maxDaysNoContact} days should pass without client communication (email, text, call, or JT daily log)
5. Tasks due within ${AGENT_RULES.urgentDeadlineDays} days are URGENT
6. Tasks due within ${AGENT_RULES.warningDeadlineDays} days need a WARNING
7. If a project has overdue tasks AND no recent client contact, it is STALLED
8. Projects should progress through phases sequentially: Conceptual Design → Design Development → Contract → Preconstruction
9. Every incomplete task MUST have a start and end date assigned. Tasks without dates are invisible to deadline tracking and may represent missed work. Flag these as needing dates.

TEAM MEMBERS:
- Nathan (Sales/Design Manager) - primary point of contact for clients
- Brett (Owner/Project Manager) - oversees all projects
- Evan (Sales/Estimating) - handles estimates and some client meetings
- Terri (Admin) - administrative tasks
- Josh (Field Superintendent) - field operations
- Dave Steich (Field) - field work
- Jimmy (Field) - field work

When analyzing projects, you must respond with VALID JSON only. No markdown, no code fences. Just the raw JSON object.`;

// ============================================================
// Build the Analysis Prompt
// ============================================================

function buildAnalysisPrompt(context: AgentFullContext): string {
  const projectSummaries = context.projects.map((p) => {
    const s = p.schedule;
    const c = p.clientContact;

    const categoryLines = s.categories.map((cat) => {
      return `  ${cat.name}: ${cat.progress}% (${cat.completedCount}/${cat.taskCount} done)`;
    }).join('\n');

    const contactInfo = c.daysSinceContact !== null
      ? `Last: ${c.daysSinceContact}d ago via ${c.lastContactType || 'unknown'}`
      : c.noContactAlert ? 'NO CONTACT RECORD' : 'unavailable';

    return `
--- ${s.jobName} (#${s.jobNumber}) [ID: ${s.jobId}] ---
Client: ${s.clientName} | Status: ${s.customStatus || 'None'} | Phase: ${s.currentPhase || 'None'} | Progress: ${s.totalProgress}%
Health: ${p.health} | Contact: ${contactInfo} | GHL: ${c.ghlContactId || 'N/A'}
Alerts: ${p.alerts.length > 0 ? p.alerts.join('; ') : 'None'}
Categories:\n${categoryLines}
Missing: ${s.missingCategories.length > 0 ? s.missingCategories.join(', ') : 'None'}
Overdue: ${s.overdueTasks.length > 0 ? s.overdueTasks.map(t => `${t.name} (${Math.abs(t.daysUntilDue!)}d)`).join(', ') : 'None'}
Upcoming: ${s.upcomingTasks.length > 0 ? s.upcomingTasks.map(t => `${t.name} (${t.daysUntilDue}d)`).join(', ') : 'None'}
No Dates: ${s.undatedTasks && s.undatedTasks.length > 0 ? s.undatedTasks.map(t => `${t.name} [${t.categoryName}]`).join(', ') : 'None'}
`;
  }).join('\n');

  return `Analyze ${context.projectCount} design-phase projects for Brett King Builder. Date: ${new Date().toISOString().split('T')[0]}

PORTFOLIO: ${context.onTrackCount} on-track, ${context.atRiskCount} at-risk, ${context.stalledCount} stalled, ${context.alertCount} alerts

${projectSummaries}

Respond with VALID JSON only (no markdown fences):
{
  "summary": "2-3 sentence portfolio overview",
  "topPriorities": ["priority 1", "priority 2", "priority 3"],
  "projects": [
    {
      "jobId": "exact JT Job ID",
      "jobName": "name",
      "jobNumber": "number",
      "clientName": "client",
      "status": "on_track|at_risk|stalled|blocked|complete",
      "currentPhase": "phase or null",
      "nextStep": "specific next action needed",
      "nextStepAssignee": "Nathan|Brett|Evan|Terri|Josh",
      "lastClientContact": "date or null",
      "daysSinceContact": null,
      "nextMeeting": "date or none scheduled",
      "totalProgress": 0,
      "alerts": ["alerts"],
      "recommendations": [{"action":"name","description":"what and why","priority":"high|medium|low","actionType":"createTask|draftMessage|standardizeSchedule|other"}]
    }
  ]
}`;
}

// ============================================================
// GET — Run Agent Analysis (or return cached)
// ============================================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const wantsCached = searchParams.get('cached') === 'true';

    if (wantsCached) {
      const cached = await getCachedReport();
      if (cached) {
        // Filter out dismissed recommendations before returning
        const dismissals = await getDismissals();
        const filtered = filterDismissedRecs(cached, dismissals);
        return NextResponse.json({ ...filtered, _fromCache: true });
      }
      console.log('Cache miss — running fresh analysis');
    }

    // Step 1: Gather all data from JT + GHL
    const context = await buildAgentContext();

    if (context.projectCount === 0) {
      const emptyReport: AgentReport = {
        generatedAt: new Date().toISOString(),
        summary: 'No design-phase projects found. All projects may be in other statuses.',
        projectCount: 0,
        alertCount: 0,
        projects: [],
        topPriorities: [],
      };
      await saveCachedReport(emptyReport);
      return NextResponse.json(emptyReport);
    }

    // Step 2: Check if Claude API key exists
    if (!process.env.ANTHROPIC_API_KEY) {
      const rawReport: AgentReport = {
        generatedAt: new Date().toISOString(),
        summary: 'AI analysis unavailable. Showing raw data.',
        projectCount: context.projectCount,
        alertCount: context.alertCount,
        projects: context.projects.map((p) => ({
          jobId: p.schedule.jobId,
          jobName: p.schedule.jobName,
          jobNumber: p.schedule.jobNumber,
          clientName: p.schedule.clientName,
          category: getProjectCategory(p.schedule.customStatus),
          status: p.health,
          currentPhase: p.schedule.currentPhase,
          nextStep: 'AI analysis required for recommendations',
          nextStepAssignee: 'TBD',
          lastClientContact: p.clientContact.lastContactDate,
          daysSinceContact: p.clientContact.daysSinceContact,
          nextMeeting: null,
          totalProgress: p.schedule.totalProgress,
          alerts: p.alerts,
          recommendations: [],
        })).sort((a, b) => (a.jobName || '').localeCompare(b.jobName || '')),
        topPriorities: ['Configure ANTHROPIC_API_KEY in Vercel to enable AI analysis'],
      };
      await saveCachedReport(rawReport);
      return NextResponse.json(rawReport);
    }

    // Step 3: Run Claude analysis
    const analysisPrompt = buildAnalysisPrompt(context);
    const claudeResponse = await callClaude(analysisPrompt, SYSTEM_PROMPT);

    // Step 4: Parse Claude's JSON response
    let report: AgentReport;
    try {
      const cleaned = claudeResponse
        .replace(/\`\`\`json\n?/g, '')
        .replace(/\`\`\`\n?/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      const statusMap = new Map<string, string | null>();
      for (const p of context.projects) {
        statusMap.set(p.schedule.jobId, p.schedule.customStatus);
      }

      const enrichedProjects = (parsed.projects || []).map((p: any) => ({
        ...p,
        category: getProjectCategory(statusMap.get(p.jobId) || null),
      }));
      enrichedProjects.sort((a: any, b: any) =>
        (a.jobName || '').localeCompare(b.jobName || '')
      );

      report = {
        generatedAt: new Date().toISOString(),
        summary: parsed.summary || 'Analysis complete.',
        projectCount: context.projectCount,
        alertCount: context.alertCount,
        projects: enrichedProjects,
        topPriorities: parsed.topPriorities || [],
      };
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr);
      report = {
        generatedAt: new Date().toISOString(),
        summary: claudeResponse.slice(0, 500),
        projectCount: context.projectCount,
        alertCount: context.alertCount,
        projects: context.projects.map((p) => ({
          jobId: p.schedule.jobId,
          jobName: p.schedule.jobName,
          jobNumber: p.schedule.jobNumber,
          clientName: p.schedule.clientName,
          category: getProjectCategory(p.schedule.customStatus),
          status: p.health,
          currentPhase: p.schedule.currentPhase,
          nextStep: 'See summary for AI analysis',
          nextStepAssignee: 'TBD',
          lastClientContact: p.clientContact.lastContactDate,
          daysSinceContact: p.clientContact.daysSinceContact,
          nextMeeting: null,
          totalProgress: p.schedule.totalProgress,
          alerts: p.alerts,
          recommendations: [],
        })).sort((a, b) => (a.jobName || '').localeCompare(b.jobName || '')),
        topPriorities: [],
      };
    }

    // Step 5: Cache the FULL report (before filtering dismissals)
    await saveCachedReport(report);

    // Step 6: Filter dismissed recs before returning to client
    const dismissals = await getDismissals();
    const filtered = filterDismissedRecs(report, dismissals);

    return NextResponse.json(filtered);
  } catch (err: any) {
    console.error('Design Manager Agent error:', err);
    return NextResponse.json(
      {
        error: 'Agent analysis failed',
        message: err.message || 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// POST — Execute Agent Actions
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'refresh':
        return GET(req);

      // ==================================================
      // ACTION: Dismiss Recommendation (Ignore)
      // ==================================================
      case 'dismissRecommendation': {
        const { jobId, recAction, recActionType, recDescription } = body;
        if (!jobId || !recAction || !recActionType) {
          return NextResponse.json(
            { error: 'jobId, recAction, and recActionType are required' },
            { status: 400 }
          );
        }

        const result = await saveDismissal({
          jobId,
          recAction,
          recActionType,
          recDescription: recDescription || '',
          dismissalType: 'ignored',
        });

        return NextResponse.json({
          success: result.success,
          message: result.success
            ? `Recommendation "${recAction}" ignored for this project`
            : `Failed to dismiss: ${result.error}`,
          dismissalType: 'ignored',
          jobId,
          recAction,
        });
      }

      // ==================================================
      // ACTION: Complete Recommendation (Done)
      // ==================================================
      case 'completeRecommendation': {
        const { jobId, recAction, recActionType, recDescription } = body;
        if (!jobId || !recAction || !recActionType) {
          return NextResponse.json(
            { error: 'jobId, recAction, and recActionType are required' },
            { status: 400 }
          );
        }

        const result = await saveDismissal({
          jobId,
          recAction,
          recActionType,
          recDescription: recDescription || '',
          dismissalType: 'completed',
        });

        return NextResponse.json({
          success: result.success,
          message: result.success
            ? `Recommendation "${recAction}" marked as done`
            : `Failed to complete: ${result.error}`,
          dismissalType: 'completed',
          jobId,
          recAction,
        });
      }

      // ==================================================
      // ACTION: Undo Dismissal
      // ==================================================
      case 'undoDismissal': {
        const { jobId, recAction, recActionType } = body;
        if (!jobId || !recAction || !recActionType) {
          return NextResponse.json(
            { error: 'jobId, recAction, and recActionType are required' },
            { status: 400 }
          );
        }

        const result = await removeDismissal({ jobId, recAction, recActionType });

        return NextResponse.json({
          success: result.success,
          message: result.success
            ? `Dismissal undone for "${recAction}"`
            : `Failed to undo: ${result.error}`,
          jobId,
          recAction,
        });
      }

      // ==================================================
      // ACTION: Standardize Schedule
      // ==================================================
      case 'standardizeSchedule': {
        const { jobId } = body;
        if (!jobId) {
          return NextResponse.json(
            { error: 'jobId is required' },
            { status: 400 }
          );
        }

        const schedule = await getJobSchedule(jobId);
        if (!schedule) {
          return NextResponse.json(
            { error: `Could not load schedule for job ${jobId}` },
            { status: 404 }
          );
        }

        const existingNames = schedule.phases.map(
          (p: any) => p.name.toLowerCase().trim()
        );
        const missingPhases = STANDARD_PHASES.filter(
          (sp) => !existingNames.includes(sp.name.toLowerCase())
        );

        if (missingPhases.length === 0) {
          return NextResponse.json({
            success: true,
            message: 'All 9 standard phases already exist on this project.',
            phasesCreated: 0,
            phases: [],
          });
        }

        const created: { name: string; id: string }[] = [];
        const errors: string[] = [];

        for (const phase of missingPhases) {
          try {
            const group = await createPhaseGroup({
              jobId,
              name: phase.name,
              description: phase.description,
            });
            created.push({ name: phase.name, id: group.id });
          } catch (err: any) {
            errors.push(`${phase.name}: ${err.message}`);
          }
        }

        return NextResponse.json({
          success: errors.length === 0,
          message: `Created ${created.length} of ${missingPhases.length} missing phases${errors.length > 0 ? ` (${errors.length} errors)` : ''}`,
          phasesCreated: created.length,
          phases: created,
          errors: errors.length > 0 ? errors : undefined,
          jobId,
          jobName: schedule.name,
        });
      }

      // ==================================================
      // ACTION: Create Task
      // ==================================================
      case 'createTask': {
        const { jobId, name, description, parentGroupId, assignee, startDate, endDate } = body;
        if (!jobId || !name) {
          return NextResponse.json(
            { error: 'jobId and name are required' },
            { status: 400 }
          );
        }

        let assignedMembershipIds: string[] | undefined;
        if (assignee) {
          const memberKey = assignee.toLowerCase().trim() as keyof typeof JT_MEMBERS;
          const memberId = JT_MEMBERS[memberKey];
          if (memberId) {
            assignedMembershipIds = [memberId];
          }
        }

        try {
          let result;
          if (parentGroupId) {
            result = await createPhaseTask({
              jobId,
              parentGroupId,
              name,
              description,
              startDate,
              endDate,
              assignedMembershipIds,
            });
          } else {
            result = await createTask({
              jobId,
              name,
              description,
              startDate,
              endDate,
              assignedMembershipIds,
            });
          }

          return NextResponse.json({
            success: true,
            message: `Task "${name}" created successfully`,
            task: result,
            jobId,
          });
        } catch (err: any) {
          return NextResponse.json(
            { success: false, error: `Task creation failed: ${err.message}` },
            { status: 500 }
          );
        }
      }

      // ==================================================
      // ACTION: Draft Message
      // ==================================================
      case 'draftMessage': {
        const { jobId, jobName, clientName, context: msgContext, messageType } = body;
        if (!jobName || !clientName) {
          return NextResponse.json(
            { error: 'jobName and clientName are required' },
            { status: 400 }
          );
        }

        if (!process.env.ANTHROPIC_API_KEY) {
          return NextResponse.json(
            { error: 'ANTHROPIC_API_KEY not configured — cannot draft messages' },
            { status: 500 }
          );
        }

        const type = messageType || 'email';
        const contextStr = msgContext || 'General project check-in';

        const draftPrompt = `Draft a ${type} from Nathan King at Brett King Builder to the client for the following project.

PROJECT: ${jobName}
CLIENT: ${clientName}
CONTEXT: ${contextStr}

GUIDELINES:
- Professional but warm and personal tone
- Nathan is the Sales/Design Manager — he's their main point of contact
- Keep it concise (3-5 sentences for text, 1-2 short paragraphs for email)
- Reference the specific project by name
- Include a clear call-to-action (schedule a call, confirm next steps, etc.)
- Sign off as "Nathan King" with "Brett King Builder"
- Do NOT be overly formal or corporate — BKB is a family-run builder

Respond with VALID JSON only:
{
  "subject": "email subject line (only for email type)",
  "body": "the message body",
  "type": "${type}"
}`;

        const draftSystemPrompt = `You are a writing assistant for Brett King Builder. You draft professional, warm client communications. Always respond with valid JSON only — no markdown, no code fences.`;

        try {
          const response = await callClaude(draftPrompt, draftSystemPrompt);
          const cleaned = response
            .replace(/\`\`\`json\n?/g, '')
            .replace(/\`\`\`\n?/g, '')
            .trim();
          const draft = JSON.parse(cleaned);

          return NextResponse.json({
            success: true,
            message: `Draft ${type} created for ${clientName}`,
            draft: {
              subject: draft.subject || null,
              body: draft.body || response,
              type: draft.type || type,
            },
            jobId,
            jobName,
            clientName,
          });
        } catch (err: any) {
          return NextResponse.json(
            { success: false, error: `Draft failed: ${err.message}` },
            { status: 500 }
          );
        }
      }

      // ==================================================
      // ACTION: Add Phase Defaults
      // ==================================================
      case 'addPhaseDefaults': {
        const { jobId, parentGroupId, phaseNumber } = body;
        if (!jobId || !parentGroupId || !phaseNumber) {
          return NextResponse.json(
            { error: 'jobId, parentGroupId, and phaseNumber are required' },
            { status: 400 }
          );
        }

        const phaseTemplate = BKB_STANDARD_TEMPLATE.find(
          (p) => p.phaseNumber === phaseNumber
        );
        if (!phaseTemplate) {
          return NextResponse.json(
            { error: `No template for phase number ${phaseNumber}` },
            { status: 400 }
          );
        }

        if (phaseTemplate.startsEmpty) {
          return NextResponse.json({
            success: true,
            message: `${phaseTemplate.name} starts empty by design — no default tasks to add.`,
            tasksCreated: 0,
          });
        }

        const created: string[] = [];
        const errors: string[] = [];

        for (const task of phaseTemplate.tasks) {
          try {
            await createPhaseTask({
              jobId,
              parentGroupId,
              name: task.name,
              description: task.description,
            });
            created.push(task.name);
          } catch (err: any) {
            errors.push(`${task.name}: ${err.message}`);
          }
        }

        return NextResponse.json({
          success: errors.length === 0,
          message: `Created ${created.length} of ${phaseTemplate.tasks.length} tasks in ${phaseTemplate.name}`,
          tasksCreated: created.length,
          tasks: created,
          errors: errors.length > 0 ? errors : undefined,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err: any) {
    console.error('Agent action error:', err);
    return NextResponse.json(
      { error: 'Action failed', message: err.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

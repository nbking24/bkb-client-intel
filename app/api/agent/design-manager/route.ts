// ============================================================
// Design Manager Agent — API Route
//
// GET  → Run agent analysis (gather data + Claude assessment)
//        ?cached=true → return cached result from Supabase
// POST → Execute agent actions (create tasks, draft messages,
//         standardize schedules)
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

// ============================================================
// Types for Agent Response
// ============================================================

interface AgentProjectAssessment {
  jobId: string;
  jobName: string;
  jobNumber: string;
  clientName: string;
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
// Claude API Call
// ============================================================

async function callClaude(prompt: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
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

    // Build category summary
    const categoryLines = s.categories.map((cat) => {
      const taskList = cat.tasks.map((t) => {
        let status = t.progress >= 100 ? '✓' : t.isOverdue ? '⚠OVERDUE' : `${t.progress}%`;
        let due = t.endDate ? ` (due: ${t.endDate})` : '';
        return `      - [${t.id}] ${t.name}: ${status}${due}`;
      }).join('\n');
      return `    [Phase ID: ${cat.id}] ${cat.name} [${cat.progress}% complete, ${cat.completedCount}/${cat.taskCount} tasks done]\n${taskList}`;
    }).join('\n');

    // Client contact info
    const contactInfo = c.daysSinceContact !== null
      ? `Last contact: ${c.lastContactDate} (${c.daysSinceContact} days ago, via ${c.lastContactType || 'unknown'})`
      : c.noContactAlert
        ? 'NO CLIENT CONTACT RECORD FOUND'
        : 'Contact info unavailable';

    return `
  ---
  PROJECT: ${s.jobName} (Job #${s.jobNumber})
JT Job ID: ${s.jobId}
  ---
  Client: ${s.clientName}
  Custom Status: ${s.customStatus || 'None'}
  Current Phase: ${s.currentPhase || 'No active phase detected'}
  Overall Progress: ${s.totalProgress}%
  Health: ${p.health}
  Existing Alerts: ${p.alerts.length > 0 ? p.alerts.join('; ') : 'None'}
  Client Contact: ${contactInfo}
  GHL Contact ID: ${c.ghlContactId || 'Not found'}

  Schedule Categories:
  ${categoryLines}

  Missing Standard Categories: ${s.missingCategories.length > 0 ? s.missingCategories.join(', ') : 'None'}
  Orphan Tasks (not in a category): ${s.orphanTaskCount}
  Overdue Tasks: ${s.overdueTasks.length > 0 ? s.overdueTasks.map(t => `${t.name} (${Math.abs(t.daysUntilDue!)}d overdue)`).join(', ') : 'None'}
  Upcoming Due (within ${AGENT_RULES.warningDeadlineDays}d): ${s.upcomingTasks.length > 0 ? s.upcomingTasks.map(t => `${t.name} (${t.daysUntilDue}d)`).join(', ') : 'None'}
  `;
  }).join('\n');

  return `Analyze the following ${context.projectCount} design-phase projects for Brett King Builder.

Today's date: ${new Date().toISOString().split('T')[0]}

PORTFOLIO SUMMARY:
- Total projects: ${context.projectCount}
- Pre-computed health: ${context.onTrackCount} on-track, ${context.atRiskCount} at-risk, ${context.stalledCount} stalled
- Total alerts: ${context.alertCount}

PROJECT DATA:
${projectSummaries}

Respond with a JSON object matching this structure exactly:
{
  "summary": "2-3 sentence overview of the entire portfolio status and top concerns",
  "topPriorities": ["priority 1", "priority 2", "priority 3"],
  "projects": [
    {
      "jobId": "the JT Job ID value (exact string from data above)",
      "jobName": "project name",
      "jobNumber": "job number",
      "clientName": "client name",
      "status": "on_track|at_risk|stalled|blocked|complete",
      "currentPhase": "phase name or null",
      "nextStep": "specific next action that needs to happen",
      "nextStepAssignee": "who should do it (Nathan, Brett, Evan, etc.)",
      "lastClientContact": "date string or null",
      "daysSinceContact": number or null,
      "nextMeeting": "date or 'none scheduled'",
      "totalProgress": number,
      "alerts": ["alert strings"],
      "recommendations": [
        {
          "action": "short action name",
          "description": "what to do and why",
          "priority": "high|medium|low",
          "actionType": "createTask|draftMessage|standardizeSchedule|other"
        }
      ]
    }
  ]
}`;
}

// ============================================================
// GET — Run Agent Analysis (or return cached)
// ============================================================

export async function GET(req: NextRequest) {
  try {
    // Check if caller wants cached result
    const { searchParams } = new URL(req.url);
    const wantsCached = searchParams.get('cached') === 'true';

    if (wantsCached) {
      const cached = await getCachedReport();
      if (cached) {
        return NextResponse.json({ ...cached, _fromCache: true });
      }
      // No cache available — fall through to fresh analysis
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
      // Return raw context without AI analysis — useful for testing data layer
      const rawReport: AgentReport = {
        generatedAt: new Date().toISOString(),
        summary: 'AI analysis unavailable — ANTHROPIC_API_KEY not configured. Showing raw data.',
        projectCount: context.projectCount,
        alertCount: context.alertCount,
        projects: context.projects.map((p) => ({
          jobId: p.schedule.jobId,
          jobName: p.schedule.jobName,
          jobNumber: p.schedule.jobNumber,
          clientName: p.schedule.clientName,
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
        })),
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
      // Claude sometimes wraps JSON in code fences despite instructions
      const cleaned = claudeResponse
        .replace(/\`\`\`json\n?/g, '')
        .replace(/\`\`\`\n?/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      report = {
        generatedAt: new Date().toISOString(),
        summary: parsed.summary || 'Analysis complete.',
        projectCount: context.projectCount,
        alertCount: context.alertCount,
        projects: parsed.projects || [],
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
        })),
        topPriorities: [],
      };
    }

    // Step 5: Cache the report in Supabase
    await saveCachedReport(report);

    return NextResponse.json(report);
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
        // Just re-run the GET analysis
        return GET(req);

      // ==================================================
      // ACTION: Standardize Schedule
      // Adds missing standard phase groups to a project.
      // Does NOT add default tasks — just the empty phases.
      // ==================================================
      case 'standardizeSchedule': {
        const { jobId } = body;
        if (!jobId) {
          return NextResponse.json(
            { error: 'jobId is required' },
            { status: 400 }
          );
        }

        // Get current schedule to find what's missing
        const schedule = await getJobSchedule(jobId);
        if (!schedule) {
          return NextResponse.json(
            { error: `Could not load schedule for job ${jobId}` },
            { status: 404 }
          );
        }

        // Find which standard phases are missing
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

        // Create each missing phase group
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
      // Creates a task on a job, optionally under a phase.
      // ==================================================
      case 'createTask': {
        const { jobId, name, description, parentGroupId, assignee, startDate, endDate } = body;
        if (!jobId || !name) {
          return NextResponse.json(
            { error: 'jobId and name are required' },
            { status: 400 }
          );
        }

        // Resolve assignee name to membership ID
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
            // Create under a specific phase
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
            // Create at job level
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
      // Uses Claude to draft a client outreach message.
      // Returns the draft — does NOT auto-send.
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
      // Adds default template tasks to an existing phase.
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

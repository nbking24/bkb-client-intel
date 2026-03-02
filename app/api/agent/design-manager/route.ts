// ============================================================
// Design Manager Agent — API Route
//
// GET  → Run agent analysis (gather data + Claude assessment)
// POST → Execute agent actions (create tasks, draft messages)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  buildAgentContext,
  type AgentFullContext,
  type AgentProjectContext,
} from '@/app/lib/design-agent';
import {
  STANDARD_PHASES,
  AGENT_RULES,
  JT_MEMBERS,
} from '@/app/lib/constants';

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
        return `      - ${t.name}: ${status}${due}`;
      }).join('\n');
      return `    ${cat.name} [${cat.progress}% complete, ${cat.completedCount}/${cat.taskCount} tasks done]\n${taskList}`;
    }).join('\n');

    // Client contact info
    const contactInfo = c.daysSinceContact !== null
      ? `Last contact: ${c.lastContactDate} (${c.daysSinceContact} days ago, via ${c.lastContactType || 'unknown'})`
      : c.noContactAlert
        ? 'NO CLIENT CONTACT RECORD FOUND'
        : 'Contact info unavailable';

    return `
--- PROJECT: ${s.jobName} (Job #${s.jobNumber}) ---
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

Overdue Tasks: ${s.overdueTasks.length > 0
  ? s.overdueTasks.map(t => `${t.name} (${Math.abs(t.daysUntilDue!)}d overdue)`).join(', ')
  : 'None'}
Upcoming Due (within ${AGENT_RULES.warningDeadlineDays}d): ${s.upcomingTasks.length > 0
  ? s.upcomingTasks.map(t => `${t.name} (${t.daysUntilDue}d)`).join(', ')
  : 'None'}
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
      "jobId": "the job ID",
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
// GET — Run Agent Analysis
// ============================================================

export async function GET(req: NextRequest) {
  try {
    // Step 1: Gather all data from JT + GHL
    const context = await buildAgentContext();

    if (context.projectCount === 0) {
      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        summary: 'No design-phase projects found. All projects may be in other statuses.',
        projectCount: 0,
        alertCount: 0,
        projects: [],
        topPriorities: [],
        _rawContext: context,
      });
    }

    // Step 2: Check if Claude API key exists
    if (!process.env.ANTHROPIC_API_KEY) {
      // Return raw context without AI analysis — useful for testing data layer
      return NextResponse.json({
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
        _rawContext: context,
      });
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

      case 'createTask': {
        // Phase 2: Create a task in JobTread
        // const { jobId, categoryId, name, assignee, startDate, endDate } = body;
        return NextResponse.json({
          success: false,
          message: 'Task creation not yet implemented — coming in Phase 2',
        });
      }

      case 'draftMessage': {
        // Phase 2: Draft a message for review
        // const { contactId, messageType, context } = body;
        return NextResponse.json({
          success: false,
          message: 'Message drafting not yet implemented — coming in Phase 2',
        });
      }

      case 'standardizeSchedule': {
        // Phase 2: Add missing standard categories to a project
        // const { jobId } = body;
        return NextResponse.json({
          success: false,
          message: 'Schedule standardization not yet implemented — coming in Phase 2',
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

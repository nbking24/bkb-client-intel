// @ts-nocheck
import Anthropic from '@anthropic-ai/sdk';
import { AgentModule, AgentContext, AgentResult } from './types';
import knowItAll from './know-it-all';
import projectDetails from './project-details';
import fieldStaff from './field-staff';
import { getActiveJobs, getTasksForJob, getJobSchedule, getMembers, createPhaseTask, createTask } from '@/app/lib/jobtread';
import { findJTJobByName } from '@/app/api/lib/supabase';
import { createProjectEvent } from '@/app/lib/project-memory';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Retry helper for transient API errors (529 overloaded, 5xx, rate limits)
async function callClaudeWithRetry(params: any, maxRetries = 3): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (err: any) {
      const status = err?.status || err?.error?.status || 0;
      const isRetryable = status === 529 || status === 503 || status === 502 || status === 429;

      if (isRetryable && attempt < maxRetries) {
        const delay = Math.pow(2, attempt + 1) * 1000;
        console.log(`[ROUTER] API returned ${status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

// Registry of all available agents
// Know-it-All now handles BOTH read and write JT operations (merged with former JT Entry)
const AGENTS: AgentModule[] = [
  knowItAll,
  projectDetails,
  fieldStaff,
  // Future: emailKid, designDolly
];

const AGENT_MAP: Record<string, AgentModule> = {};
for (const a of AGENTS) AGENT_MAP[a.name] = a;

// Short confirmation phrases that should stick with the previous agent
const CONFIRMATION_PATTERN = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|confirmed|proceed|approve|go for it|absolutely|please|please do|that's correct|correct|right|affirmative)\s*[.!]?$/i;

// Matches "Yes, proceed." and similar multi-word confirmations
const EXTENDED_CONFIRM_PATTERN = /^yes[,.]?\s*(proceed|go ahead|do it|please)[.!]?/i;

// Matches messages that contain approved task data (from the confirmation card)
const APPROVED_TASK_PATTERN = /\[APPROVED TASK DATA/;

// Matches messages that contain an approved generic write action (from the confirmation card)
const APPROVED_ACTION_PATTERN = /\[APPROVED ACTION/;

// Every JobTread write tool that MUST go through the @@ACTION_CONFIRM@@ flow.
// (Task creation uses its own @@TASK_CONFIRM@@ flow and is gated separately.)
const GATED_WRITE_TOOLS = new Set<string>([
  'update_task',
  'update_task_progress',
  'update_task_full',
  'delete_task',
  'create_phase',
  'apply_standard_template',
  'move_task_to_phase',
  'create_daily_log',
  'update_daily_log',
  'delete_daily_log',
  'create_comment',
  'update_job',
  'update_cost_group',
  'apply_phase_defaults',
]);

// Follow-up pattern: short messages that look like the user is providing info requested by the last agent
const FOLLOWUP_PATTERN = /^[^?]{1,80}$/;

function selectAgent(message: string, lastAgentName?: string, forcedAgent?: string): AgentModule {
  // Strip the [Context: ...] job prefix injected by the frontend before scoring
  // so agent scoring only considers the user's actual question
  const stripped = message.replace(/^\[Context:.*?\]\s*/s, '');
  const trimmed = stripped.trim();

  // ── STICKY AGENT: confirmations and short follow-ups always go back to the last agent ──
  if (lastAgentName && AGENT_MAP[lastAgentName]) {
    if (CONFIRMATION_PATTERN.test(trimmed)) {
      return AGENT_MAP[lastAgentName];
    }
    // "Yes, proceed." or "Yes, proceed but ..." — extended confirmation
    if (EXTENDED_CONFIRM_PATTERN.test(trimmed)) {
      return AGENT_MAP[lastAgentName];
    }
    // Messages with approved task data always go back to the agent that proposed them
    if (APPROVED_TASK_PATTERN.test(trimmed)) {
      return AGENT_MAP[lastAgentName];
    }
    // Messages with approved generic actions also stick to the proposing agent
    if (APPROVED_ACTION_PATTERN.test(trimmed)) {
      return AGENT_MAP[lastAgentName];
    }
    // Short follow-ups (< 80 chars, no question mark) stick with the last agent
    // unless another agent scores very high
    if (FOLLOWUP_PATTERN.test(trimmed)) {
      let maxOtherScore = 0;
      for (const agent of AGENTS) {
        if (agent.name !== lastAgentName) {
          maxOtherScore = Math.max(maxOtherScore, agent.canHandle(trimmed));
        }
      }
      if (maxOtherScore < 0.9) {
        return AGENT_MAP[lastAgentName];
      }
    }
  }

  // If a specific agent is forced by the UI selection, use it
  if (forcedAgent) {
    // "know-it-all" now handles everything (read + write JT + CRM + email + specs)
    if (forcedAgent === 'know-it-all') {
      return knowItAll;
    }
    // "project-details" group: always use project-details
    if (forcedAgent === 'project-details') {
      return projectDetails;
    }
    // "field-staff" group: always use field-staff agent
    if (forcedAgent === 'field-staff') {
      return fieldStaff;
    }
    // Direct agent name match
    if (AGENT_MAP[forcedAgent]) {
      return AGENT_MAP[forcedAgent];
    }
  }

  let best: AgentModule = knowItAll;
  let bestScore = 0;

  for (const agent of AGENTS) {
    const score = agent.canHandle(message);
    if (score > bestScore) {
      bestScore = score;
      best = agent;
    }
  }

  return best;
}

// ── FAST PATH: Handle simple data queries without the full Claude tool loop ──
// These queries are common, predictable, and don't need 39 tools + Claude reasoning.
// We fetch the data, then ask Claude (with NO tools) to format a nice response.
async function tryFastPath(msg: string, ctx: AgentContext): Promise<AgentResult | null> {
  // Never match on approved task data messages — those go to tryTaskCreationFastPath
  if (APPROVED_TASK_PATTERN.test(msg)) return null;

  const stripped = msg.replace(/^\[Context:.*?\]\s*/s, '').trim().toLowerCase();

  // Skip fast path for long messages (transcripts, pasted documents, etc.)
  // These need full Claude processing, not keyword matching
  if (stripped.length > 300) return null;

  // Pattern: "list open tasks", "show my tasks", "what are my open tasks", etc.
  if (/\b(list|show|give|what|get)\b.*\b(open|incomplete|pending|my)\b.*\btask/i.test(stripped) ||
      /\btask.*\b(open|incomplete|pending|list)\b/i.test(stripped)) {
    console.log('[FAST-PATH] Detected open tasks query');
    try {
      // When a specific job is selected, scope to ONLY that job
      if (ctx.jtJobId) {
        console.log('[FAST-PATH] Scoping tasks to focused job:', ctx.jtJobId);
        const tasks = await getTasksForJob(ctx.jtJobId);
        const openTasks = tasks.filter((t: any) => !t.isGroup && (t.progress === null || t.progress < 1));

        if (openTasks.length === 0) {
          return { agentName: 'Know it All', reply: 'No open tasks found for this job.', needsConfirmation: false };
        }

        let reply = `Here are the **${openTasks.length} open tasks** for this job:\n\n`;
        for (const t of openTasks) {
          const pct = Math.round((t.progress || 0) * 100);
          const due = t.endDate || 'No due date';
          reply += `- **${t.name}** — ${pct}% complete | Due: ${due}\n`;
        }

        return { agentName: 'Know it All', reply: reply.trim(), needsConfirmation: false };
      }

      // No job selected — fetch tasks across all active jobs
      const jobs = await getActiveJobs(10);  // Limit to 10 most recent active jobs
      if (!jobs || jobs.length === 0) {
        return { agentName: 'Know it All', reply: 'No active jobs found, so no open tasks.', needsConfirmation: false };
      }

      // Fetch tasks for each job in parallel (max 8 to stay fast)
      const jobsToQuery = jobs.slice(0, 8);
      const jobTaskResults = await Promise.all(
        jobsToQuery.map(async (j) => {
          try {
            const tasks = await getTasksForJob(j.id);
            // Filter to open tasks only (not groups, progress < 1)
            const openTasks = tasks.filter((t: any) => !t.isGroup && (t.progress === null || t.progress < 1));
            return { job: j, tasks: openTasks };
          } catch (err: any) {
            console.error(`[FAST-PATH] Error fetching tasks for job ${j.name}:`, err?.message);
            return { job: j, tasks: [] };
          }
        })
      );

      // Flatten and count
      let totalOpen = 0;
      const jobsWithTasks = jobTaskResults.filter(r => r.tasks.length > 0);
      for (const r of jobsWithTasks) totalOpen += r.tasks.length;

      if (totalOpen === 0) {
        return { agentName: 'Know it All', reply: 'No open tasks found across your active jobs.', needsConfirmation: false };
      }

      let reply = `Here are your **${totalOpen} open tasks** across ${jobsWithTasks.length} active jobs:\n\n`;
      for (const { job, tasks } of jobsWithTasks) {
        reply += `### #${job.number} ${job.name}\n`;
        for (const t of tasks) {
          const pct = Math.round((t.progress || 0) * 100);
          const due = t.endDate || 'No due date';
          reply += `- **${t.name}** — ${pct}% complete | Due: ${due}\n`;
        }
        reply += '\n';
      }

      if (jobs.length > 8) {
        reply += `\n*Showing tasks from your 8 most recent jobs. ${jobs.length - 8} additional jobs not shown.*`;
      }

      return { agentName: 'Know it All', reply: reply.trim(), needsConfirmation: false };
    } catch (err: any) {
      console.error('[FAST-PATH] Error in open tasks:', err?.message);
      return { agentName: 'Know it All', reply: 'Having trouble fetching tasks right now. Try selecting a specific project first, or ask "what are my active jobs?" to see a list.', needsConfirmation: false };
    }
  }

  // Pattern: "what active jobs", "list our jobs", "show active projects"
  if (/\b(list|show|what|get)\b.*\b(active|current|our)\b.*\b(job|project)/i.test(stripped) ||
      /\b(job|project)s?\b.*\b(active|current|do we have)\b/i.test(stripped)) {
    console.log('[FAST-PATH] Detected active jobs query');
    try {
      const jobs = await getActiveJobs();
      if (!jobs || jobs.length === 0) {
        return { agentName: 'Know it All', reply: 'No active jobs found.', needsConfirmation: false };
      }

      let reply = `Here are your **${jobs.length} active jobs**:\n\n`;
      for (const j of jobs) {
        const client = j.clientName || 'No client';
        reply += `- **#${j.number} ${j.name}** — ${client}\n`;
      }

      return { agentName: 'Know it All', reply: reply.trim(), needsConfirmation: false };
    } catch (err: any) {
      console.error('[FAST-PATH] Error fetching jobs:', err?.message);
      return { agentName: 'Know it All', reply: 'Having trouble fetching jobs right now. Please try again in a moment.', needsConfirmation: false };
    }
  }

  return null; // No fast path matched
}

// ── FAST PATH: Execute confirmed task creation without the full Claude tool loop ──
// When the user approves a task via the confirmation card, we have all the data needed
// to create it directly — no Claude reasoning required.
async function tryTaskCreationFastPath(msg: string, ctx: AgentContext, messages?: Array<{ role: string; content: string }>): Promise<AgentResult | null> {
  // Only trigger on messages with approved task data
  if (!APPROVED_TASK_PATTERN.test(msg)) return null;

  // Extract the JSON from the message
  const jsonMatch = msg.match(/\[APPROVED TASK DATA[^\]]*\]\s*([\s\S]*?)$/);
  if (!jsonMatch) return null;

  let taskData: any;
  try {
    taskData = JSON.parse(jsonMatch[1].trim());
  } catch {
    console.error('[FAST-TASK] Failed to parse task data JSON');
    return null; // Fall through to Claude if JSON is malformed
  }

  console.log('[FAST-TASK] Detected confirmed task creation:', taskData.name, '| phase:', taskData.phase);

  // Resolve jobId: context first, then taskData.jobId from the confirmation block
  let jobId = ctx.jtJobId || taskData.jobId;
  if (!jobId) {
    console.log('[FAST-TASK] No jobId from context or taskData, searching conversation...');
    const allText = (messages || []).map(m => m.content).join(' ');

    // Strategy 1: Try Supabase fuzzy search with key terms from conversation
    // Extract potential job names — look for common patterns like "on the X project", "for X", etc.
    const jobNamePatterns = [
      /(?:on|for|in)\s+(?:the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s+(?:project|job)/gi,
      /(?:project|job)\s+(?:called\s+|named\s+)?["']?([A-Z][A-Za-z]+(?:\s+[A-Za-z]+)*)["']?/gi,
    ];
    for (const pattern of jobNamePatterns) {
      let match;
      while ((match = pattern.exec(allText)) !== null) {
        try {
          const found = await findJTJobByName(match[1].trim());
          if (found) {
            jobId = found.id;
            console.log('[FAST-TASK] Resolved jobId via Supabase:', found.name, '| ID:', found.id);
            break;
          }
        } catch { /* non-fatal */ }
      }
      if (jobId) break;
    }

    // Strategy 2: Search active jobs by name mentioned anywhere in the conversation
    if (!jobId) {
      try {
        const activeJobs = await getActiveJobs();
        const allJobs = activeJobs || [];
        const lowerText = allText.toLowerCase();
        for (const job of allJobs) {
          const jName = (job.name || '').toLowerCase();
          if (jName && lowerText.includes(jName)) {
            jobId = job.id;
            console.log('[FAST-TASK] Resolved jobId from active jobs:', job.name, '| ID:', job.id);
            break;
          }
        }
      } catch (e) { console.error('[FAST-TASK] getActiveJobs failed:', e); }
    }
  }
  if (!jobId) {
    return { agentName: 'Know it All', reply: 'I need a project selected to create a task. Please select a project from the dropdown first.', needsConfirmation: false };
  }

  try {
    // Step 1: Find the phase ID — use phaseId from approved data first, fall back to name lookup
    let parentGroupId: string | null = null;

    if (taskData.phaseId && !taskData.phaseChanged) {
      // User didn't change the phase — use the phaseId directly from confirmation data
      parentGroupId = taskData.phaseId;
      console.log('[FAST-TASK] Using phaseId from approved data:', parentGroupId);
    } else {
      // Phase was changed or no phaseId — look up by name from the job schedule
      const schedule = await getJobSchedule(jobId);
      if (schedule?.phases) {
        const phaseName = (taskData.phase || '').toLowerCase();
        const phase = schedule.phases.find((t: any) =>
          t.isGroup && t.name.toLowerCase().includes(phaseName)
        );
        if (phase) {
          parentGroupId = phase.id;
          console.log('[FAST-TASK] Found phase by name:', phase.name, '| ID:', phase.id);
        }
      }
    }

    // Step 2: Find the assignee's membership ID
    let assignedMembershipIds: string[] | undefined;
    let assignedName = '';
    if (taskData.assignee) {
      try {
        const members = await getMembers();
        const search = taskData.assignee.toLowerCase();
        const match = members.find((m: any) => {
          const mName = (m.user?.name || '').toLowerCase();
          return mName.includes(search) || search.includes(mName.split(' ')[0]);
        });
        if (match) {
          assignedMembershipIds = [match.id];
          assignedName = match.user?.name || '';
          console.log('[FAST-TASK] Found assignee:', assignedName, '| ID:', match.id);
        }
      } catch { /* ignore member lookup failures */ }
    }

    // Step 3: Normalize dates — all new tasks are 1-day tasks.
    // PAVE requires both startDate and endDate if either is set.
    let startDate = taskData.startDate || taskData.endDate || undefined;
    let endDate = startDate; // Force 1-day task

    // Step 4: Create the task
    let result: any;
    let warning = '';
    if (parentGroupId) {
      result = await createPhaseTask({
        jobId,
        parentGroupId,
        name: taskData.name,
        description: taskData.description,
        startDate,
        endDate,
        assignedMembershipIds,
      });
      if (result.warning) warning = '\n\n⚠️ ' + result.warning;
    } else {
      // No phase found — create at job level
      result = await createTask({
        jobId,
        name: taskData.name,
        description: taskData.description,
        startDate,
        endDate,
        assignedMembershipIds,
      });
      if (taskData.phase) {
        warning = `\n\n⚠️ The "${taskData.phase}" phase wasn't found on this project, so the task was created at the job level. You can drag it into the correct phase in JobTread.`;
      }
    }

    console.log('[FAST-TASK] Task created:', result?.id, result?.name);

    // Build simple success reply
    const parts = [`✅ **${taskData.name}** created`];
    if (assignedName) parts.push(`assigned to ${assignedName}`);
    if (taskData.endDate) parts.push(`due ${taskData.endDate}`);
    let reply = parts.join(', ') + '.';
    if (warning) reply += warning;

    return { agentName: 'Know it All', reply: reply.trim(), needsConfirmation: false };
  } catch (err: any) {
    console.error('[FAST-TASK] Error creating task:', err?.message);
    return { agentName: 'Know it All', reply: 'Sorry, I ran into an error creating the task: ' + (err?.message || 'Unknown error') + '. Please try again.', needsConfirmation: false };
  }
}

// ── FAST PATH: Execute a confirmed generic write action without the full Claude tool loop ──
// When the user approves an action via the @@ACTION_CONFIRM@@ card, we have everything
// needed to run the tool directly — no Claude reasoning required. This also guarantees
// the tool args exactly match what the user saw on screen (no hallucination drift).
async function tryActionApprovalFastPath(
  msg: string,
  ctx: AgentContext,
  lastAgent?: string
): Promise<AgentResult | null> {
  if (!APPROVED_ACTION_PATTERN.test(msg)) return null;

  // Extract: [APPROVED ACTION <anything>]\n<JSON payload>
  const match = msg.match(/\[APPROVED ACTION[^\]]*\]\s*([\s\S]*?)$/);
  if (!match) return null;

  let approved: any;
  try {
    approved = JSON.parse(match[1].trim());
  } catch {
    console.error('[FAST-ACTION] Failed to parse approved action JSON');
    return null;
  }

  const tool: string | undefined = approved?.tool;
  const payload: any = approved?.payload ?? approved?.input ?? {};
  if (!tool || typeof tool !== 'string') {
    console.error('[FAST-ACTION] Missing tool name on approved action');
    return null;
  }

  if (!GATED_WRITE_TOOLS.has(tool)) {
    // Not a tool we gate — fall through to normal agent handling
    return null;
  }

  // Pick the agent that owns the tool (defaults to know-it-all — the only agent that registers these writes)
  const agent = (lastAgent && AGENT_MAP[lastAgent]) || knowItAll;

  console.log('[FAST-ACTION] Executing approved write:', tool, 'summary:', approved.summary);

  try {
    const result = await agent.executeTool(tool, payload, ctx);
    // The tool result is already JSON. Build a short user-facing confirmation.
    let parsed: any = null;
    try { parsed = JSON.parse(result); } catch { /* non-JSON — fine */ }
    const title = approved.title || 'Action';
    if (parsed && parsed.success === false) {
      return {
        agentName: agent.name,
        reply: '❌ ' + title + ' failed: ' + (parsed.error || 'Unknown error'),
        needsConfirmation: false,
      };
    }
    // Prefer a human-readable confirmation using the original summary
    const summary = approved.summary ? ' ' + approved.summary.replace(/\.$/, '') + '.' : '';
    return {
      agentName: agent.name,
      reply: '✅ ' + title + ' completed.' + summary,
      needsConfirmation: false,
    };
  } catch (err: any) {
    console.error('[FAST-ACTION] Tool execution error:', err?.message);
    return {
      agentName: agent.name,
      reply: '❌ Could not complete that action: ' + (err?.message || 'Unknown error'),
      needsConfirmation: false,
    };
  }
}

export async function routeMessage(
  messages: Array<{ role: string; content: string }>,
  ctx: AgentContext,
  lastAgent?: string,
  forcedAgent?: string
): Promise<AgentResult> {
  const lastMsg = messages[messages.length - 1]?.content || '';

  // ── TRY FAST PATHS FIRST (bypasses Claude tool loop) ──
  const fastResult = await tryFastPath(lastMsg, ctx);
  if (fastResult) return fastResult;

  // Fast-path for confirmed task creation (after user approves via confirmation card)
  const taskResult = await tryTaskCreationFastPath(lastMsg, ctx, messages);
  if (taskResult) return taskResult;

  // Fast-path for any other confirmed JT write (after user approves via action card)
  const actionResult = await tryActionApprovalFastPath(lastMsg, ctx, lastAgent);
  if (actionResult) return actionResult;

  // ── TRANSCRIPT PRE-SAVE BYPASS ──
  // If the message looks like a transcript (long + keywords), save the raw text
  // directly to Supabase BEFORE sending to Claude. Claude still sees the full
  // text for analysis but does NOT need to echo it back through log_project_event.
  // This saves thousands of output tokens on transcript submissions.
  let transcriptPreSaveId: string | null = null;
  let transcriptWordCount = 0;
  const isTranscript = lastMsg.length > 2000 &&
    /transcript|meeting notes|here'?s the|meeting with|we discussed|we met|we talked/i.test(lastMsg);

  if (isTranscript && ctx.jtJobId) {
    try {
      // Strip the frontend-injected [Context: ...] prefix before saving.
      // The frontend prepends job context to every message but it's metadata,
      // not part of the actual transcript content.
      const cleanedTranscript = lastMsg.replace(/^\[Context:[^\]]*\]\s*/i, '');
      transcriptWordCount = cleanedTranscript.split(/\s+/).length;
      const event = await createProjectEvent({
        job_id: ctx.jtJobId,
        channel: 'meeting',
        event_type: 'meeting_held',
        summary: '[Transcript pending analysis — full text saved]',
        detail: cleanedTranscript,
        participants: null,
      });
      transcriptPreSaveId = event.id;
      console.log('[ROUTER] Pre-saved transcript as event', event.id, '— ' + transcriptWordCount + ' words');
    } catch (preSaveErr) {
      console.error('[ROUTER] Transcript pre-save failed:', preSaveErr);
      // Fall through — Claude will handle it the normal way
    }
  }

  // Select the best agent for this message
  const agent = selectAgent(lastMsg, lastAgent, forcedAgent);

  // Fetch context data specific to this agent
  const contextData = await agent.fetchContext(ctx);

  // Build Claude messages
  const claudeMessages: any[] = messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // If transcript was pre-saved, inject a notice so Claude knows the raw text
  // is already stored and it only needs to update the summary/eventDate
  if (transcriptPreSaveId) {
    const lastIdx = claudeMessages.length - 1;
    claudeMessages[lastIdx].content =
      `[TRANSCRIPT AUTO-SAVED: The full raw transcript (${transcriptWordCount} words) has already been saved to project memory as event ID "${transcriptPreSaveId}" for job ${ctx.jtJobId}. ` +
      `The detail field contains the complete text. When you call log_project_event for this meeting, do NOT include the transcript in the "detail" field — it is already saved. ` +
      `Instead, just provide your summary, participants, eventDate, and set detail to "See event ${transcriptPreSaveId} for full transcript". ` +
      `Then update the pre-saved event's summary by calling update_project_event with eventId="${transcriptPreSaveId}" and the real summary once Nathan provides the date.]\n\n` +
      claudeMessages[lastIdx].content;
  }

  // Inject context into the last user message
  if (contextData) {
    const contextBlock =
      '\n\n--- SYSTEM DATA (use this to answer the question) ---\n' +
      (ctx.contactName ? 'Selected Client: ' + ctx.contactName + '\n' : '') +
      (ctx.opportunityName ? 'Selected Opportunity: ' + ctx.opportunityName + '\n' : '') +
      (ctx.jtJobId ? 'JobTread Job ID: ' + ctx.jtJobId + '\n' : '') +
      (ctx.pipelineStage ? 'Pipeline Stage: ' + ctx.pipelineStage + '\n' : '') +
      (ctx.communicationChannel !== 'unknown'
        ? 'Communication Channel: ' + ctx.communicationChannel.toUpperCase() + '\n'
        : '') +
      '\n' +
      contextData +
      '\n--- END SYSTEM DATA ---';

    const lastIdx = claudeMessages.length - 1;
    claudeMessages[lastIdx].content = claudeMessages[lastIdx].content + contextBlock;
  }

  const systemPrompt = agent.systemPrompt(ctx, lastMsg);

  // Use higher output token limit for long messages (transcripts, long emails, etc.)
  // so the AI can pass the full content through tool calls without truncation
  const isLongInput = lastMsg.length > 3000 || /transcript|meeting notes|here'?s the/i.test(lastMsg);
  const maxTokens = isLongInput ? 16000 : 4096;

  // Call Claude (with tools if agent has them)
  const createParams: any = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: claudeMessages,
  };

  if (agent.tools.length > 0) {
    createParams.tools = agent.tools;
  }

  console.log('[ROUTER] System prompt length:', systemPrompt.length, 'chars');
  console.log('[ROUTER] Tools count:', agent.tools.length);
  console.log('[ROUTER] Messages count:', claudeMessages.length);

  let response: any;
  try {
    response = await callClaudeWithRetry(createParams);
  } catch (initErr: any) {
    console.error('[ROUTER] Initial API call failed:', initErr?.message);
    return {
      agentName: agent.name,
      reply: 'Sorry, the AI service returned an error: ' + (initErr?.message || 'Unknown error').substring(0, 200),
      needsConfirmation: false,
    };
  }

  console.log('[ROUTER] Initial response: stop_reason=', response.stop_reason, 'blocks=', response.content?.map((b: any) => b.type).join(','), 'usage=', JSON.stringify(response.usage));

  // Collect file links from tool results BEFORE they get truncated
  const _collectedFileLinks: Array<{ name: string; url: string; context: string }> = [];

  // Handle tool use loop. Budget reasoning:
  // - chat/route.ts has maxDuration=120 on Vercel
  // - We hold 105s for the tool loop to leave ~15s headroom for finalization
  //   (formatting reply, server-side file-link append, response serialization)
  // - 8 iterations gives the agent room for a fixtures-style flow that legitimately
  //   needs multiple tool calls (e.g. get_project_details with one search, then a
  //   wider search if the first returns nothing).
  let iterations = 0;
  const routeStart = Date.now();
  const MAX_ITERATIONS = 8;
  const TIME_BUDGET_MS = 105_000;
  while (response.stop_reason === 'tool_use' && iterations < MAX_ITERATIONS) {
    if (Date.now() - routeStart > TIME_BUDGET_MS) {
      console.log('[ROUTER] Breaking tool loop:', Math.round((Date.now() - routeStart) / 1000) + 's exceeded ' + (TIME_BUDGET_MS / 1000) + 's safety limit');
      break;
    }
    iterations++;

    claudeMessages.push({ role: 'assistant', content: response.content });

    const toolResults: any[] = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        console.log('[ROUTER] Calling tool:', block.name);

        // GUARDRAIL: Block direct task creation without user approval
        if (block.name === 'create_phase_task' || block.name === 'create_jobtread_task') {
          const hasApproval = claudeMessages.some(
            (m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[APPROVED TASK DATA')
          );
          if (!hasApproval) {
            console.log('[ROUTER] BLOCKED:', block.name, '— no [APPROVED TASK DATA] found in conversation');
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({
                success: false,
                error: 'TASK CREATION BLOCKED: You must output a @@TASK_CONFIRM@@ block first and wait for user approval. Do NOT call create_phase_task or create_jobtread_task directly. Output the confirmation block now with the task details so the user can review and approve.',
              }),
            });
            continue;
          }
        }

        // GUARDRAIL: Block every OTHER JobTread write tool without an approval marker.
        // Forces the agent to output an @@ACTION_CONFIRM@@ block and wait for the
        // user to click Approve on the summary card.
        if (GATED_WRITE_TOOLS.has(block.name)) {
          const hasApproval = claudeMessages.some(
            (m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[APPROVED ACTION')
          );
          if (!hasApproval) {
            console.log('[ROUTER] BLOCKED:', block.name, '— no [APPROVED ACTION] found in conversation');
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({
                success: false,
                error: 'WRITE BLOCKED: ' + block.name + ' is a JobTread write and requires user approval. Output a @@ACTION_CONFIRM@@ block with {tool, title, summary, details, payload} describing exactly what will happen, then STOP. The user will click the green Approve button on the summary card. Do NOT call this tool again until the next user message contains [APPROVED ACTION].',
              }),
            });
            continue;
          }
        }

        const result = await agent.executeTool(block.name, block.input, ctx);
        console.log('[ROUTER] Tool result length:', result?.length || 0);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    // Extract _fileLinks from tool results BEFORE truncation (prevents data loss)
    // and strip them from the content sent to Claude (AI doesn't need URLs)
    for (const tr of toolResults) {
      if (typeof tr.content === 'string') {
        try {
          const parsed = JSON.parse(tr.content);
          if (Array.isArray(parsed._fileLinks)) {
            for (const fl of parsed._fileLinks) {
              if (fl.name && fl.url && !_collectedFileLinks.some(e => e.url === fl.url)) {
                _collectedFileLinks.push(fl);
              }
            }
            // Remove _fileLinks from the JSON sent to Claude to save tokens
            delete parsed._fileLinks;
            tr.content = JSON.stringify(parsed);
          }
        } catch { /* not JSON — skip */ }
      }
    }

    // Truncate oversized tool results to prevent "request too large" errors.
    // Allow up to 40K per result to accommodate full transcripts and long details.
    // Sonnet supports 200K context so this is well within budget for typical usage.
    const TOOL_RESULT_LIMIT = 40_000;
    for (const tr of toolResults) {
      if (typeof tr.content === 'string' && tr.content.length > TOOL_RESULT_LIMIT) {
        tr.content = tr.content.substring(0, TOOL_RESULT_LIMIT) + '\n...(truncated — full content is ' + tr.content.length + ' chars. Use get_event_detail for specific events.)';
      }
    }

    claudeMessages.push({ role: 'user', content: toolResults });

    try {
      response = await callClaudeWithRetry({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt,
        tools: agent.tools.length > 0 ? agent.tools : undefined,
        messages: claudeMessages,
      });
      console.log('[ROUTER] Loop', iterations, 'response: stop_reason=', response.stop_reason, 'blocks=', response.content?.map((b: any) => b.type).join(','), 'usage=', JSON.stringify(response.usage));
    } catch (apiErr: any) {
      // If the API rejects due to size, return what we have so far
      console.error('[ROUTER] API error in tool loop iteration', iterations, ':', apiErr?.message);
      const toolData = toolResults.map(tr => tr.content).join('\n');
      return {
        agentName: agent.name,
        reply: 'Here is the raw data from your query (the response was too large to format fully):\n\n' + toolData.substring(0, 8000),
        needsConfirmation: false,
      };
    }
  }

  // Extract text from response (collect from ALL content blocks, including partial tool-use responses)
  let reply = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      reply += block.text;
    }
  }

  console.log('[ROUTER] Final reply length:', reply.length, 'stop_reason:', response.stop_reason);

  // ── SERVER-SIDE FILE LINK APPENDING ──
  // Append real file links collected during the tool loop.
  // This bypasses the AI entirely — real file IDs from the PAVE API are used
  // instead of relying on the AI to reproduce them (which causes hallucination).
  if (_collectedFileLinks.length > 0) {
    console.log('[ROUTER] Appending', _collectedFileLinks.length, 'server-side file links');
    reply += '\n\n---\n📄 **Related Documents** (' + _collectedFileLinks.length + ' files)\n';
    for (const fl of _collectedFileLinks) {
      reply += '\n[📎 ' + fl.name + '](' + fl.url + ')';
      if (fl.context) reply += '  \n*' + fl.context + '*';
    }
  }

  // If we broke out of the loop early (time/iteration limit), append a note.
  // Be context-aware: don't tell the user to "select a project" if one is
  // already selected — that was the misleading bit Nathan flagged.
  if (response.stop_reason === 'tool_use') {
    const hint = ctx.jtJobId
      ? 'Try a narrower question (e.g. include a specific room or fixture type — "what faucets are in the master bath?") and the agent will finish faster.'
      : 'Try selecting a project first, or ask a more specific question.';
    if (reply) {
      reply += '\n\n*(Hit the processing-time limit before the agent finished. ' + hint + ')*';
    } else {
      reply = 'The agent was still gathering data when the time limit hit. ' + hint;
    }
  }

  if (!reply) reply = 'No response generated. The query may have been too broad — try selecting a specific project or asking a more targeted question.';

  // Detect if the agent is asking for confirmation (only for write operations, not casual suggestions)
  // The @@TASK_CONFIRM@@ flow already sets needsConfirmation via taskConfirm in chat/route.ts
  // This regex catches non-structured confirmation requests for other write ops
  const needsConfirmation = /shall i proceed\??|should i proceed\??|want me to proceed\??|confirm.*proceed|go ahead\?|ready to execute/i.test(reply);

  return {
    agentName: agent.name,
    reply,
    needsConfirmation,
  };
}

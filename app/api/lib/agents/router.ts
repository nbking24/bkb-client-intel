// @ts-nocheck
import Anthropic from '@anthropic-ai/sdk';
import { AgentModule, AgentContext, AgentResult } from './types';
import knowItAll from './know-it-all';
import projectDetails from './project-details';
import { getActiveJobs, getTasksForJob, getJobSchedule, getMembers, createPhaseTask, createTask } from '@/app/lib/jobtread';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Registry of all available agents
// Know-it-All now handles BOTH read and write JT operations (merged with former JT Entry)
const AGENTS: AgentModule[] = [
  knowItAll,
  projectDetails,
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

  // Pattern: "list open tasks", "show my tasks", "what are my open tasks", etc.
  if (/\b(list|show|give|what|get)\b.*\b(open|incomplete|pending|my)\b.*\btask/i.test(stripped) ||
      /\btask.*\b(open|incomplete|pending|list)\b/i.test(stripped)) {
    console.log('[FAST-PATH] Detected open tasks query');
    try {
      // Approach: get active jobs, then fetch tasks per job (avoids 413 from org-level task query)
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
async function tryTaskCreationFastPath(msg: string, ctx: AgentContext): Promise<AgentResult | null> {
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

  const jobId = ctx.jtJobId;
  if (!jobId) {
    return { agentName: 'Know it All', reply: 'I need a project selected to create a task. Please select a project from the dropdown first.', needsConfirmation: false };
  }

  try {
    // Step 1: Find the phase ID from the job schedule
    let parentGroupId: string | null = null;
    const schedule = await getJobSchedule(jobId);
    if (schedule?.tasks) {
      const phaseName = (taskData.phase || '').toLowerCase();
      // Look for a matching phase (group task) in the schedule
      const phase = schedule.tasks.find((t: any) =>
        t.isGroup && t.name.toLowerCase().includes(phaseName)
      );
      if (phase) {
        parentGroupId = phase.id;
        console.log('[FAST-TASK] Found phase:', phase.name, '| ID:', phase.id);
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

    // Step 3: Create the task
    let result: any;
    let warning = '';
    if (parentGroupId) {
      result = await createPhaseTask({
        jobId,
        parentGroupId,
        name: taskData.name,
        description: taskData.description,
        startDate: taskData.startDate,
        endDate: taskData.endDate,
        assignedMembershipIds,
      });
      if (result.warning) warning = '\n\n⚠️ ' + result.warning;
    } else {
      // No phase found — create at job level
      result = await createTask({
        jobId,
        name: taskData.name,
        description: taskData.description,
        startDate: taskData.startDate,
        endDate: taskData.endDate,
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
  const taskResult = await tryTaskCreationFastPath(lastMsg, ctx);
  if (taskResult) return taskResult;

  // Select the best agent for this message
  const agent = selectAgent(lastMsg, lastAgent, forcedAgent);

  // Fetch context data specific to this agent
  const contextData = await agent.fetchContext(ctx);

  // Build Claude messages
  const claudeMessages: any[] = messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

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

  // Call Claude (with tools if agent has them)
  const createParams: any = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
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
    response = await anthropic.messages.create(createParams);
  } catch (initErr: any) {
    console.error('[ROUTER] Initial API call failed:', initErr?.message);
    return {
      agentName: agent.name,
      reply: 'Sorry, the AI service returned an error: ' + (initErr?.message || 'Unknown error').substring(0, 200),
      needsConfirmation: false,
    };
  }

  console.log('[ROUTER] Initial response: stop_reason=', response.stop_reason, 'blocks=', response.content?.map((b: any) => b.type).join(','), 'usage=', JSON.stringify(response.usage));

  // Handle tool use loop (max 5 iterations — 90s safety timer is the real guard)
  let iterations = 0;
  const routeStart = Date.now();
  while (response.stop_reason === 'tool_use' && iterations < 5) {
    // Safety: if we've used more than 90 seconds, break out to avoid Vercel timeout
    if (Date.now() - routeStart > 90_000) {
      console.log('[ROUTER] Breaking tool loop: 90s safety limit');
      break;
    }
    iterations++;

    claudeMessages.push({ role: 'assistant', content: response.content });

    const toolResults: any[] = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        console.log('[ROUTER] Calling tool:', block.name);
        const result = await agent.executeTool(block.name, block.input, ctx);
        console.log('[ROUTER] Tool result length:', result?.length || 0);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    // Truncate oversized tool results to prevent "request too large" errors
    for (const tr of toolResults) {
      if (typeof tr.content === 'string' && tr.content.length > 12000) {
        tr.content = tr.content.substring(0, 12000) + '\n...(truncated — too many results to show all)';
      }
    }

    claudeMessages.push({ role: 'user', content: toolResults });

    try {
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
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

  // If we broke out of the loop early (time limit), append a note
  if (response.stop_reason === 'tool_use' && reply) {
    reply += '\n\n*(Response was truncated due to processing time. Try a more specific query or select a project first.)*';
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

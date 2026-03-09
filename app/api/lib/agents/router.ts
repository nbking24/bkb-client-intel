// @ts-nocheck
import Anthropic from '@anthropic-ai/sdk';
import { AgentModule, AgentContext, AgentResult } from './types';
import knowItAll from './know-it-all';
import projectDetails from './project-details';

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

export async function routeMessage(
  messages: Array<{ role: string; content: string }>,
  ctx: AgentContext,
  lastAgent?: string,
  forcedAgent?: string
): Promise<AgentResult> {
  const lastMsg = messages[messages.length - 1]?.content || '';

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

  // Handle tool use loop (max 3 iterations to stay within Vercel timeout)
  let iterations = 0;
  const routeStart = Date.now();
  while (response.stop_reason === 'tool_use' && iterations < 3) {
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

  // Detect if the agent is asking for confirmation
  const needsConfirmation = /shall i proceed|should i proceed|want me to proceed|confirm.*proceed|go ahead\?|want me to go ahead|ready to execute|want me to update|want me to create|want me to delete|want me to apply|want me to move/i.test(reply);

  return {
    agentName: agent.name,
    reply,
    needsConfirmation,
  };
}

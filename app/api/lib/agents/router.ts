// @ts-nocheck
import Anthropic from '@anthropic-ai/sdk';
import { AgentModule, AgentContext, AgentResult } from './types';
import knowItAll from './know-it-all';
import jtEntry from './jt-entry';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Registry of all available agents
const AGENTS: AgentModule[] = [
  knowItAll,
  jtEntry,
  // Future: emailKid, designDolly
];

const AGENT_MAP: Record<string, AgentModule> = {};
for (const a of AGENTS) AGENT_MAP[a.name] = a;

// Short confirmation phrases that should stick with the previous agent
const CONFIRMATION_PATTERN = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|confirmed|proceed|approve|go for it|absolutely|please|please do|that's correct|correct|right|affirmative)\s*[.!]?$/i;

// Follow-up pattern: short messages that look like the user is providing info requested by the last agent
// (job names, IDs, dates, names, etc.) — not a new question
const FOLLOWUP_PATTERN = /^[^?]{1,80}$/; // Short message (<=80 chars) with no question mark

function selectAgent(message: string, lastAgentName?: string): AgentModule {
  const trimmed = message.trim();

  if (lastAgentName && AGENT_MAP[lastAgentName]) {
    // If the last response was from an agent and this looks like a confirmation, keep same agent
    if (CONFIRMATION_PATTERN.test(trimmed)) {
      return AGENT_MAP[lastAgentName];
    }

    // If the message is short and looks like a follow-up answer (no question mark, short),
    // keep the same agent — the user is likely providing info the agent asked for
    if (FOLLOWUP_PATTERN.test(trimmed)) {
      // But only if no other agent scores really high (>0.9) — explicit new requests should still re-route
      let maxOtherScore = 0;
      for (const agent of AGENTS) {
        if (agent.name !== lastAgentName) {
          maxOtherScore = Math.max(maxOtherScore, agent.canHandle(trimmed));
        }
      }
      // Keep last agent unless another agent is very confident this is their domain
      if (maxOtherScore < 0.9) {
        return AGENT_MAP[lastAgentName];
      }
    }
  }

  let best: AgentModule = knowItAll; // default fallback
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
  lastAgent?: string
): Promise<AgentResult> {
  const lastMsg = messages[messages.length - 1]?.content || '';

  // Select the best agent for this message
  const agent = selectAgent(lastMsg, lastAgent);

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

  const systemPrompt = agent.systemPrompt(ctx);

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

  let response = await anthropic.messages.create(createParams);

  // Handle tool use loop (max 5 iterations)
  let iterations = 0;
  while (response.stop_reason === 'tool_use' && iterations < 5) {
    iterations++;

    claudeMessages.push({ role: 'assistant', content: response.content });

    const toolResults: any[] = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const result = await agent.executeTool(block.name, block.input, ctx);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    claudeMessages.push({ role: 'user', content: toolResults });

    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools: agent.tools.length > 0 ? agent.tools : undefined,
      messages: claudeMessages,
    });
  }

  // Extract text from response
  let reply = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      reply += block.text;
    }
  }

  if (!reply) reply = 'No response generated.';

  // Detect if the agent is asking for confirmation (for the UI to show a confirm button)
  const needsConfirmation = /shall i proceed|should i proceed|want me to proceed|confirm.*proceed|go ahead\?|want me to go ahead|ready to execute|want me to update|want me to create|want me to delete|want me to apply|want me to move/i.test(reply);

  return {
    agentName: agent.name,
    reply,
    needsConfirmation,
  };
}

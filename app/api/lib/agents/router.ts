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

function selectAgent(message: string): AgentModule {
  let best: AgentModule = knowItAll;  // default fallback
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
  ctx: AgentContext
): Promise<AgentResult> {
  const lastMsg = messages[messages.length - 1]?.content || '';

  // Select the best agent for this message
  const agent = selectAgent(lastMsg);

  // Fetch context data specific to this agent
  const contextData = await agent.fetchContext(ctx);

  // Build Claude messages
  const claudeMessages: any[] = messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Inject context into the last user message
  if (contextData) {
    const contextBlock = '\n\n--- SYSTEM DATA (use this to answer the question) ---\n' +
      (ctx.contactName ? 'Selected Client: ' + ctx.contactName + '\n' : '') +
      (ctx.opportunityName ? 'Selected Opportunity: ' + ctx.opportunityName + '\n' : '') +
      (ctx.jtJobId ? 'JobTread Job ID: ' + ctx.jtJobId + '\n' : '') +
      (ctx.pipelineStage ? 'Pipeline Stage: ' + ctx.pipelineStage + '\n' : '') +
      (ctx.communicationChannel !== 'unknown' ? 'Communication Channel: ' + ctx.communicationChannel.toUpperCase() + '\n' : '') +
      '\n' + contextData +
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

  return {
    agentName: agent.name,
    reply,
  };
}


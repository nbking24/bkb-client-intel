// @ts-nocheck
import Anthropic from '@anthropic-ai/sdk';

// Pipeline stages where communication goes through GHL
export const GHL_STAGES = new Set([
  'new inquiry',
  'initial call scheduled',
  'discovery scheduled',
  'no-show',
  'nurture',
  'completed',
  'closed/not interested',
  'gbp review requested',
]);

// Pipeline stages where communication goes through JobTread
export const JT_STAGES = new Set([
  'leads',
  'in-design',
  'ready',
  'in-production',
  'final billing',
]);

export type CommChannel = 'ghl' | 'jobtread' | 'unknown';

export function getCommChannel(stageName: string): CommChannel {
  const lower = (stageName || '').toLowerCase().trim();
  if (GHL_STAGES.has(lower)) return 'ghl';
  if (JT_STAGES.has(lower)) return 'jobtread';
  return 'unknown';
}

export interface AgentContext {
  contactId?: string;
  contactName?: string;
  opportunityId?: string;
  opportunityName?: string;
  jtJobId?: string;
  pipelineStage?: string;
  communicationChannel: CommChannel;
}

export interface AgentResult {
  agentName: string;
  reply: string;
  handoffTo?: string;  // if this agent wants to delegate to another
}

export interface AgentModule {
  name: string;
  description: string;
  icon: string;
  systemPrompt: (ctx: AgentContext) => string;
  tools: Anthropic.Tool[];
  canHandle: (message: string) => number;  // 0-1 confidence
  fetchContext: (ctx: AgentContext) => Promise<string>;
  executeTool: (name: string, input: any, ctx: AgentContext) => Promise<string>;
}


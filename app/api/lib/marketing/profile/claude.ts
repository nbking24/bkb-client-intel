// @ts-nocheck
/**
 * One forced tool call to Claude that must return JSON matching a schema.
 * Used by the profile parser and writer so their output is always shaped
 * correctly.
 *
 * Style note: no em or en dashes in this file.
 */
import Anthropic from '@anthropic-ai/sdk';

export const PROFILE_MODEL = 'claude-sonnet-4-6';

export async function callForJson<T>(opts: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, any>;
  maxTokens?: number;
}): Promise<T> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await anthropic.messages.create({
    model: PROFILE_MODEL,
    max_tokens: opts.maxTokens || 16000,
    temperature: 0.3,
    system: opts.system,
    tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: opts.schema as any }],
    tool_choice: { type: 'tool', name: opts.toolName },
    messages: [{ role: 'user', content: opts.user }],
  });
  const block: any = res.content.find((b: any) => b.type === 'tool_use');
  if (!block) throw new Error('Claude returned no structured result');
  if (res.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing the profile');
  return block.input as T;
}

// Shared JSON schema pieces for ProfileContent.
const str = { type: 'string' };
const strArr = { type: 'array', items: str };

export const imageIdSchema = { type: 'string', description: 'An image id from the outline, such as img3, or a new photo id such as new2' };

export const sectionSchema = {
  type: 'object',
  description:
    'One section. kind paragraphs: heading + paragraphs. kind scope: heading + groups of subhead and bullets. kind challenges: heading + pairs. kind leadBullets: bullets with a bold lead phrase. kind bullets: plain bullets. kind photos: heading + intro + photos with captions.',
  properties: {
    kind: { type: 'string', enum: ['paragraphs', 'scope', 'challenges', 'leadBullets', 'bullets', 'photos'] },
    heading: str,
    intro: str,
    paragraphs: strArr,
    bullets: strArr,
    groups: { type: 'array', items: { type: 'object', properties: { heading: str, bullets: strArr }, required: ['heading', 'bullets'] } },
    pairs: { type: 'array', items: { type: 'object', properties: { challenge: str, solution: str }, required: ['challenge', 'solution'] } },
    items: { type: 'array', items: { type: 'object', properties: { lead: str, text: str }, required: ['lead', 'text'] } },
    photos: { type: 'array', items: { type: 'object', properties: { image: imageIdSchema, caption: str }, required: ['image', 'caption'] } },
  },
  required: ['kind', 'heading'],
};

export const profileSchema = {
  type: 'object',
  properties: {
    title: str,
    subtitle: str,
    tagline: str,
    whatsNew: {
      type: 'array',
      description: 'Newest first',
      items: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, text: str }, required: ['date', 'text'] },
    },
    facts: { type: 'array', items: { type: 'object', properties: { label: str, value: str }, required: ['label', 'value'] } },
    sections: { type: 'array', items: sectionSchema },
  },
  required: ['title', 'subtitle', 'tagline', 'whatsNew', 'facts', 'sections'],
};

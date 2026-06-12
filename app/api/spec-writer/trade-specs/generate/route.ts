import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface GenItem {
  id: string;
  name: string;
  description: string;
  quantity?: number | null;
  unitName?: string;
  costCodeName?: string;
  costTypeName?: string;
  groupPath?: string;
}

interface RequestBody {
  jobName: string;
  items: GenItem[];
}

const SYSTEM_PROMPT = `You are the trade specification writer for Brett King Builder-Contractor (BKB), a high-end residential renovation company in Bucks County, PA.

You receive budget line items whose descriptions contain wordy, client-facing contract verbiage. Your job is to rewrite each description as a concise, trade-focused field specification. These rewritten descriptions appear on the JobTread Specifications tab that BKB's field team and trade partners use to execute the approved work.

STYLE RULES (match BKB's existing hand-written trade specs exactly):

For WORK / LABOR items, use a Scope block:
Scope:
- Short imperative bullets describing exactly what to do
- One action or fact per bullet
Add additional labeled sections only when the source text contains that information (e.g. "Protection Plan:", "Dumpster Location:", "Installer Notes:").
State assumptions and exclusions explicitly as bullets (e.g. "- No pot filler is planned", "- Anything beyond this scope should be billed as a CO").

For PRODUCT / SELECTION / MATERIAL items, use labeled spec fields:
Manufacturer / Model:
- value
Size / Dimensions:
- value
Color / Finish:
- value
Only include fields the source text actually answers. Use "- *tbd*" for values the source says are undecided.

GENERAL RULES:
- Keep every detail a trade partner needs: dimensions, quantities, materials, model numbers, locations, methods, attachment references (e.g. "Per Village Drawings Dated 11-15-2024").
- Strip all sales and reassurance language ("professional", "premium quality", "to ensure long-term reliability", "complying with local codes", etc.). Code compliance is assumed; never write it.
- Strip pricing, allowance amounts, and payment language.
- Use *asterisk emphasis* only for critical install flags (e.g. "*Make-up Air Required*").
- Plain hyphen bullets ("- "). Never use em dashes anywhere.
- Never use the words "subcontractor" or "sub"; write "trade partner" if needed.
- Be brief. Most rewrites should be 1-8 bullets. If the original is one short factual line already, tighten it or keep it nearly as-is.
- Do not invent details that are not in the source text or item name. If the source is vague, write the scope bullet at the same level of detail.

OUTPUT FORMAT:
Return ONLY valid JSON, no markdown fences, in this shape:
{"items":[{"id":"<item id>","description":"<rewritten description with \\n line breaks>"}]}`;

function buildUserPrompt(jobName: string, items: GenItem[]): string {
  const lines = items.map((it) => {
    const meta: string[] = [];
    if (it.groupPath) meta.push(`Group: ${it.groupPath}`);
    if (it.costCodeName) meta.push(`Cost code: ${it.costCodeName}`);
    if (it.costTypeName) meta.push(`Type: ${it.costTypeName}`);
    if (it.quantity != null && it.quantity !== 1) meta.push(`Qty: ${it.quantity} ${it.unitName || ''}`.trim());
    return [
      `ITEM id=${it.id}`,
      `Name: ${it.name}`,
      meta.join(' | '),
      `Current client-facing description:`,
      it.description || '(no description; write a minimal scope from the item name)',
      '---',
    ].join('\n');
  });
  return `Job: ${jobName}\n\nRewrite the description for each of the following ${items.length} budget line items.\n\n${lines.join('\n')}`;
}

function parseResponse(text: string): Array<{ id: string; description: string }> {
  // Strip possible code fences and find the JSON object
  const cleaned = text.replace(/```(json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in model response');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed.items)) throw new Error('Model response missing items array');
  return parsed.items;
}

const CHUNK_SIZE = 15;

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();
    const { jobName, items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 });
    }
    if (items.length > 150) {
      return NextResponse.json({ error: 'Too many items (max 150 per request)' }, { status: 400 });
    }

    const results: Array<{ id: string; description: string }> = [];
    const errors: Array<{ id: string; error: string }> = [];

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      try {
        const msg = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(jobName || '', chunk) }],
        });
        const text = msg.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('');
        const parsed = parseResponse(text);
        const byId = new Map(parsed.map((p) => [p.id, p.description]));
        for (const it of chunk) {
          const desc = byId.get(it.id);
          if (desc && typeof desc === 'string' && desc.trim()) {
            results.push({ id: it.id, description: desc.trim().slice(0, 4000) });
          } else {
            errors.push({ id: it.id, error: 'No description returned by model' });
          }
        }
      } catch (chunkErr: any) {
        for (const it of chunk) {
          errors.push({ id: it.id, error: chunkErr.message || 'Generation failed' });
        }
      }
    }

    return NextResponse.json({ results, errors });
  } catch (err: any) {
    console.error('Trade specs generate API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

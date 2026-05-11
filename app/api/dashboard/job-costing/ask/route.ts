// @ts-nocheck
/**
 * Per-job Q&A for the Job Costing dashboard.
 *
 * POST /api/dashboard/job-costing/ask
 *   body: { question, history?: [{role, content}], detail: <JobDetail> }
 *   returns: { answer }
 *
 * The client passes the full detail object it already fetched/displayed so the
 * AI reasons over the exact data the user is looking at (no re-fetch round
 * trip, and no risk of the AI seeing different numbers than the user).
 */
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function buildContext(detail: any): string {
  const job = detail.job || {};
  const fs = detail.financialSummary || {};
  const ta = detail.timeAnalysis || {};
  const bd = (detail.costCodeBreakdown || []) as any[];

  // Per-cost-code rollup, with bills / labor / pending broken out so the AI
  // can answer "which bills are pushing X over budget?" style questions.
  const codeLines: string[] = [];
  for (const c of bd) {
    const over = c.committedCost - c.estimatedCost;
    const isOver = c.estimatedCost > 0 && over > 0;
    const label = `${c.costCodeNumber} ${c.costCodeName}`;
    const head = `[${label}] budget $${fmt(c.estimatedCost)} | actual $${fmt(c.actualCost)} | pending $${fmt(c.pendingCost)} | ${isOver ? `OVER by $${fmt(over)}` : `remaining $${fmt(c.remaining)}`} | ${c.pctUsed}% used`;
    codeLines.push(head);
    const al = (c.actualLines || []).slice(0, 25);
    for (const l of al) {
      if (l.kind === 'labor') {
        codeLines.push(`  - LABOR ${l.label}: ${l.hours ?? '?'} hrs · $${fmt(l.cost)}`);
      } else {
        const kind = l.kind === 'po' ? 'PO' : 'Bill';
        const doc = l.docNumber ? `#${l.docNumber}` : '';
        const item = l.itemName ? ` — ${l.itemName}` : '';
        const dt = l.date ? ` (${String(l.date).slice(0, 10)})` : '';
        codeLines.push(`  - ${kind} ${l.label} ${doc}${item}${dt}: $${fmt(l.cost)}`);
      }
    }
    if ((c.actualLines || []).length > 25) {
      codeLines.push(`  - ... ${c.actualLines.length - 25} more actual lines not shown`);
    }
    const pl = (c.pendingLines || []).slice(0, 10);
    for (const l of pl) {
      const kind = l.kind === 'po' ? 'PO' : 'Bill';
      const doc = l.docNumber ? `#${l.docNumber}` : '';
      const item = l.itemName ? ` — ${l.itemName}` : '';
      codeLines.push(`  - PENDING ${kind} ${l.label} ${doc}${item}: $${fmt(l.cost)}`);
    }
  }

  // Labor by user
  const byUser = (ta.byUser || []) as any[];
  const userLines = byUser.map((u) =>
    `  - ${u.name}: ${u.total} total hrs (work ${u.work}, travel ${u.travel}, break ${u.break_ ?? 0})`
  );

  return [
    '# JOB CONTEXT',
    `Name: ${job.name || 'Unknown'}`,
    `Number: ${job.number || ''}`,
    `Client: ${job.clientName || ''}`,
    `Status: ${job.customStatus || 'N/A'}${job.isCompleted ? ' (COMPLETED)' : ''}`,
    `Type: ${job.isCostPlus ? 'Cost-Plus' : 'Fixed Price'}`,
    '',
    '# FINANCIAL TOTALS',
    `Contract Price: $${fmt(fs.contractPrice || fs.estimatedPrice || 0)}`,
    `Estimated Cost Budget: $${fmt(fs.estimatedCost || 0)}`,
    `Actual Costs (approved bills + labor): $${fmt(fs.actualCost || 0)}`,
    `Pending Costs (draft/pending bills, POs): $${fmt(fs.pendingCost || 0)}`,
    `Total Committed: $${fmt(fs.totalCosts || 0)}`,
    `Net Remaining: $${fmt((fs.estimatedCost || 0) - ((fs.actualCost || 0) + (fs.pendingCost || 0)))}`,
    `Margin: $${fmt(fs.margin || 0)} (${(fs.marginPct ?? 0).toFixed(1)}%)`,
    `Invoiced: $${fmt(fs.invoicedAmount || 0)}`,
    fs.isCostPlus ? `Collected from client: $${fmt(fs.collectedAmount || 0)}` : '',
    '',
    '# LABOR HOURS',
    `Estimated: ${ta.estimatedHours ?? 0} hrs`,
    `Actual: ${ta.totalActualHours ?? 0} hrs (work ${ta.actualWorkHours ?? 0}, travel ${ta.actualTravelHours ?? 0}, break ${ta.actualBreakHours ?? 0})`,
    userLines.length > 0 ? 'By worker:' : '',
    ...userLines,
    '',
    '# COST CODE BREAKDOWN (per-line detail under each code)',
    ...codeLines,
  ].filter(Boolean).join('\n');
}

const SYSTEM_INSTRUCTION =
  'You are a construction job costing analyst for Brett King Builder, a high-end residential renovation company. Answer questions about the specific job below using ONLY the data provided in the JOB CONTEXT. Be direct and practical — speak in plain language for a construction project manager. Include dollar amounts where helpful. Cite specific bills, vendors, or workers by name when relevant. If the data does not contain enough information to answer a question, say so plainly and suggest what you would need. Keep responses focused — no preamble, no markdown headers, no bold; short paragraphs and short lists are fine.';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { question, history, detail } = body || {};
    if (!question || typeof question !== 'string') {
      return NextResponse.json({ error: 'question is required' }, { status: 400 });
    }
    if (!detail || typeof detail !== 'object') {
      return NextResponse.json({ error: 'detail is required' }, { status: 400 });
    }

    const context = buildContext(detail);
    const system = `${SYSTEM_INSTRUCTION}\n\n${context}`;

    // History is a chronological list of prior turns in this conversation,
    // shaped { role: 'user'|'assistant', content: string }. Clip to the last
    // 10 turns to keep the prompt tight.
    const prior = Array.isArray(history) ? history.slice(-10) : [];
    const messages = [
      ...prior
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m: any) => ({ role: m.role, content: m.content })),
      { role: 'user', content: question },
    ];

    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system,
      messages,
    });
    const answer = response.content?.[0]?.type === 'text' ? response.content[0].text : '';

    return NextResponse.json({ answer });
  } catch (err: any) {
    console.error('[job-costing/ask] error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Ask failed' }, { status: 500 });
  }
}

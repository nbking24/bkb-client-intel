// @ts-nocheck
// ============================================================
// POST /api/estimating — Estimating Chat Endpoint
// Sends scope + conversation to Claude and returns AI response
// with optional budget proposal
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { validateAuth } from '../lib/auth';
import {
  buildEstimatingContext,
  parseProposedBudget,
  parseMultipleBudgets,
  parseStructuredQuestions,
  resolveIds,
  stripProposalMarkers,
  stripQuestionMarkers,
  validateMargins,
  enforceTargetMargins,
  type ProposedBudget,
} from '@/app/lib/estimating-agent';

const anthropic = new Anthropic();

export async function POST(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization')).valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      jobId,
      jobName,
      estimateType = 'initial',
      changeOrderName,
      quickEstimate = false,
      messages = [],
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    // Build context with system prompt + catalog
    const { systemPrompt, catalogContext, catalog } = await buildEstimatingContext(
      jobId,
      estimateType,
      quickEstimate
    );

    // Build the full system prompt with catalog data
    const fullSystemPrompt = [
      systemPrompt,
      '\n\n---\n\n',
      catalogContext,
    ].join('');

    // Add job context to the first user message if available
    let enrichedMessages = messages.map((m: { role: string; content: string }, idx: number) => {
      if (idx === 0 && m.role === 'user' && jobName) {
        const typeLabel = estimateType === 'change-order'
          ? `Change Order${changeOrderName ? `: ${changeOrderName}` : ''}`
          : 'Initial Estimate';
        return {
          role: m.role,
          content: `[Job: ${jobName} | Type: ${typeLabel}]\n\n${m.content}`,
        };
      }
      return { role: m.role, content: m.content };
    });

    // Call Claude with enough tokens for large budget proposals
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      system: fullSystemPrompt,
      messages: enrichedMessages.map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    // Extract text response
    let replyText = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    // Handle truncation: if response hit max_tokens and has more proposal
    // opening markers than closing markers, send a continuation request.
    if (response.stop_reason === 'max_tokens' && replyText.includes('@@BUDGET_PROPOSAL@@')) {
      const openCount = (replyText.match(/@@BUDGET_PROPOSAL@@/g) || []).length;
      const closeCount = (replyText.match(/@@END_PROPOSAL@@/g) || []).length;

      if (openCount > closeCount) {
        const continuationMessages = [
          ...enrichedMessages.map((m: any) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'assistant' as const, content: replyText },
          { role: 'user' as const, content: 'Continue — finish ALL remaining JSON budget proposal blocks and close each with @@END_PROPOSAL@@' },
        ];

        const continuation = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 16384,
          system: fullSystemPrompt,
          messages: continuationMessages,
        });

        const continuationText = continuation.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('\n');

        replyText = replyText + continuationText;
      }
    }

    // Check for budget proposals in the response (supports multiple options)
    let proposedBudgets = parseMultipleBudgets(replyText);
    let allMarginWarnings: ReturnType<typeof validateMargins> = [];

    // Process each budget: resolve IDs, validate & enforce margins
    proposedBudgets = proposedBudgets.map((budget) => {
      let processed = resolveIds(budget, catalog);
      const warnings = validateMargins(processed);
      allMarginWarnings.push(...warnings);

      if (warnings.length > 0) {
        processed = enforceTargetMargins(processed);
        processed.totalCost = processed.lineItems.reduce(
          (sum, i) => sum + (i.quantity * i.unitCost), 0
        );
        processed.totalPrice = processed.lineItems.reduce(
          (sum, i) => sum + (i.quantity * i.unitPrice), 0
        );
      }
      return processed;
    });

    // Backward compatibility: first budget as singular proposedBudget
    const proposedBudget = proposedBudgets.length > 0 ? proposedBudgets[0] : null;

    // Check for structured questions in the response
    const structuredQuestions = parseStructuredQuestions(replyText);

    // Strip markers from the display reply
    let cleanReply = stripProposalMarkers(replyText);
    cleanReply = stripQuestionMarkers(cleanReply);

    return NextResponse.json({
      reply: cleanReply,
      proposedBudget,
      proposedBudgets,
      structuredQuestions,
      readyToCreate: proposedBudgets.length > 0 && proposedBudgets.some(b => b.lineItems.length > 0),
      marginWarnings: allMarginWarnings.length > 0 ? allMarginWarnings : undefined,
    });
  } catch (err) {
    console.error('Estimating error:', err);
    const errorMsg = err instanceof Error ? err.message : 'Estimating failed';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

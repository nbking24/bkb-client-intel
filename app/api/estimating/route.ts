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
  parseStructuredQuestions,
  resolveIds,
  stripProposalMarkers,
  stripQuestionMarkers,
  validateMargins,
  enforceTargetMargins,
} from '@/app/lib/estimating-agent';

const anthropic = new Anthropic();

export async function POST(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization'))) {
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

    // Handle truncation: if response hit max_tokens and contains an open
    // @@BUDGET_PROPOSAL@@ without @@END_PROPOSAL@@, send a continuation
    // request so Claude finishes the JSON.
    if (
      response.stop_reason === 'max_tokens' &&
      replyText.includes('@@BUDGET_PROPOSAL@@') &&
      !replyText.includes('@@END_PROPOSAL@@')
    ) {
      const continuationMessages = [
        ...enrichedMessages.map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'assistant' as const, content: replyText },
        { role: 'user' as const, content: 'Continue — finish the JSON budget proposal and close with @@END_PROPOSAL@@' },
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

    // Check for budget proposal in the response
    let proposedBudget = parseProposedBudget(replyText);
    let marginWarnings: ReturnType<typeof validateMargins> = [];

    if (proposedBudget) {
      // Resolve IDs from the org catalog
      proposedBudget = resolveIds(proposedBudget, catalog);

      // Validate margins and collect warnings
      marginWarnings = validateMargins(proposedBudget);

      // Auto-correct any items below target margin
      if (marginWarnings.length > 0) {
        proposedBudget = enforceTargetMargins(proposedBudget);
        // Recalculate totals after correction
        proposedBudget.totalCost = proposedBudget.lineItems.reduce(
          (sum, i) => sum + (i.quantity * i.unitCost), 0
        );
        proposedBudget.totalPrice = proposedBudget.lineItems.reduce(
          (sum, i) => sum + (i.quantity * i.unitPrice), 0
        );
      }
    }

    // Check for structured questions in the response
    const structuredQuestions = parseStructuredQuestions(replyText);

    // Strip markers from the display reply
    let cleanReply = stripProposalMarkers(replyText);
    cleanReply = stripQuestionMarkers(cleanReply);

    return NextResponse.json({
      reply: cleanReply,
      proposedBudget,
      structuredQuestions,
      readyToCreate: !!proposedBudget && proposedBudget.lineItems.length > 0,
      marginWarnings: marginWarnings.length > 0 ? marginWarnings : undefined,
    });
  } catch (err) {
    console.error('Estimating error:', err);
    const errorMsg = err instanceof Error ? err.message : 'Estimating failed';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

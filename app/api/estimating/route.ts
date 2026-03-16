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
      messages = [],
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    // Build context with system prompt + catalog
    const { systemPrompt, catalogContext, catalog } = await buildEstimatingContext(
      jobId,
      estimateType
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

    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: fullSystemPrompt,
      messages: enrichedMessages.map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    // Extract text response
    const replyText = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    // Check for budget proposal in the response
    let proposedBudget = parseProposedBudget(replyText);
    if (proposedBudget) {
      proposedBudget = resolveIds(proposedBudget, catalog);
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
    });
  } catch (err) {
    console.error('Estimating error:', err);
    const errorMsg = err instanceof Error ? err.message : 'Estimating failed';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

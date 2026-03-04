// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import { AgentContext, getCommChannel } from '../lib/agents/types';
import { routeMessage } from '../lib/agents/router';

export async function POST(req: NextRequest) {
  if (!validateAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      messages,
      contactId,
      contactName,
      opportunityId,
      opportunityName,
      jtJobId,
      pipelineStage,
      lastAgent,
      forcedAgent, // NEW: manual agent selection from the UI
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    // Build shared agent context
    const ctx: AgentContext = {
      contactId: contactId || undefined,
      contactName: contactName || undefined,
      opportunityId: opportunityId || undefined,
      opportunityName: opportunityName || undefined,
      jtJobId: jtJobId || undefined,
      pipelineStage: pipelineStage || undefined,
      communicationChannel: getCommChannel(pipelineStage || ''),
    };

    // Route to the best agent (pass lastAgent for confirmation continuity, forcedAgent for manual selection)
    const result = await routeMessage(
      messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      ctx,
      lastAgent || undefined,
      forcedAgent || undefined
    );

    return NextResponse.json({
      reply: result.reply,
      agent: result.agentName,
      needsConfirmation: result.needsConfirmation || false,
    });
  } catch (err) {
    console.error('Chat error:', err);
    const errorMsg = err instanceof Error ? err.message : 'Chat failed';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

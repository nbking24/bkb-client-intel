// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth, isFieldStaffRole } from '../lib/auth';
import { AgentContext, getCommChannel } from '../lib/agents/types';
import { routeMessage } from '../lib/agents/router';
import { findJTJobByName } from '../lib/supabase';

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) {
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
      forcedAgent, // manual agent selection from the UI
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    // Try to resolve jtJobId from the message context if not explicitly provided
    let resolvedJtJobId = jtJobId || undefined;
    if (!resolvedJtJobId) {
      for (let i = messages.length - 1; i >= 0 && !resolvedJtJobId; i--) {
        const msgContent = messages[i]?.content || '';
        const jobIdMatch = msgContent.match(/\[Context:.*?ID:\s*([A-Za-z0-9]+)/);
        if (jobIdMatch) {
          resolvedJtJobId = jobIdMatch[1];
          break;
        }
        const jobNameMatch = msgContent.match(/\[Context:.*?job "([^"]+)"/);
        if (jobNameMatch) {
          try {
            const found = await findJTJobByName(jobNameMatch[1]);
            if (found) resolvedJtJobId = found.id;
          } catch { /* non-fatal */ }
        }
      }
    }

    // Build shared agent context
    const ctx: AgentContext = {
      contactId: contactId || undefined,
      contactName: contactName || undefined,
      opportunityId: opportunityId || undefined,
      opportunityName: opportunityName || undefined,
      jtJobId: resolvedJtJobId,
      pipelineStage: pipelineStage || undefined,
      communicationChannel: getCommChannel(pipelineStage || ''),
    };

    // ── ROLE-BASED AGENT RESTRICTION ──
    // Field staff (Evan, Terri, Dave) are ALWAYS routed to the field-staff agent.
    // They cannot access the full Know-it-All or other admin agents.
    const effectiveForcedAgent = isFieldStaffRole(auth.role)
      ? 'field-staff'
      : (forcedAgent || undefined);

    // Route to the best agent
    const result = await routeMessage(
      messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      ctx,
      lastAgent || undefined,
      effectiveForcedAgent
    );

    // Extract task confirmation block from reply (if present)
    let reply = result.reply;
    let taskConfirm = null;
    const fencedMatch = reply.match(/```\w*\s*@@TASK_CONFIRM@@\s*([\s\S]*?)\s*@@END_CONFIRM@@\s*```/);
    const rawMatch = reply.match(/@@TASK_CONFIRM@@\s*([\s\S]*?)\s*@@END_CONFIRM@@/);
    const confirmMatch = fencedMatch || rawMatch;
    if (confirmMatch) {
      try {
        taskConfirm = JSON.parse(confirmMatch[1].trim());
      } catch { /* non-fatal: malformed JSON */ }
      reply = reply.replace(/```\w*\s*@@TASK_CONFIRM@@[\s\S]*?@@END_CONFIRM@@\s*```/g, '');
      reply = reply.replace(/@@TASK_CONFIRM@@[\s\S]*?@@END_CONFIRM@@/g, '');
      reply = reply.trim();
    }

    // Extract CO proposal block from reply (if present)
    let coProposal = null;
    const coFencedMatch = reply.match(/```\w*\s*@@CO_PROPOSAL@@\s*([\s\S]*?)\s*@@END_CO@@\s*```/);
    const coRawMatch = reply.match(/@@CO_PROPOSAL@@\s*([\s\S]*?)\s*@@END_CO@@/);
    const coMatch = coFencedMatch || coRawMatch;
    if (coMatch) {
      try {
        coProposal = JSON.parse(coMatch[1].trim());
      } catch { /* non-fatal: malformed JSON */ }
      reply = reply.replace(/```\w*\s*@@CO_PROPOSAL@@[\s\S]*?@@END_CO@@\s*```/g, '');
      reply = reply.replace(/@@CO_PROPOSAL@@[\s\S]*?@@END_CO@@/g, '');
      reply = reply.trim();
    }

    // Extract generic write-action confirmation block (if present) —
    // any JobTread write that isn't a task creation uses this pattern.
    let actionConfirm = null;
    const acFencedMatch = reply.match(/```\w*\s*@@ACTION_CONFIRM@@\s*([\s\S]*?)\s*@@END_ACTION@@\s*```/);
    const acRawMatch = reply.match(/@@ACTION_CONFIRM@@\s*([\s\S]*?)\s*@@END_ACTION@@/);
    const acMatch = acFencedMatch || acRawMatch;
    if (acMatch) {
      try {
        actionConfirm = JSON.parse(acMatch[1].trim());
      } catch { /* non-fatal: malformed JSON — fall through */ }
      reply = reply.replace(/```\w*\s*@@ACTION_CONFIRM@@[\s\S]*?@@END_ACTION@@\s*```/g, '');
      reply = reply.replace(/@@ACTION_CONFIRM@@[\s\S]*?@@END_ACTION@@/g, '');
      reply = reply.trim();
      // If the reply is now empty, give the user a neutral lead-in so the card is never orphaned.
      if (!reply) {
        reply = 'Here is what I\'m about to write to JobTread — approve below to proceed.';
      }
    }

    return NextResponse.json({
      reply,
      agent: result.agentName,
      needsConfirmation: result.needsConfirmation || !!taskConfirm || !!coProposal || !!actionConfirm,
      taskConfirm,
      coProposal,
      actionConfirm,
    });
  } catch (err) {
    console.error('Chat error:', err);
    const errorMsg = err instanceof Error ? err.message : 'Chat failed';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

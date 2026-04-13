// @ts-nocheck
/**
 * PUT /api/dashboard/leads-update
 *
 * Update a lead's pipeline stage or status in GHL.
 *
 * Body options:
 *   { action: 'move', opportunityId, contactId, stageId }
 *   { action: 'close', opportunityId }   — marks as lost + moves to Closed Not Interested
 */

import { NextRequest, NextResponse } from 'next/server';
import { moveOpportunityStage, updateOpportunity, PIPELINE_STAGES } from '@/app/lib/ghl';

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, opportunityId, contactId, stageId } = body;

    if (!opportunityId) {
      return NextResponse.json({ error: 'opportunityId is required' }, { status: 400 });
    }

    if (action === 'move') {
      if (!stageId) {
        return NextResponse.json({ error: 'stageId is required for move action' }, { status: 400 });
      }
      if (!contactId) {
        return NextResponse.json({ error: 'contactId is required for move action' }, { status: 400 });
      }

      const result = await moveOpportunityStage({ opportunityId, contactId, stageId });
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'close') {
      // Mark as lost and move to Closed Not Interested
      await updateOpportunity(opportunityId, {
        status: 'lost',
        pipelineStageId: PIPELINE_STAGES.CLOSED_NOT_INTERESTED,
      });
      return NextResponse.json({ success: true, status: 'lost', stage: 'Closed Not Interested' });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error('[leads-update] Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to update lead' }, { status: 500 });
  }
}

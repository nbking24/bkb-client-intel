// @ts-nocheck
/**
 * POST /api/webhook/jt-design-agreement-signed
 *
 * Called by a JobTread workflow automation when a design agreement is signed
 * (e.g. a specific document becomes approved). When it fires, we auto-promote
 * the linked GHL opportunity into the "In Design" stage and update the JT
 * job's "Status" custom field to "5. Design Phase" — mirroring the manual
 * "Move to Design" button on the Leads dashboard.
 *
 * Expected body (from JT workflow):
 *   {
 *     jtJobId: string,              // required — the JT job whose agreement was signed
 *     ghlOpportunityId?: string,    // optional — if JT has it cached, pass it for a fast path
 *     ghlContactId?: string,        // optional — fallback lookup key
 *     jtJobName?: string,           // optional — for logging
 *   }
 *
 * Security: shared secret in X-Webhook-Secret header (JT_WEBHOOK_SECRET env var).
 *   Falls back to GHL_WEBHOOK_SECRET if JT_WEBHOOK_SECRET is unset (same secret
 *   used by the other GHL→JT webhook in this repo) so we don't need two secrets.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  moveOpportunityStage,
  createContactNote,
  searchOpportunities,
  getOpportunity,
  PIPELINE_STAGES,
} from '@/app/lib/ghl';
import { setJobStatus, createComment } from '@/app/lib/jobtread';
import { createProjectEvent } from '@/app/lib/project-memory';
import { STATUS_VALUES } from '@/app/lib/constants';

// Custom field ID on GHL opportunities that stores the JT job id
const GHL_CF_JT_JOB_ID = 'GjwWvbGyh7CQfGmFir5p';

const WEBHOOK_SECRET =
  process.env.JT_WEBHOOK_SECRET || process.env.GHL_WEBHOOK_SECRET || '';

/** Find a GHL opportunity whose "JT Job ID" custom field equals the given JT job id.
 *  Scans Estimating + In Design stages since those are the only places a design-agreement
 *  sign event would meaningfully fire from. Returns the first match, or null. */
async function findGhlOpportunityByJtJobId(jtJobId: string): Promise<string | null> {
  const stagesToScan = [PIPELINE_STAGES.ESTIMATING, PIPELINE_STAGES.IN_DESIGN];
  for (const stageId of stagesToScan) {
    let opps: any[];
    try {
      opps = await searchOpportunities({ stageId, limit: 100 });
    } catch (err) {
      console.warn('[jt-design-signed] searchOpportunities failed for stage', stageId, err);
      continue;
    }

    for (const opp of opps) {
      // Need the full opportunity record to see custom fields
      let fullOpp: any = opp;
      if (!opp.customFields) {
        try {
          const det = await getOpportunity(opp.id);
          fullOpp = det?.opportunity || det || opp;
        } catch {
          fullOpp = opp;
        }
      }
      const cfs: any[] = fullOpp.customFields || [];
      for (const cf of cfs) {
        if (cf.id === GHL_CF_JT_JOB_ID || (cf.fieldKey || cf.key || '').toLowerCase().includes('jt_job_id')) {
          const val = cf.fieldValueString || cf.value || '';
          if (val === jtJobId) return opp.id;
        }
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  // ── Auth ──
  if (WEBHOOK_SECRET) {
    const provided = req.headers.get('x-webhook-secret') || '';
    if (provided !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const jtJobId: string = body.jtJobId || body.jobId || '';
  let ghlOpportunityId: string = body.ghlOpportunityId || body.opportunityId || '';
  const ghlContactIdFromBody: string = body.ghlContactId || body.contactId || '';
  const jtJobName: string = body.jtJobName || body.jobName || '';

  if (!jtJobId && !ghlOpportunityId) {
    return NextResponse.json(
      { error: 'jtJobId or ghlOpportunityId is required' },
      { status: 400 },
    );
  }

  const log: string[] = [];
  const results: Record<string, any> = { success: true };

  try {
    // ── Step 1: Resolve GHL opportunity ──
    if (!ghlOpportunityId && jtJobId) {
      log.push(`Looking up GHL opportunity by JT job id ${jtJobId}…`);
      const found = await findGhlOpportunityByJtJobId(jtJobId);
      if (!found) {
        return NextResponse.json(
          {
            success: false,
            error: `No GHL opportunity linked to JT job ${jtJobId}. Open the Leads dashboard and verify the opportunity has the JT Job ID custom field set.`,
            log,
          },
          { status: 404 },
        );
      }
      ghlOpportunityId = found;
      log.push(`  → Found GHL opportunity: ${ghlOpportunityId}`);
    }

    // ── Step 2: Load the opportunity so we know the contact id + name ──
    let oppDetail: any;
    try {
      const data = await getOpportunity(ghlOpportunityId);
      oppDetail = data?.opportunity || data;
    } catch (err: any) {
      return NextResponse.json(
        { success: false, error: `Failed to load GHL opportunity ${ghlOpportunityId}: ${err.message}`, log },
        { status: 500 },
      );
    }
    const contactId: string = oppDetail?.contactId || oppDetail?.contact?.id || ghlContactIdFromBody;
    const contactName: string =
      (oppDetail?.contact
        ? `${oppDetail.contact.firstName || ''} ${oppDetail.contact.lastName || ''}`.trim()
        : '') || oppDetail?.name || '';

    if (!contactId) {
      return NextResponse.json(
        { success: false, error: 'GHL opportunity has no linked contact — cannot move stage', log },
        { status: 400 },
      );
    }

    // ── Step 3: Move opportunity to In Design ──
    try {
      await moveOpportunityStage({
        opportunityId: ghlOpportunityId,
        contactId,
        stageId: PIPELINE_STAGES.IN_DESIGN,
      });
      results.stageMoved = 'In Design';
      log.push(`  → GHL stage → In Design`);
    } catch (err: any) {
      log.push(`  ✗ GHL stage move failed: ${err.message}`);
      return NextResponse.json(
        { success: false, error: `Failed to move GHL stage: ${err.message}`, log },
        { status: 500 },
      );
    }

    // ── Step 4: Update JT "Status" custom field → "5. Design Phase" ──
    if (jtJobId) {
      const designStatus = STATUS_VALUES.IN_DESIGN[0]; // '5. Design Phase'
      try {
        await setJobStatus(jtJobId, designStatus);
        results.jtStatusUpdated = designStatus;
        log.push(`  → JT Status custom field → ${designStatus}`);
      } catch (err: any) {
        log.push(`  ⚠ JT status update failed (non-fatal): ${err.message}`);
        results.jtStatusUpdated = false;
        results.jtStatusError = err.message;
      }

      // Drop a comment on the JT job for audit trail
      try {
        const commentBody = [
          'Moved to Design Phase (automated)',
          'Triggered by: design agreement signed in JobTread',
          `JT Status updated → ${designStatus}`,
        ].join('\n');
        await createComment({
          targetId: jtJobId,
          targetType: 'job',
          message: commentBody,
          name: 'BKB Client Hub — JT webhook',
        });
        results.jtCommentAdded = true;
      } catch (err: any) {
        log.push(`  ⚠ JT comment failed (non-fatal): ${err.message}`);
        results.jtCommentAdded = false;
      }
    }

    // ── Step 5: Save a GHL contact note for visibility ──
    try {
      const noteBody = [
        'Moved to Design (automated)',
        'Trigger: design agreement signed in JobTread',
        jtJobName ? `JT job: ${jtJobName}` : null,
        jtJobId ? `JT job id: ${jtJobId}` : null,
      ].filter(Boolean).join('\n');
      await createContactNote(contactId, noteBody);
      results.ghlNoteAdded = true;
    } catch (err: any) {
      log.push(`  ⚠ GHL note failed (non-fatal): ${err.message}`);
      results.ghlNoteAdded = false;
    }

    // ── Step 6: Save to Project Memory Layer ──
    try {
      await createProjectEvent({
        channel: 'system',
        event_type: 'decision_made',
        summary: `Lead moved to Design (automated) — ${contactName || 'client'}`,
        detail: 'Triggered by JobTread workflow when the design agreement was signed.',
        participants: contactName ? ['Nathan', contactName] : ['Nathan'],
        source_ref: {
          ghl_opportunity_id: ghlOpportunityId,
          ghl_contact_id: contactId,
          jt_job_id: jtJobId || null,
          trigger: 'jt_design_agreement_signed',
        },
        event_date: new Date().toISOString().split('T')[0],
      });
      results.projectEventSaved = true;
    } catch (err: any) {
      log.push(`  ⚠ Project event save failed (non-fatal): ${err.message}`);
      results.projectEventSaved = false;
    }

    return NextResponse.json({
      ...results,
      ghlOpportunityId,
      contactId,
      contactName,
      jtJobId: jtJobId || null,
      log,
    });
  } catch (err: any) {
    console.error('[jt-design-signed] Fatal error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Webhook failed', log },
      { status: 500 },
    );
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'JT → Design Agreement Signed webhook',
    description:
      'POST { jtJobId, ghlOpportunityId? } to auto-move the linked GHL opportunity into the In Design stage and update the JT Status custom field to "5. Design Phase".',
  });
}

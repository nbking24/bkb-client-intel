// @ts-nocheck
/**
 * POST /api/dashboard/leads-action
 *
 * Quick post-call actions for the Leads dashboard.
 * Handles workflows after a discovery call:
 *   1. Schedule initial design meeting (on-site visit) + save notes
 *   2. Move to nurture pipeline + save notes (requires reason)
 *   3. Move to design phase (GHL → In Design, JT Status → '5. Design Phase')
 *
 * Also supports saving call notes independently.
 *
 * Body:
 *   {
 *     action: 'schedule_meeting' | 'move_to_nurture' | 'move_to_design' | 'save_notes',
 *     opportunityId: string,
 *     contactId: string,
 *     contactName?: string,
 *     notes?: string,
 *     appointmentDate?: string,   // required for schedule_meeting (YYYY-MM-DD)
 *     appointmentTime?: string,   // required for schedule_meeting (HH:MM)
 *     reason?: string,            // required for move_to_nurture
 *     jtJobId?: string,           // for move_to_nurture + move_to_design: JT job to update
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  moveOpportunityStage,
  createAppointment,
  createContactNote,
  PIPELINE_STAGES,
  GHL_CALENDARS,
} from '@/app/lib/ghl';
import { createProjectEvent } from '@/app/lib/project-memory';
import { updateJob, createComment, setJobStatus } from '@/app/lib/jobtread';
import { STATUS_VALUES } from '@/app/lib/constants';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, opportunityId, contactId, contactName, notes, appointmentDate, appointmentTime, reason, jtJobId } = body;

    if (!opportunityId || !contactId) {
      return NextResponse.json({ error: 'opportunityId and contactId are required' }, { status: 400 });
    }

    const results: Record<string, any> = { success: true, action };

    // ── Save call notes (shared across all actions) ──
    // For move_to_nurture, we build a composite body so the reason is always persisted
    // to GHL notes + Project Memory even when the user didn't type free-form notes.
    const trimmedNotes = (notes || '').trim();
    const trimmedReason = (reason || '').trim();
    const hasNoteworthyContent =
      !!trimmedNotes ||
      (action === 'move_to_nurture' && !!trimmedReason) ||
      action === 'move_to_design';

    if (hasNoteworthyContent) {
      const ghlNoteBody = action === 'move_to_nurture'
        ? [
            'Moved to Nurture',
            trimmedReason ? `Reason: ${trimmedReason}` : null,
            trimmedNotes ? `Notes: ${trimmedNotes}` : null,
          ].filter(Boolean).join('\n')
        : action === 'move_to_design'
          ? [
              'Moved to Design (design agreement signed / approved)',
              trimmedNotes ? `Notes: ${trimmedNotes}` : null,
            ].filter(Boolean).join('\n')
          : `Discovery Call Notes:\n${trimmedNotes}`;

      // 1. Save to GHL contact notes
      try {
        await createContactNote(contactId, ghlNoteBody);
        results.notesSaved = true;
      } catch (err: any) {
        console.warn('[leads-action] GHL note creation failed (non-fatal):', err.message);
        results.notesSaved = false;
      }

      // 2. Save to Project Memory Layer (same as Ask Agent transcripts)
      try {
        const pmlSummary = action === 'schedule_meeting'
          ? `Discovery call with ${contactName || 'lead'} — scheduling design meeting`
          : action === 'move_to_nurture'
            ? `Lead did not move forward — ${contactName || 'lead'}${trimmedReason ? ` — reason: ${trimmedReason}` : ''}`
            : action === 'move_to_design'
              ? `Lead moved to Design — ${contactName || 'lead'}`
              : `Discovery call with ${contactName || 'lead'}`;

        await createProjectEvent({
          channel: 'phone',
          event_type: (action === 'move_to_nurture' || action === 'move_to_design') ? 'decision_made' : 'meeting_held',
          summary: pmlSummary,
          detail: trimmedNotes || null,
          participants: contactName ? ['Nathan', contactName] : ['Nathan'],
          source_ref: {
            ghl_opportunity_id: opportunityId,
            ghl_contact_id: contactId,
            ...(action === 'move_to_nurture' ? { nurture_reason: trimmedReason || null, jt_job_id: jtJobId || null } : {}),
            ...(action === 'move_to_design' ? { jt_job_id: jtJobId || null } : {}),
          },
          event_date: new Date().toISOString().split('T')[0],
        });
        results.projectEventSaved = true;
      } catch (err: any) {
        console.warn('[leads-action] Project event creation failed (non-fatal):', err.message);
        results.projectEventSaved = false;
      }
    }

    // ── Action: Schedule Initial Design Meeting ──
    if (action === 'schedule_meeting') {
      if (!appointmentDate || !appointmentTime) {
        return NextResponse.json({ error: 'appointmentDate and appointmentTime are required for schedule_meeting' }, { status: 400 });
      }

      // Build appointment times (1.5 hour default for on-site visit)
      const startTime = new Date(`${appointmentDate}T${appointmentTime}:00`);
      const endTime = new Date(startTime.getTime() + 90 * 60 * 1000); // 90 minutes

      try {
        await createAppointment({
          calendarId: GHL_CALENDARS.ONSITE_VISIT,
          contactId,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          title: `Initial Design Meeting - ${contactName || 'Client'}`,
          notes: notes?.trim() || undefined,
        });
        results.appointmentCreated = true;
      } catch (err: any) {
        console.error('[leads-action] Appointment creation failed:', err.message);
        return NextResponse.json({ error: 'Failed to create appointment: ' + err.message }, { status: 500 });
      }

      // Move to Discovery Scheduled stage
      try {
        await moveOpportunityStage({
          opportunityId,
          contactId,
          stageId: PIPELINE_STAGES.DISCOVERY_SCHEDULED,
        });
        results.stageMoved = 'Discovery Scheduled';
      } catch (err: any) {
        console.warn('[leads-action] Stage move failed (non-fatal):', err.message);
        results.stageMoved = false;
      }

      return NextResponse.json(results);
    }

    // ── Action: Move to Nurture ──
    if (action === 'move_to_nurture') {
      // Reason is required so we can track why leads don't move forward
      if (!trimmedReason) {
        return NextResponse.json({ error: 'A reason is required when moving a lead to Nurture' }, { status: 400 });
      }

      try {
        await moveOpportunityStage({
          opportunityId,
          contactId,
          stageId: PIPELINE_STAGES.NURTURE,
        });
        results.stageMoved = 'Nurture';
      } catch (err: any) {
        console.error('[leads-action] Move to nurture failed:', err.message);
        return NextResponse.json({ error: 'Failed to move to nurture: ' + err.message }, { status: 500 });
      }

      // If a JT job was linked, close it and drop a comment capturing the reason.
      // Both operations are non-fatal so a JT hiccup doesn't block the GHL move.
      if (jtJobId) {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        try {
          await updateJob(jtJobId, { closedOn: today });
          results.jtJobClosed = true;
        } catch (err: any) {
          console.warn('[leads-action] JT job close failed (non-fatal):', err.message);
          results.jtJobClosed = false;
          results.jtJobCloseError = err.message;
        }

        try {
          const commentBody = [
            `Job closed — lead moved to Nurture`,
            `Reason: ${trimmedReason}`,
            trimmedNotes ? `Notes: ${trimmedNotes}` : null,
          ].filter(Boolean).join('\n');
          await createComment({
            targetId: jtJobId,
            targetType: 'job',
            message: commentBody,
            name: 'BKB Client Hub',
          });
          results.jtCommentAdded = true;
        } catch (err: any) {
          console.warn('[leads-action] JT comment creation failed (non-fatal):', err.message);
          results.jtCommentAdded = false;
        }
      }

      return NextResponse.json(results);
    }

    // ── Action: Move to Design ──
    if (action === 'move_to_design') {
      // 1. Move GHL opportunity to the In Design stage (also triggers any
      //    configured GHL workflow for IN_DESIGN via STAGE_WORKFLOWS).
      try {
        await moveOpportunityStage({
          opportunityId,
          contactId,
          stageId: PIPELINE_STAGES.IN_DESIGN,
        });
        results.stageMoved = 'In Design';
      } catch (err: any) {
        console.error('[leads-action] Move to design failed:', err.message);
        return NextResponse.json({ error: 'Failed to move to design: ' + err.message }, { status: 500 });
      }

      // 2. Update the JT job's Status custom field to '5. Design Phase'
      //    + drop a comment marking the transition. Both non-fatal.
      if (jtJobId) {
        const designStatusValue = STATUS_VALUES.IN_DESIGN[0]; // '5. Design Phase'
        try {
          await setJobStatus(jtJobId, designStatusValue);
          results.jtStatusUpdated = designStatusValue;
        } catch (err: any) {
          console.warn('[leads-action] JT Status update failed (non-fatal):', err.message);
          results.jtStatusUpdated = false;
          results.jtStatusError = err.message;
        }

        try {
          const commentBody = [
            `Moved to Design Phase`,
            `JT Status updated → ${designStatusValue}`,
            trimmedNotes ? `Notes: ${trimmedNotes}` : null,
          ].filter(Boolean).join('\n');
          await createComment({
            targetId: jtJobId,
            targetType: 'job',
            message: commentBody,
            name: 'BKB Client Hub',
          });
          results.jtCommentAdded = true;
        } catch (err: any) {
          console.warn('[leads-action] JT comment creation failed (non-fatal):', err.message);
          results.jtCommentAdded = false;
        }
      }

      return NextResponse.json(results);
    }

    // ── Action: Save Notes Only ──
    if (action === 'save_notes') {
      if (!notes?.trim()) {
        return NextResponse.json({ error: 'Notes are required for save_notes action' }, { status: 400 });
      }
      return NextResponse.json(results);
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error('[leads-action] Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to process lead action' }, { status: 500 });
  }
}

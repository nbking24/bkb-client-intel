// @ts-nocheck
/**
 * POST /api/dashboard/leads-action
 *
 * Quick post-call actions for the Leads dashboard.
 * Handles two workflows after a discovery call:
 *   1. Schedule initial design meeting (on-site visit) + save notes
 *   2. Move to nurture pipeline + save notes
 *
 * Also supports saving call notes independently.
 *
 * Body:
 *   {
 *     action: 'schedule_meeting' | 'move_to_nurture' | 'save_notes',
 *     opportunityId: string,
 *     contactId: string,
 *     contactName?: string,
 *     notes?: string,
 *     appointmentDate?: string,   // required for schedule_meeting (YYYY-MM-DD)
 *     appointmentTime?: string,   // required for schedule_meeting (HH:MM)
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, opportunityId, contactId, contactName, notes, appointmentDate, appointmentTime } = body;

    if (!opportunityId || !contactId) {
      return NextResponse.json({ error: 'opportunityId and contactId are required' }, { status: 400 });
    }

    const results: Record<string, any> = { success: true, action };

    // ── Save call notes (shared across all actions) ──
    if (notes && notes.trim()) {
      const trimmedNotes = notes.trim();

      // 1. Save to GHL contact notes
      try {
        await createContactNote(contactId, `Discovery Call Notes:\n${trimmedNotes}`);
        results.notesSaved = true;
      } catch (err: any) {
        console.warn('[leads-action] GHL note creation failed (non-fatal):', err.message);
        results.notesSaved = false;
      }

      // 2. Save to Project Memory Layer (same as Ask Agent transcripts)
      try {
        await createProjectEvent({
          channel: 'phone',
          event_type: 'meeting_held',
          summary: `Discovery call with ${contactName || 'lead'}${action === 'schedule_meeting' ? ' — scheduling design meeting' : action === 'move_to_nurture' ? ' — moved to nurture' : ''}`,
          detail: trimmedNotes,
          participants: contactName ? ['Nathan', contactName] : ['Nathan'],
          source_ref: { ghl_opportunity_id: opportunityId, ghl_contact_id: contactId },
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

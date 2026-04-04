import { NextRequest, NextResponse } from 'next/server';
import {
  createContact,
  createOpportunity,
  createAppointment,
  moveOpportunityStage,
  PIPELINE_STAGES,
  GHL_CALENDARS,
  GHL_USERS,
} from '@/app/lib/ghl';

/**
 * POST /api/dashboard/create-lead
 *
 * Creates a GHL contact + opportunity from Terri's New Lead form.
 * Optionally schedules a discovery call or on-site visit.
 * Stage is set automatically based on what was scheduled.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      firstName,
      lastName,
      phone,
      email,
      address,
      city,
      state,
      zip,
      projectType,
      description,
      referralSource,
      budgetRange,
      nextStep,        // 'discovery_call' | 'onsite_visit' | 'none'
      appointmentDate, // YYYY-MM-DD
      appointmentTime, // HH:MM (24h)
    } = body;

    // --- Validation ---
    if (!firstName?.trim() || !lastName?.trim()) {
      return NextResponse.json(
        { error: 'First name and last name are required.' },
        { status: 400 }
      );
    }
    if (!phone?.trim()) {
      return NextResponse.json(
        { error: 'Phone number is required.' },
        { status: 400 }
      );
    }
    if (nextStep && nextStep !== 'none' && (!appointmentDate || !appointmentTime)) {
      return NextResponse.json(
        { error: 'Date and time are required when scheduling.' },
        { status: 400 }
      );
    }

    // --- 1. Create GHL Contact ---
    const contactTags = ['Dashboard Lead'];
    if (referralSource) contactTags.push(referralSource);
    if (projectType) contactTags.push(projectType);

    const contactRes = await createContact({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      email: email?.trim() || undefined,
      address1: address?.trim() || undefined,
      city: city?.trim() || undefined,
      state: state?.trim() || undefined,
      postalCode: zip?.trim() || undefined,
      tags: contactTags,
      source: 'Dashboard - Terri',
    });

    const contactId = contactRes?.contact?.id;
    if (!contactId) {
      console.error('[create-lead] No contact ID returned:', JSON.stringify(contactRes));
      return NextResponse.json(
        { error: 'Failed to create contact in GHL.' },
        { status: 500 }
      );
    }

    // --- 2. Determine stage ---
    let stageId: string;
    let stageName: string;
    let jtJobCreated = false;

    switch (nextStep) {
      case 'discovery_call':
        stageId = PIPELINE_STAGES.DISCOVERY_SCHEDULED;
        stageName = 'Discovery Scheduled';
        break;
      case 'onsite_visit':
        stageId = PIPELINE_STAGES.ESTIMATING;
        stageName = 'Estimating';
        break;
      default:
        stageId = PIPELINE_STAGES.NEW_INQUIRY;
        stageName = 'New Inquiry';
    }

    // --- 3. Create GHL Opportunity ---
    const oppName = `${lastName.trim()} ${projectType || 'Project'}`.trim();
    const oppRes = await createOpportunity({
      name: oppName,
      contactId,
      stageId,
      source: referralSource || 'Dashboard',
    });

    const opportunityId = oppRes?.opportunity?.id;

    // --- 4. Add notes with project details ---
    if (description || budgetRange || referralSource) {
      const noteLines: string[] = [];
      if (projectType) noteLines.push(`Project Type: ${projectType}`);
      if (budgetRange) noteLines.push(`Budget Range: ${budgetRange}`);
      if (referralSource) noteLines.push(`How They Found Us: ${referralSource}`);
      if (description) noteLines.push(`\nNotes: ${description}`);
      if (address) {
        noteLines.push(
          `\nProject Address: ${address}${city ? ', ' + city : ''}${state ? ', ' + state : ''} ${zip || ''}`
        );
      }

      try {
        const { createContactNote } = await import('@/app/lib/ghl');
        await createContactNote(contactId, noteLines.join('\n'));
      } catch (noteErr) {
        console.warn('[create-lead] Note creation failed (non-fatal):', noteErr);
      }
    }

    // --- 5. Schedule appointment if needed ---
    let appointmentId: string | undefined;

    if (nextStep && nextStep !== 'none' && appointmentDate && appointmentTime) {
      const calendarId =
        nextStep === 'discovery_call'
          ? GHL_CALENDARS.DISCOVERY_CALL
          : GHL_CALENDARS.ONSITE_VISIT;

      // Build ISO datetime in ET (GHL wants ISO strings)
      const startISO = `${appointmentDate}T${appointmentTime}:00-04:00`; // EDT
      const startDate = new Date(startISO);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour

      const title =
        nextStep === 'discovery_call'
          ? `Discovery Call - ${firstName} ${lastName}`
          : `On-Site Visit - ${firstName} ${lastName}`;

      const apptNotes = [
        projectType ? `Project: ${projectType}` : '',
        budgetRange ? `Budget: ${budgetRange}` : '',
        address ? `Address: ${address}${city ? ', ' + city : ''}${state ? ', ' + state : ''} ${zip || ''}` : '',
        description || '',
      ]
        .filter(Boolean)
        .join('\n');

      try {
        const apptRes = await createAppointment({
          calendarId,
          contactId,
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
          title,
          notes: apptNotes,
          address: nextStep === 'onsite_visit' && address
            ? `${address}${city ? ', ' + city : ''}${state ? ', ' + state : ''} ${zip || ''}`
            : undefined,
          status: 'confirmed',
        });
        appointmentId = apptRes?.id || apptRes?.event?.id;
      } catch (apptErr: any) {
        console.error('[create-lead] Appointment creation failed:', apptErr.message);
        // Continue — contact and opportunity are already created
      }
    }

    // --- 6. If Estimating stage, trigger the JT webhook via moveOpportunityStage ---
    if (stageId === PIPELINE_STAGES.ESTIMATING && opportunityId) {
      try {
        const result = await moveOpportunityStage({
          opportunityId,
          contactId,
          stageId: PIPELINE_STAGES.ESTIMATING,
        });
        jtJobCreated = result.workflowTriggered;
      } catch (err: any) {
        console.error('[create-lead] moveOpportunityStage failed:', err.message);
      }
    }

    return NextResponse.json({
      success: true,
      contactId,
      opportunityId,
      appointmentId,
      stage: stageName,
      jtJobCreated,
    });
  } catch (err: any) {
    console.error('[create-lead] Unhandled error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

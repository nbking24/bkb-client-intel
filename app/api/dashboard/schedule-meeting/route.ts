// ============================================================
// Schedule Meeting - Create & manage GHL + JT meeting sync
//
// GET   - Fetch available GHL calendars (calendar list)
// POST  - Create a meeting in GHL + JT
// PUT   - Update a meeting in GHL + JT
// DELETE - Cancel a meeting in GHL + JT
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getCalendars,
  createAppointment,
  updateAppointment,
  cancelAppointment,
  searchContacts,
} from '@/app/lib/ghl';
import {
  getJob,
  getJobSchedule,
  createPhaseGroup,
  createPhaseTask,
  updateTask,
  updateTaskProgress,
} from '@/app/lib/jobtread';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Task prefix to match GHL-synced tasks
const GHL_TASK_PREFIX = '📅 ';

// -- GET: Fetch available GHL calendars --------------------------
export async function GET(req: NextRequest) {
  try {
    const calendars = await getCalendars();

    return NextResponse.json({
      success: true,
      calendars: calendars.map((cal: any) => ({
        id: cal.id,
        name: cal.name,
        group: cal.group,
        duration: cal.duration,
      })),
    });
  } catch (err: any) {
    console.error('Fetch GHL calendars failed:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch calendars' },
      { status: 500 }
    );
  }
}

// -- POST: Create a meeting in GHL + JT --------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      calendarId,
      contactId,
      contacts,
      jobId,
      title,
      startTime,
      endTime,
      notes,
      address,
      assigneeId,
      assignees,
      customTime,
    } = body;

    // Debug: log the full incoming request
    console.log('[schedule-meeting] Incoming request:', JSON.stringify({
      calendarId, contactId, contacts, jobId, title, startTime, endTime,
      hasAssignees: Array.isArray(assignees) ? assignees.length : 0,
    }));

    if (!calendarId || !title || !startTime || !endTime) {
      return NextResponse.json(
        { error: 'calendarId, title, startTime, and endTime are required' },
        { status: 400 }
      );
    }

    // jobId is optional — leads in early pipeline stages may not have a JT job yet
    const hasJobId = jobId && jobId !== 'none';

    // Determine if we're using new contacts array or old single contactId
    let contactsToUse: Array<{ ghlContactId: string; name: string }> = [];

    if (Array.isArray(contacts) && contacts.length > 0) {
      // New format: array of contacts
      contactsToUse = contacts.filter((c: any) => c.ghlContactId && c.ghlContactId !== 'none');
    } else if (contactId && contactId !== 'none') {
      // Old format: single contactId (backward compatibility)
      contactsToUse = [{ ghlContactId: contactId, name: '' }];
    } else {
      // Fallback: try to auto-resolve from job
      try {
        const jobDetails = await getJob(jobId);
        const clientName = jobDetails?.clientName || jobDetails?.name || '';
        if (clientName) {
          const searchResults = await searchContacts(clientName, 5);
          if (searchResults.length > 0) {
            contactsToUse = [{ ghlContactId: searchResults[0].id, name: searchResults[0].name }];
          }
        }
      } catch (e: any) {
        console.warn('GHL contact lookup failed:', e.message);
      }
    }

    console.log('[schedule-meeting] Resolved contacts:', JSON.stringify(contactsToUse));

    if (contactsToUse.length === 0) {
      return NextResponse.json(
        { error: 'No valid GHL contacts provided. Create the contact in Loop first.' },
        { status: 400 }
      );
    }

    // Build list of team member GHL user IDs for appointment assignment
    const teamAssignees: Array<{ jtMembershipId: string; name: string; ghlUserId: string }> =
      Array.isArray(assignees) && assignees.length > 0 ? assignees : [];

    console.log('[schedule-meeting] Team assignees:', JSON.stringify(teamAssignees));

    // 1. Create appointments in GHL for each contact
    // When team assignees have GHL user IDs, create one appointment per contact per team member
    // so that Loop automations fire for each assigned team member.
    const ghlAppointments: Array<{ contactName: string; ghlEventId: string; assignedTo?: string }> = [];
    const errors: string[] = [];

    // Determine which GHL user IDs to assign appointments to
    const ghlUserIds = teamAssignees
      .filter(a => a.ghlUserId && a.ghlUserId.trim() !== '')
      .map(a => ({ ghlUserId: a.ghlUserId, name: a.name }));

    // Helper: extract event ID from GHL response (may be top-level or nested)
    const extractEventId = (resp: any): string | null => {
      if (!resp) return null;
      if (resp.id) return resp.id;
      if (resp.calendarEvent?.id) return resp.calendarEvent.id;
      if (resp.event?.id) return resp.event.id;
      if (resp.appointment?.id) return resp.appointment.id;
      if (resp.data?.id) return resp.data.id;
      return null;
    };

    for (const contact of contactsToUse) {
      const appointmentParams = {
        calendarId,
        contactId: contact.ghlContactId,
        startTime,
        endTime,
        title,
        notes,
        address,
        status: 'confirmed' as const,
        ...(customTime ? { ignoreDateRange: true } : {}),
      };

      if (ghlUserIds.length > 0) {
        // Create one appointment per GHL team member so each gets Loop automations
        for (const assignee of ghlUserIds) {
          try {
            console.log('[schedule-meeting] Creating GHL appointment:', JSON.stringify({ ...appointmentParams, assignedUserId: assignee.ghlUserId }));
            const ghlAppointment = await createAppointment({
              ...appointmentParams,
              assignedUserId: assignee.ghlUserId,
            });
            console.log('[schedule-meeting] GHL response:', JSON.stringify(ghlAppointment).substring(0, 500));

            const ghlEventId = extractEventId(ghlAppointment);
            if (!ghlEventId) {
              errors.push(`GHL appointment for ${contact.name || contact.ghlContactId} (assigned to ${assignee.name}) failed: no ID in response — keys: ${Object.keys(ghlAppointment || {}).join(',')}, raw: ${JSON.stringify(ghlAppointment).substring(0, 200)}`);
            } else {
              ghlAppointments.push({
                contactName: contact.name || contact.ghlContactId,
                ghlEventId,
                assignedTo: assignee.name,
              });
            }
          } catch (err: any) {
            console.error('[schedule-meeting] GHL createAppointment error:', err.message);
            errors.push(`GHL appointment for ${contact.name || contact.ghlContactId} (assigned to ${assignee.name}) failed: ${err.message}`);
          }
        }
      } else {
        // No GHL team members — create unassigned appointment (original behavior)
        try {
          console.log('[schedule-meeting] Creating GHL appointment (unassigned):', JSON.stringify(appointmentParams));
          const ghlAppointment = await createAppointment(appointmentParams);
          console.log('[schedule-meeting] GHL response:', JSON.stringify(ghlAppointment).substring(0, 500));

          const ghlEventId = extractEventId(ghlAppointment);
          if (!ghlEventId) {
            errors.push(`GHL appointment for ${contact.name || contact.ghlContactId} failed: no ID in response — keys: ${Object.keys(ghlAppointment || {}).join(',')}, raw: ${JSON.stringify(ghlAppointment).substring(0, 200)}`);
          } else {
            ghlAppointments.push({
              contactName: contact.name || contact.ghlContactId,
              ghlEventId,
            });
          }
        } catch (err: any) {
          console.error('[schedule-meeting] GHL createAppointment error:', err.message);
          errors.push(`GHL appointment for ${contact.name || contact.ghlContactId} failed: ${err.message}`);
        }
      }
    }

    if (ghlAppointments.length === 0) {
      // Surface the actual error details so the user can see what went wrong
      const errorDetail = errors.length > 0 ? errors.join(' | ') : 'Unknown error';
      console.error('[schedule-meeting] All GHL appointments failed:', errors);
      return NextResponse.json(
        {
          error: errorDetail,
          errors,
          debug: {
            contactsUsed: contactsToUse.map(c => ({ id: c.ghlContactId?.substring(0, 8) + '...', name: c.name })),
            calendarId,
            teamAssigneeCount: ghlUserIds.length,
          },
        },
        { status: 500 }
      );
    }

    // 2. Create ONE schedule task in JT (only once for all contacts, skip if no jobId)
    let jtTaskId: string | null = null;
    if (!hasJobId) {
      // No JT job linked — skip JT task creation (common for early-stage leads)
    } else try {
      const startDate = new Date(startTime).toISOString().split('T')[0];
      const endDate = new Date(endTime).toISOString().split('T')[0];
      const formattedTaskName = `${GHL_TASK_PREFIX}${title}`;

      // Build contact list for description
      const contactList = ghlAppointments.map((apt) => apt.contactName).join(', ');

      const description = [
        `Meeting: ${title}`,
        `Contacts: ${contactList}`,
        `GHL Event IDs: ${ghlAppointments.map((apt) => apt.ghlEventId).join(', ')}`,
        notes ? `Notes: ${notes}` : '',
        address ? `Location: ${address}` : '',
        `(Synced from GoHighLevel)`,
      ]
        .filter(Boolean)
        .join('\n');

      // Create task as a schedule task (type: 'schedule')
      const schedule = await getJobSchedule(jobId);
      if (!schedule) {
        throw new Error('Could not load job schedule');
      }

      // Find or create a "Meetings" phase
      const allTasks = flattenTasks(schedule.phases);
      let phaseGroupId = '';

      const meetingsPhase = allTasks.find(
        (t: any) => t.isGroup && t.name.toLowerCase().replace(/\*/g, '').trim() === 'meetings'
      );

      if (meetingsPhase) {
        phaseGroupId = meetingsPhase.id;
      } else {
        const created = await createPhaseGroup({ jobId, name: 'Meetings' });
        phaseGroupId = created.id;
      }

      // Build JT assignee list: use new multi-assignees if available, fall back to legacy single assigneeId
      const jtMembershipIds = teamAssignees.length > 0
        ? teamAssignees.map(a => a.jtMembershipId)
        : (assigneeId ? [assigneeId] : []);

      // Create the task
      const jtTask = await createPhaseTask({
        jobId,
        parentGroupId: phaseGroupId,
        name: formattedTaskName,
        description,
        startDate,
        endDate,
        ...(jtMembershipIds.length > 0 ? { assignedMembershipIds: jtMembershipIds } : {}),
      });

      jtTaskId = jtTask.id;
    } catch (jtErr: any) {
      console.warn('Failed to create JT task:', jtErr.message);
      errors.push(`JT task creation failed: ${jtErr.message}`);
      // Continue anyway - GHL appointments were created successfully
    }

    return NextResponse.json({
      success: true,
      ghlAppointments,
      jtTaskId,
      errors: errors.length > 0 ? errors : undefined,
      message:
        errors.length === 0
          ? 'Meeting created in GHL and JT'
          : `Meeting created with ${ghlAppointments.length} GHL appointment(s), but with some errors`,
    });
  } catch (err: any) {
    console.error('Create meeting failed:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to create meeting' },
      { status: 500 }
    );
  }
}

// -- PUT: Update a meeting in GHL + JT ---------------------------
export async function PUT(req: NextRequest) {
  try {
    const {
      ghlEventId,
      jtTaskId,
      startTime,
      endTime,
      title,
      notes,
      address,
    } = await req.json();

    if (!ghlEventId) {
      return NextResponse.json(
        { error: 'ghlEventId is required' },
        { status: 400 }
      );
    }

    // 1. Update GHL appointment
    const updateParams: any = {};
    if (startTime) updateParams.startTime = startTime;
    if (endTime) updateParams.endTime = endTime;
    if (title) updateParams.title = title;
    if (notes) updateParams.notes = notes;
    if (address) updateParams.address = address;

    if (Object.keys(updateParams).length > 0) {
      await updateAppointment(ghlEventId, updateParams);
    }

    // 2. Update JT task if provided
    if (jtTaskId) {
      const updateFields: any = {};
      if (title) updateFields.name = `${GHL_TASK_PREFIX}${title}`;
      if (startTime) updateFields.startDate = new Date(startTime).toISOString().split('T')[0];
      if (endTime) updateFields.endDate = new Date(endTime).toISOString().split('T')[0];

      if (Object.keys(updateFields).length > 0) {
        await updateTask(jtTaskId, updateFields);
      }
    }

    return NextResponse.json({
      success: true,
      ghlEventId,
      jtTaskId,
      message: 'Meeting updated',
    });
  } catch (err: any) {
    console.error('Update meeting failed:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to update meeting' },
      { status: 500 }
    );
  }
}

// -- DELETE: Cancel a meeting in GHL + JT -------------------------
export async function DELETE(req: NextRequest) {
  try {
    const { ghlEventId, jtTaskId } = await req.json();

    if (!ghlEventId) {
      return NextResponse.json(
        { error: 'ghlEventId is required' },
        { status: 400 }
      );
    }

    // 1. Cancel GHL appointment
    await cancelAppointment(ghlEventId);

    // 2. Mark JT task as completed if provided
    if (jtTaskId) {
      try {
        await updateTaskProgress(jtTaskId, 1);
      } catch (jtErr: any) {
        console.warn('Failed to complete JT task:', jtErr.message);
        // Continue anyway - GHL appointment was cancelled
      }
    }

    return NextResponse.json({
      success: true,
      ghlEventId,
      jtTaskId,
      message: 'Meeting cancelled',
    });
  } catch (err: any) {
    console.error('Cancel meeting failed:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to cancel meeting' },
      { status: 500 }
    );
  }
}

// -- Helpers -------------------------------------------------

function flattenTasks(tasks: any[]): any[] {
  const result: any[] = [];
  for (const t of tasks) {
    result.push(t);
    if (t.childTasks?.nodes?.length) {
      result.push(...flattenTasks(t.childTasks.nodes));
    }
  }
  return result;
}

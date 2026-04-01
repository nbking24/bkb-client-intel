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
    const {
      calendarId,
      contactId,
      jobId,
      title,
      startTime,
      endTime,
      notes,
      address,
      assigneeId,
    } = await req.json();

    if (!calendarId || !jobId || !title || !startTime || !endTime) {
      return NextResponse.json(
        { error: 'calendarId, jobId, title, startTime, and endTime are required' },
        { status: 400 }
      );
    }

    // 0. Resolve GHL contact if not provided
    let resolvedContactId = contactId;
    if (!resolvedContactId || resolvedContactId === 'none') {
      try {
        // Get job details to find client name
        const jobDetails = await getJob(jobId);
        const clientName = jobDetails?.clientName || jobDetails?.name || '';
        if (clientName) {
          const contacts = await searchContacts(clientName, 5);
          if (contacts.length > 0) {
            resolvedContactId = contacts[0].id;
          }
        }
      } catch (e: any) {
        console.warn('GHL contact lookup failed:', e.message);
      }
    }

    if (!resolvedContactId || resolvedContactId === 'none') {
      return NextResponse.json(
        { error: 'Could not find a GHL contact for this job. Create the contact in Loop first.' },
        { status: 400 }
      );
    }

    // 1. Create appointment in GHL
    const ghlAppointment = await createAppointment({
      calendarId,
      contactId: resolvedContactId,
      startTime,
      endTime,
      title,
      notes,
      address,
      status: 'confirmed',
    });

    const ghlEventId = ghlAppointment.id;
    if (!ghlEventId) {
      return NextResponse.json(
        { error: 'GHL appointment creation failed: no ID returned' },
        { status: 500 }
      );
    }

    // 2. Create schedule task in JT
    let jtTaskId: string | null = null;
    try {
      const startDate = new Date(startTime).toISOString().split('T')[0];
      const endDate = new Date(endTime).toISOString().split('T')[0];
      const formattedTaskName = `${GHL_TASK_PREFIX}${title}`;

      const description = [
        `Meeting: ${title}`,
        `Contact ID: ${contactId}`,
        `GHL Event ID: ${ghlEventId}`,
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

      // Create the task
      const jtTask = await createPhaseTask({
        jobId,
        parentGroupId: phaseGroupId,
        name: formattedTaskName,
        description,
        startDate,
        endDate,
        ...(assigneeId ? { assignedMembershipIds: [assigneeId] } : {}),
      });

      jtTaskId = jtTask.id;
    } catch (jtErr: any) {
      console.warn('Failed to create JT task:', jtErr.message);
      // Continue anyway - GHL appointment was created successfully
    }

    return NextResponse.json({
      success: true,
      ghlEventId,
      jtTaskId,
      message: jtTaskId ? 'Meeting created in GHL and JT' : 'Meeting created in GHL (JT task creation failed)',
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

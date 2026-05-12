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
import { getSupabase } from '@/app/api/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Task prefix to match GHL-synced tasks
const GHL_TASK_PREFIX = '📅 ';

// Shared BKB virtual-meeting room. When a meeting is scheduled on a
// virtual calendar (detected by name keyword match below) this URL gets
// stamped into the event so every attendee joins the same room — even
// though we fan out one Loop appointment per BKB attendee for Loop's
// per-user automations. Set in Vercel env; falls back to the literal
// URL of the room I created on 2026-05-12.
const BKB_VIRTUAL_MEET_URL = process.env.BKB_VIRTUAL_MEET_URL || 'https://meet.google.com/uzc-zkfm-juk';
const BKB_VIRTUAL_MEET_DIALIN = 'Dial-in: +1 475-549-0467  ·  PIN: 234 030 853#';

// Returns true when the dropdown calendar looks like a virtual meeting
// type — same keyword sniffer the per-attendee calendar map uses below.
function isVirtualCalendar(name: string | undefined): boolean {
  return /virtual|online|zoom|google\s*meet|meet/i.test(name || '');
}

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
    const ghlAppointments: Array<{ contactName: string; ghlEventId: string; assignedTo?: string; calendarUsed?: string }> = [];
    const errors: string[] = [];

    // Track attendees we couldn't put on a calendar so the UI can warn
    // Terri / Nathan that the meeting only landed on a subset of calendars.
    // Reasons:
    //   - "no_ghl_user_id":   attendee selected in the form has no Loop user ID
    //                         (Josh, Terri, Kim today). Nothing to assign.
    //   - "no_matching_calendar": attendee has a Loop user ID but isn't a team
    //                         member on any calendar (or no calendar matches
    //                         the dropdown's type). Posting would 422 anyway.
    const skippedAttendees: Array<{ name: string; reason: 'no_ghl_user_id' | 'no_matching_calendar' }> = [];

    // Determine which GHL user IDs to assign appointments to
    const ghlUserIds = teamAssignees
      .filter(a => {
        if (a.ghlUserId && a.ghlUserId.trim() !== '') return true;
        skippedAttendees.push({ name: a.name, reason: 'no_ghl_user_id' });
        return false;
      })
      .map(a => ({ ghlUserId: a.ghlUserId, name: a.name }));

    // Build a per-attendee calendar map. GHL calendars only allow appointments
    // assigned to users that are members of that calendar's team — assigning a
    // user who isn't on the team yields a 422 "user id not part of calendar
    // team" error. So when multiple BKB attendees are on a meeting, we route
    // each one to their own primary calendar instead of forcing all of them
    // onto whichever calendar was picked in the dropdown.
    //
    // The dropdown calendarId is still used as the "preferred" calendar — if
    // an attendee owns it, we keep them on it. Otherwise we pick an attendee
    // calendar that matches the dropdown's type (phone / in-person / virtual)
    // by keyword, falling back to whichever calendar the attendee owns.
    const userToCalendarId = new Map<string, string>();
    if (ghlUserIds.length > 1) {
      try {
        const ghlBase = 'https://services.leadconnectorhq.com';
        const ghlHeaders = {
          Authorization: 'Bearer ' + (process.env.GHL_API_KEY || ''),
          'Content-Type': 'application/json',
          Version: '2021-04-15',
        };
        const locationId = process.env.GHL_LOCATION_ID || '';

        const listRes = await fetch(`${ghlBase}/calendars/?locationId=${locationId}`, { headers: ghlHeaders });
        if (listRes.ok) {
          const { calendars: allCalendars = [] } = await listRes.json();
          // Pull team members for every calendar in parallel.
          const detailed = await Promise.all(
            allCalendars.map(async (c: any) => {
              try {
                const r = await fetch(`${ghlBase}/calendars/${c.id}`, { headers: ghlHeaders });
                if (!r.ok) return { id: c.id, name: c.name || '', teamMembers: [] };
                const d = await r.json();
                const cal = d.calendar || d;
                return { id: c.id, name: c.name || '', teamMembers: cal.teamMembers || [] };
              } catch {
                return { id: c.id, name: c.name || '', teamMembers: [] };
              }
            })
          );

          // Identify the "type" of the dropdown calendar so we can pick a
          // matching calendar per attendee.
          const dropdownCal = detailed.find((c: any) => c.id === calendarId);
          const dropdownName = (dropdownCal?.name || '').toLowerCase();
          const wantPhone = /phone|call/.test(dropdownName) && !/in-?person/.test(dropdownName);
          const wantVirtual = /virtual|online|zoom/.test(dropdownName);
          const wantInPerson = /in-?person|on[- ]?site|consult/.test(dropdownName);

          const matchesType = (name: string): number => {
            const n = name.toLowerCase();
            if (wantPhone && /phone|call/.test(n) && !/in-?person/.test(n)) return 3;
            if (wantVirtual && /virtual|online|zoom/.test(n)) return 3;
            if (wantInPerson && /in-?person|on[- ]?site|consult/.test(n)) return 3;
            // Light bonus for shared keywords (e.g. "Standard Meeting").
            if (/standard meeting/.test(n) && /standard meeting/.test(dropdownName)) return 2;
            return 1;
          };

          for (const a of ghlUserIds) {
            // Calendars where this attendee is on the team (primary preferred).
            const owned = detailed
              .map((c: any) => {
                const tm = (c.teamMembers || []).find((m: any) => m.userId === a.ghlUserId);
                if (!tm) return null;
                const isPrimary = tm.isPrimary ? 1 : 0;
                return { id: c.id, name: c.name, isPrimary, typeScore: matchesType(c.name || '') };
              })
              .filter(Boolean) as Array<{ id: string; name: string; isPrimary: number; typeScore: number }>;
            if (owned.length === 0) continue;

            // Prefer: dropdown calendar if attendee owns it → otherwise the
            // best type-match (primary first, then by typeScore).
            const dropdownOwned = owned.find(o => o.id === calendarId);
            if (dropdownOwned) {
              userToCalendarId.set(a.ghlUserId, calendarId);
              continue;
            }
            owned.sort((x, y) => (y.isPrimary - x.isPrimary) || (y.typeScore - x.typeScore));
            userToCalendarId.set(a.ghlUserId, owned[0].id);
          }

          console.log('[schedule-meeting] Per-attendee calendar map:', JSON.stringify(
            Array.from(userToCalendarId.entries()).map(([uid, cid]) => {
              const a = ghlUserIds.find(x => x.ghlUserId === uid);
              const c = detailed.find((d: any) => d.id === cid);
              return { user: a?.name || uid, calendar: c?.name || cid };
            })
          ));
        } else {
          console.warn('[schedule-meeting] Calendar list fetch failed:', listRes.status);
        }
      } catch (err: any) {
        console.warn('[schedule-meeting] Could not build per-attendee calendar map:', err.message);
      }
    }

    // Resolve the dropdown calendar's name + virtual-ness. We need the name
    // for the group row (so the management UI doesn't have to round-trip)
    // and the virtual flag to decide whether to stamp the shared BKB Meet
    // URL into the event. The multi-attendee block above already fetches
    // calendar details, but it only runs when ghlUserIds.length > 1 — so
    // we do a lightweight standalone lookup here for the single-attendee
    // and no-attendee paths.
    let dropdownCalendarName = '';
    try {
      const ghlBase = 'https://services.leadconnectorhq.com';
      const ghlHeaders = {
        Authorization: 'Bearer ' + (process.env.GHL_API_KEY || ''),
        'Content-Type': 'application/json',
        Version: '2021-04-15',
      };
      const r = await fetch(`${ghlBase}/calendars/${calendarId}`, { headers: ghlHeaders });
      if (r.ok) {
        const d = await r.json();
        dropdownCalendarName = (d.calendar || d)?.name || '';
      }
    } catch (err: any) {
      console.warn('[schedule-meeting] Could not fetch dropdown calendar name:', err.message);
    }
    const isVirtual = isVirtualCalendar(dropdownCalendarName);

    // For virtual meetings, write the shared BKB Google Meet URL into the
    // event's address + notes so every attendee — across the fan-out
    // sibling appointments — joins the same room. Loop's own virtual
    // integration would otherwise generate a fresh Meet link per
    // appointment, splitting attendees across different rooms.
    let effectiveAddress = address;
    let effectiveNotes = notes;
    if (isVirtual) {
      effectiveAddress = BKB_VIRTUAL_MEET_URL;
      const meetBlock = `Virtual meeting: ${BKB_VIRTUAL_MEET_URL}\n${BKB_VIRTUAL_MEET_DIALIN}`;
      effectiveNotes = effectiveNotes
        ? `${meetBlock}\n\n${effectiveNotes}`
        : meetBlock;
    }

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
        notes: effectiveNotes,
        address: effectiveAddress,
        status: 'confirmed' as const,
        ...(customTime ? { ignoreDateRange: true } : {}),
      };

      if (ghlUserIds.length > 0) {
        // Create one appointment per GHL team member so each gets Loop automations.
        // Each attendee is routed to their OWN calendar (looked up above) when
        // multiple attendees are on the meeting; the original dropdown calendar
        // is used for any attendee that owns it (or as a fallback).
        const isMultiAttendee = ghlUserIds.length > 1;
        for (const assignee of ghlUserIds) {
          // Pick the right calendar for this attendee. If we built a per-user
          // map (multi-attendee case), use it. In multi-attendee mode, skip
          // any attendee not in the map — falling back to the dropdown
          // calendarId would produce a 422 "user id not part of calendar
          // team" error since the dropdown calendar is owned by someone else.
          // In single-attendee mode (or when the map couldn't be built), the
          // dropdown calendarId is the right choice.
          const mapped = userToCalendarId.get(assignee.ghlUserId);
          if (!mapped && isMultiAttendee && userToCalendarId.size > 0) {
            skippedAttendees.push({ name: assignee.name, reason: 'no_matching_calendar' });
            console.warn(`[schedule-meeting] Skipping ${assignee.name} — no matching calendar in team map`);
            continue;
          }
          const targetCalendarId: string = mapped || calendarId;
          const isFallbackCalendar = targetCalendarId !== calendarId;

          // When we route to an attendee's own calendar (different from the
          // one the user picked in the dropdown), bypass slot validation —
          // the user already manually chose the time and we don't want the
          // attendee's calendar's availability rules to override that choice.
          const perAssigneeParams = {
            ...appointmentParams,
            calendarId: targetCalendarId,
            assignedUserId: assignee.ghlUserId,
            ...(isFallbackCalendar ? { ignoreDateRange: true } : {}),
          };

          try {
            console.log('[schedule-meeting] Creating GHL appointment:', JSON.stringify(perAssigneeParams));
            const ghlAppointment = await createAppointment(perAssigneeParams);
            console.log('[schedule-meeting] GHL response:', JSON.stringify(ghlAppointment).substring(0, 500));

            const ghlEventId = extractEventId(ghlAppointment);
            if (!ghlEventId) {
              errors.push(`GHL appointment for ${contact.name || contact.ghlContactId} (assigned to ${assignee.name}) failed: no ID in response — keys: ${Object.keys(ghlAppointment || {}).join(',')}, raw: ${JSON.stringify(ghlAppointment).substring(0, 200)}`);
            } else {
              ghlAppointments.push({
                contactName: contact.name || contact.ghlContactId,
                ghlEventId,
                assignedTo: assignee.name,
                calendarUsed: targetCalendarId,
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

    // ── 3. Write the meeting group row ──
    // Stores the fan-out sibling event ids + the JT task id + display
    // metadata so the cancel/edit endpoints (and the management UI)
    // can act on the whole group from any single event id.
    let meetingGroupId: string | null = null;
    if (ghlAppointments.length > 0) {
      try {
        const { data: groupRow, error: groupErr } = await getSupabase()
          .from('meeting_groups')
          .insert({
            ghl_event_ids: ghlAppointments.map(a => a.ghlEventId),
            jt_task_id: jtTaskId,
            jt_job_id: hasJobId ? jobId : null,
            title,
            start_time: startTime,
            end_time: endTime,
            notes: effectiveNotes || null,
            address: effectiveAddress || null,
            calendar_id: calendarId,
            calendar_name: dropdownCalendarName || null,
            is_virtual: isVirtual,
            contacts: contactsToUse,
            assignees: teamAssignees,
          })
          .select('id')
          .single();
        if (groupErr) {
          console.warn('[schedule-meeting] Could not write meeting_groups row:', groupErr.message);
        } else {
          meetingGroupId = groupRow?.id || null;
        }
      } catch (err: any) {
        console.warn('[schedule-meeting] meeting_groups insert threw:', err?.message || err);
      }
    }

    return NextResponse.json({
      success: true,
      ghlAppointments,
      jtTaskId,
      meetingGroupId,
      isVirtual,
      virtualMeetUrl: isVirtual ? BKB_VIRTUAL_MEET_URL : null,
      errors: errors.length > 0 ? errors : undefined,
      skippedAttendees: skippedAttendees.length > 0 ? skippedAttendees : undefined,
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
// Group-aware: applies title / time / notes / address changes to every
// sibling appointment in the meeting group AND updates the JT task.
// Falls back to single-event update for meetings created before group
// tracking landed.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const ghlEventId: string | undefined = body.ghlEventId;
    const meetingGroupId: string | undefined = body.meetingGroupId;
    let jtTaskId: string | undefined = body.jtTaskId;
    const { startTime, endTime, title, notes, address } = body;

    if (!ghlEventId && !meetingGroupId) {
      return NextResponse.json(
        { error: 'ghlEventId or meetingGroupId is required' },
        { status: 400 }
      );
    }

    const sb = getSupabase();
    let group: any = null;
    try {
      if (meetingGroupId) {
        const r = await sb.from('meeting_groups').select('*').eq('id', meetingGroupId).maybeSingle();
        group = r.data;
      } else if (ghlEventId) {
        const r = await sb.from('meeting_groups')
          .select('*')
          .contains('ghl_event_ids', [ghlEventId])
          .maybeSingle();
        group = r.data;
      }
    } catch (err: any) {
      console.warn('[schedule-meeting] group lookup failed (falling back to single):', err?.message || err);
    }

    const eventIdsToUpdate: string[] = group?.ghl_event_ids?.length
      ? group.ghl_event_ids
      : (ghlEventId ? [ghlEventId] : []);
    if (!jtTaskId && group?.jt_task_id) jtTaskId = group.jt_task_id;

    // Re-stamp the shared Meet URL on virtual edits so a user editing
    // notes/address can't accidentally wipe the room URL. Falls back to
    // whatever the caller passed when the group isn't virtual.
    const isVirtual = !!group?.is_virtual;
    let effectiveAddress = address;
    let effectiveNotes = notes;
    if (isVirtual) {
      effectiveAddress = BKB_VIRTUAL_MEET_URL;
      if (notes !== undefined) {
        const meetBlock = `Virtual meeting: ${BKB_VIRTUAL_MEET_URL}\n${BKB_VIRTUAL_MEET_DIALIN}`;
        effectiveNotes = notes ? `${meetBlock}\n\n${notes}` : meetBlock;
      }
    }

    const updateParams: any = {};
    if (startTime) updateParams.startTime = startTime;
    if (endTime) updateParams.endTime = endTime;
    if (title) updateParams.title = title;
    if (effectiveNotes !== undefined) updateParams.notes = effectiveNotes;
    if (effectiveAddress !== undefined) updateParams.address = effectiveAddress;

    const ghlErrors: Array<{ ghlEventId: string; error: string }> = [];

    // 1. Push the same update to every sibling event. Best-effort across
    //    failures so a hiccup on one sibling doesn't roll back the others.
    if (Object.keys(updateParams).length > 0) {
      for (const eid of eventIdsToUpdate) {
        try {
          await updateAppointment(eid, updateParams);
        } catch (err: any) {
          const msg = err?.message || String(err);
          console.warn(`[schedule-meeting] update ${eid} failed:`, msg);
          ghlErrors.push({ ghlEventId: eid, error: msg });
        }
      }
    }

    // 2. Update JT task fields that mirror the meeting (name + dates).
    if (jtTaskId) {
      const updateFields: any = {};
      if (title) updateFields.name = `${GHL_TASK_PREFIX}${title}`;
      if (startTime) updateFields.startDate = new Date(startTime).toISOString().split('T')[0];
      if (endTime) updateFields.endDate = new Date(endTime).toISOString().split('T')[0];

      if (Object.keys(updateFields).length > 0) {
        try {
          await updateTask(jtTaskId, updateFields);
        } catch (jtErr: any) {
          console.warn('Failed to update JT task:', jtErr.message);
        }
      }
    }

    // 3. Update the group row's display metadata so subsequent reads
    //    show the latest title/time/notes without round-tripping Loop.
    if (group?.id) {
      try {
        const groupUpdate: any = { updated_at: new Date().toISOString() };
        if (title) groupUpdate.title = title;
        if (startTime) groupUpdate.start_time = startTime;
        if (endTime) groupUpdate.end_time = endTime;
        if (effectiveNotes !== undefined) groupUpdate.notes = effectiveNotes;
        if (effectiveAddress !== undefined) groupUpdate.address = effectiveAddress;
        await sb.from('meeting_groups').update(groupUpdate).eq('id', group.id);
      } catch (err: any) {
        console.warn('[schedule-meeting] group metadata update failed:', err?.message || err);
      }
    }

    return NextResponse.json({
      success: true,
      updatedEventIds: eventIdsToUpdate.filter(id => !ghlErrors.find(e => e.ghlEventId === id)),
      jtTaskId: jtTaskId || null,
      groupId: group?.id || null,
      errors: ghlErrors.length > 0 ? ghlErrors : undefined,
      message:
        ghlErrors.length === 0
          ? `Meeting updated (${eventIdsToUpdate.length} appointment${eventIdsToUpdate.length === 1 ? '' : 's'})`
          : `Updated ${eventIdsToUpdate.length - ghlErrors.length}/${eventIdsToUpdate.length} appointments`,
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
// Group-aware: a single ghlEventId (or meetingGroupId) cancels every
// sibling appointment in the meeting group AND the linked JT task in
// one shot. Pre-group meetings (no meeting_groups row) still work as
// before — we fall back to single-event cancel.
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const ghlEventId: string | undefined = body.ghlEventId;
    const meetingGroupId: string | undefined = body.meetingGroupId;
    let jtTaskId: string | undefined = body.jtTaskId;

    if (!ghlEventId && !meetingGroupId) {
      return NextResponse.json(
        { error: 'ghlEventId or meetingGroupId is required' },
        { status: 400 }
      );
    }

    // Resolve the meeting group. Either we were given its id directly,
    // or we look it up by any one sibling event id. If neither lookup
    // hits, we fall back to "cancel just this one event" — that's the
    // legacy behavior for meetings created before group tracking.
    const sb = getSupabase();
    let group: any = null;
    try {
      if (meetingGroupId) {
        const r = await sb.from('meeting_groups').select('*').eq('id', meetingGroupId).maybeSingle();
        group = r.data;
      } else if (ghlEventId) {
        const r = await sb.from('meeting_groups')
          .select('*')
          .contains('ghl_event_ids', [ghlEventId])
          .maybeSingle();
        group = r.data;
      }
    } catch (err: any) {
      console.warn('[schedule-meeting] group lookup failed (falling back to single):', err?.message || err);
    }

    const eventIdsToCancel: string[] = group?.ghl_event_ids?.length
      ? group.ghl_event_ids
      : (ghlEventId ? [ghlEventId] : []);
    if (!jtTaskId && group?.jt_task_id) jtTaskId = group.jt_task_id;

    const ghlErrors: Array<{ ghlEventId: string; error: string }> = [];

    // 1. Cancel every Loop appointment in the group. We don't bail on
    //    first error — we want best-effort across siblings so the user
    //    isn't left with half-cancelled meetings.
    for (const eid of eventIdsToCancel) {
      try {
        await cancelAppointment(eid);
      } catch (err: any) {
        const msg = err?.message || String(err);
        console.warn(`[schedule-meeting] cancel ${eid} failed:`, msg);
        ghlErrors.push({ ghlEventId: eid, error: msg });
      }
    }

    // 2. Complete the JT task (marks the "Meetings" phase task done).
    let jtTaskCancelled = false;
    if (jtTaskId) {
      try {
        await updateTaskProgress(jtTaskId, 1);
        jtTaskCancelled = true;
      } catch (jtErr: any) {
        console.warn('Failed to complete JT task:', jtErr.message);
      }
    }

    // 3. Mark the group cancelled. Skip silently if there's no group.
    if (group?.id) {
      try {
        await sb
          .from('meeting_groups')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancelled_by: body.cancelledBy || 'nathan',
            updated_at: new Date().toISOString(),
          })
          .eq('id', group.id);
      } catch (err: any) {
        console.warn('[schedule-meeting] group status update failed:', err?.message || err);
      }
    }

    return NextResponse.json({
      success: true,
      cancelledEventIds: eventIdsToCancel.filter(id => !ghlErrors.find(e => e.ghlEventId === id)),
      jtTaskCancelled,
      jtTaskId: jtTaskId || null,
      groupId: group?.id || null,
      errors: ghlErrors.length > 0 ? ghlErrors : undefined,
      message:
        ghlErrors.length === 0
          ? `Meeting cancelled (${eventIdsToCancel.length} appointment${eventIdsToCancel.length === 1 ? '' : 's'})`
          : `Cancelled ${eventIdsToCancel.length - ghlErrors.length}/${eventIdsToCancel.length} appointments`,
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

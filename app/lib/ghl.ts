// ============================================================
// GHL API v2 Service Layer
// Expanded for BKB Operations Platform
// ============================================================

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_KEY = () => process.env.GHL_API_KEY || '';
const GHL_LOC = () => process.env.GHL_LOCATION_ID || '';
const GHL_PIPELINE = () => process.env.GHL_PIPELINE_ID || '1iqzDqMkl6sxHr8OCeqi';

function headers() {
  return {
    Authorization: `Bearer ${GHL_KEY()}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

async function ghlFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...opts,
    headers: { ...headers(), ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GHL ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ============================================================
// CONTACTS
// ============================================================

export async function getContact(contactId: string) {
  return ghlFetch(`/contacts/${contactId}`);
}

export async function searchContacts(query: string, limit = 20) {
  const data = await ghlFetch(
    `/contacts/?locationId=${GHL_LOC()}&query=${encodeURIComponent(query)}&limit=${limit}`
  );
  return (data.contacts || []).map((c: any) => ({
    id: c.id,
    name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
    email: c.email || '',
    phone: c.phone || '',
    companyName: c.companyName || '',
    tags: c.tags || [],
  }));
}

/**
 * Create a new contact in GHL.
 */
export async function createContact(params: {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  tags?: string[];
  source?: string;
  customFields?: Array<{ id: string; field_value: string }>;
}) {
  return ghlFetch('/contacts/', {
    method: 'POST',
    body: JSON.stringify({
      locationId: GHL_LOC(),
      ...params,
    }),
  });
}

// ============================================================
// OPPORTUNITIES / PIPELINE
// ============================================================

export async function getPipelines() {
  const data = await ghlFetch(`/opportunities/pipelines?locationId=${GHL_LOC()}`);
  return data.pipelines || [];
}

export async function getOpportunity(opportunityId: string) {
  return ghlFetch(`/opportunities/${opportunityId}`);
}

export async function searchOpportunities(params: {
  status?: string;
  stageId?: string;
  contactId?: string;
  limit?: number;
}) {
  const { status = 'open', stageId, contactId, limit = 50 } = params;
  let url = `/opportunities/search?location_id=${GHL_LOC()}&status=${status}&limit=${limit}`;
  if (stageId) url += `&pipeline_stage_id=${stageId}`;
  if (contactId) url += `&contact_id=${contactId}`;
  const data = await ghlFetch(url);
  return data.opportunities || [];
}

export async function updateOpportunity(id: string, updates: Record<string, unknown>) {
  return ghlFetch(`/opportunities/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

/**
 * Create a new opportunity in the BKB Sales Pipeline.
 */
export async function createOpportunity(params: {
  name: string;
  contactId: string;
  stageId: string;
  monetaryValue?: number;
  source?: string;
  customFields?: Array<{ id: string; field_value: string[] }>;
}) {
  return ghlFetch('/opportunities/', {
    method: 'POST',
    body: JSON.stringify({
      pipelineId: GHL_PIPELINE(),
      locationId: GHL_LOC(),
      pipelineStageId: params.stageId,
      contactId: params.contactId,
      name: params.name,
      status: 'open',
      ...(params.monetaryValue ? { monetaryValue: params.monetaryValue } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(params.customFields?.length ? { customFields: params.customFields } : {}),
    }),
  });
}

// ============================================================
// CONVERSATIONS
// ============================================================

export async function searchConversations(contactId: string) {
  const data = await ghlFetch(
    `/conversations/search?locationId=${GHL_LOC()}&contactId=${contactId}`
  );
  return data.conversations || [];
}

export async function getConversationMessages(conversationId: string, limit = 40) {
  const data = await ghlFetch(
    `/conversations/${conversationId}/messages?limit=${limit}`
  );
  // GHL nests messages: { messages: { lastMessageId, nextPage, messages: [...] } }
  const msgs = data.messages;
  if (msgs && Array.isArray(msgs.messages)) return msgs.messages;
  if (Array.isArray(msgs)) return msgs;
  return [];
}

/**
 * Fetch ALL messages for a conversation with pagination.
 * Used by the sync engine to get the complete message history.
 */
export async function getAllConversationMessages(conversationId: string, maxPages = 20): Promise<any[]> {
  const allMessages: any[] = [];
  let nextPage: string | null = null;
  let page = 0;

  while (page < maxPages) {
    let url = `/conversations/${conversationId}/messages?limit=100`;
    if (nextPage) url += `&lastMessageId=${nextPage}`;

    const data = await ghlFetch(url);
    const msgs = data.messages;

    let batch: any[] = [];
    let pageToken: string | null = null;

    if (msgs && typeof msgs === 'object' && !Array.isArray(msgs)) {
      batch = Array.isArray(msgs.messages) ? msgs.messages : [];
      pageToken = msgs.nextPage || msgs.lastMessageId || null;
    } else if (Array.isArray(msgs)) {
      batch = msgs;
    }

    allMessages.push(...batch);
    page++;

    // Stop if no more pages or no new messages
    if (!pageToken || batch.length === 0) break;
    nextPage = pageToken;
  }

  return allMessages;
}

// ============================================================
// NOTES
// ============================================================

export async function getContactNotes(contactId: string) {
  const data = await ghlFetch(`/contacts/${contactId}/notes`);
  return data.notes || [];
}

export async function createContactNote(contactId: string, body: string) {
  return ghlFetch(`/contacts/${contactId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

// ============================================================
// CALENDAR
// ============================================================

/**
 * List all calendars in the GHL location.
 */
export async function getCalendars() {
  const data = await ghlFetch(`/calendars/?locationId=${GHL_LOC()}`);
  return data.calendars || [];
}

/**
 * List all users in the GHL location.
 * Tries multiple GHL endpoints for compatibility.
 */
export async function getLocationUsers() {
  // Try GET /users/search?companyId=xxx or /users/?locationId=xxx
  try {
    const data = await ghlFetch(`/users/?locationId=${GHL_LOC()}`);
    return (data.users || []).map((u: any) => ({
      id: u.id,
      name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim(),
      email: u.email || '',
    }));
  } catch (e1: any) {
    // Fallback: try /users/search endpoint
    try {
      const data = await ghlFetch(`/users/search?locationId=${GHL_LOC()}&limit=100`);
      return (data.users || []).map((u: any) => ({
        id: u.id,
        name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim(),
        email: u.email || '',
      }));
    } catch (e2: any) {
      return [{ error: `Endpoint 1: ${e1.message}, Endpoint 2: ${e2.message}` }];
    }
  }
}

/**
 * Get calendar events/appointments within a date range.
 * All times should be ISO-8601 / epoch milliseconds.
 */
export async function getCalendarEvents(params: {
  startTime: string;
  endTime: string;
  userId?: string;
  calendarId?: string;
  groupId?: string;
}) {
  let url = `/calendars/events?locationId=${GHL_LOC()}&startTime=${encodeURIComponent(params.startTime)}&endTime=${encodeURIComponent(params.endTime)}`;
  if (params.userId) url += `&userId=${params.userId}`;
  if (params.calendarId) url += `&calendarId=${params.calendarId}`;
  if (params.groupId) url += `&groupId=${params.groupId}`;
  const data = await ghlFetch(url);
  return data.events || [];
}

/**
 * Get all appointments for a specific contact.
 * Returns future, non-deleted appointments sorted by startTime (soonest first).
 */
export async function getContactAppointments(contactId: string): Promise<any[]> {
  const data = await ghlFetch(`/contacts/${contactId}/appointments`);
  const events = data.events || [];

  const now = new Date();
  return events
    .filter((ev: any) => !ev.deleted && new Date(ev.startTime) > now)
    .sort((a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

/**
 * Get a single appointment by its event ID.
 */
export async function getAppointment(eventId: string) {
  const data = await ghlFetch(`/calendars/events/appointments/${eventId}`);
  return data;
}

/**
 * Create an appointment in GHL.
 */
export async function createAppointment(params: {
  calendarId: string;
  contactId: string;
  startTime: string;
  endTime: string;
  title?: string;
  notes?: string;
  address?: string;
  status?: string;
  assignedUserId?: string;
  ignoreDateRange?: boolean;
}) {
  const body: any = {
    calendarId: params.calendarId,
    locationId: GHL_LOC(),
    contactId: params.contactId,
    startTime: params.startTime,
    endTime: params.endTime,
    appointmentStatus: params.status || 'confirmed',
  };
  if (params.title) body.title = params.title;
  if (params.notes) body.notes = params.notes;
  if (params.address) body.address = params.address;
  if (params.assignedUserId) body.assignedUserId = params.assignedUserId;
  if (params.ignoreDateRange) {
    body.ignoreDateRange = true;
    body.ignoreValidation = true;
    body.toNotify = false;
  }

  return ghlFetch('/calendars/events/appointments', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Update an appointment in GHL.
 */
export async function updateAppointment(eventId: string, params: {
  startTime?: string;
  endTime?: string;
  title?: string;
  notes?: string;
  address?: string;
  status?: string;
}) {
  return ghlFetch(`/calendars/events/appointments/${eventId}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

/**
 * Cancel/delete an appointment in GHL.
 */
export async function cancelAppointment(eventId: string) {
  return ghlFetch(`/calendars/events/appointments/${eventId}`, {
    method: 'DELETE',
  });
}

// ============================================================
// GHL → JOBTREAD MEETING SYNC
// ============================================================

import { getActiveJobs, createTask, getJobSchedule } from './jobtread';
import { findContactByName } from './contact-mapper';

/** Prefix used to identify GHL-synced tasks in JobTread */
const GHL_TASK_PREFIX = '📅 ';

/**
 * Sync GHL calendar appointments → JobTread tasks.
 *
 * For each GHL appointment with a contact:
 *   1. Resolve the contact name to a JT job (via client name matching)
 *   2. Check if a task already exists for that appointment (by title + date)
 *   3. Create a JT task if it doesn't exist
 *
 * Returns a summary of what was synced.
 */
export async function syncGHLMeetingsToJT(params?: {
  daysAhead?: number;
  dryRun?: boolean;
}): Promise<{
  synced: number;
  skipped: number;
  errors: number;
  details: string[];
}> {
  const daysAhead = params?.daysAhead ?? 30;
  const dryRun = params?.dryRun ?? false;

  const now = new Date();
  const startTime = now.toISOString();
  const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const endTime = end.toISOString();

  const details: string[] = [];
  let synced = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // 1. Fetch all GHL calendars, then query events for each
    //    GHL API requires calendarId (or userId/groupId) — can't query all at once
    const calendars = await getCalendars();
    if (!calendars || calendars.length === 0) {
      details.push('No GHL calendars found.');
      return { synced, skipped, errors, details };
    }
    details.push(`Found ${calendars.length} GHL calendar(s). Checking for appointments...`);

    const events: any[] = [];
    for (const cal of calendars) {
      try {
        const calEvents = await getCalendarEvents({
          startTime,
          endTime,
          calendarId: cal.id,
        });
        if (calEvents && calEvents.length > 0) {
          events.push(...calEvents);
        }
      } catch (calErr: any) {
        // Some calendars may not support event queries — skip silently
        details.push(`⚠️ Calendar "${cal.name || cal.id}" query failed: ${calErr.message?.substring(0, 100)}`);
      }
    }

    if (events.length === 0) {
      details.push('No GHL appointments found in date range across any calendar.');
      return { synced, skipped, errors, details };
    }
    details.push(`Found ${events.length} GHL appointment(s) in next ${daysAhead} days.`);

    // 2. Fetch active JT jobs and build client name → job mapping
    const activeJobs = await getActiveJobs(50);
    const clientJobMap = new Map<string, { id: string; name: string; number: string }>();
    for (const job of activeJobs) {
      if (job.clientName) {
        clientJobMap.set(job.clientName.toLowerCase().trim(), {
          id: job.id,
          name: job.name,
          number: job.number,
        });
      }
    }

    // 3. Process each event
    for (const event of events) {
      try {
        const title = event.title || event.name || 'Untitled Meeting';
        const contactName = event.contact
          ? `${event.contact.firstName || ''} ${event.contact.lastName || ''}`.trim() || event.contact.name || ''
          : '';
        const eventStart = event.startTime ? new Date(event.startTime) : null;
        const eventEnd = event.endTime ? new Date(event.endTime) : null;

        if (!contactName) {
          skipped++;
          details.push(`⏭ "${title}" — no contact attached, skipped.`);
          continue;
        }

        // Find matching JT job by client name
        let matchedJob: { id: string; name: string; number: string } | null = null;

        // Direct match first
        const directKey = contactName.toLowerCase().trim();
        if (clientJobMap.has(directKey)) {
          matchedJob = clientJobMap.get(directKey)!;
        } else {
          // Try partial match (last name match)
          const lastNameParts = contactName.split(/\s+/);
          const lastName = lastNameParts[lastNameParts.length - 1]?.toLowerCase();
          if (lastName) {
            clientJobMap.forEach((job, clientKey) => {
              if (!matchedJob && clientKey.includes(lastName)) {
                matchedJob = job;
              }
            });
          }
        }

        if (!matchedJob) {
          skipped++;
          details.push(`⏭ "${title}" for ${contactName} — no matching JT job found.`);
          continue;
        }

        // Format task name and date
        const dateStr = eventStart
          ? eventStart.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
          : '';
        const timeStr = eventStart
          ? eventStart.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
          : '';
        const taskName = `${GHL_TASK_PREFIX}${title}${dateStr ? ` — ${dateStr}` : ''}${timeStr ? ` at ${timeStr}` : ''}`;

        // Check for existing task with same name on this job (avoid duplicates)
        const schedule = await getJobSchedule(matchedJob.id);
        const allTasks = [
          ...(schedule?.phases || []).flatMap((p: any) => p.childTasks?.nodes || []),
          ...(schedule?.orphanTasks || []),
        ];
        const duplicate = allTasks.some((t: any) =>
          t.name && t.name.startsWith(GHL_TASK_PREFIX) && t.name.includes(title.substring(0, 30))
          && t.startDate === (eventStart ? eventStart.toISOString().split('T')[0] : null)
        );

        if (duplicate) {
          skipped++;
          details.push(`⏭ "${title}" on ${dateStr} — already exists in ${matchedJob.name}.`);
          continue;
        }

        // Create the task
        if (!dryRun) {
          const startDate = eventStart ? eventStart.toISOString().split('T')[0] : undefined;
          const endDate = eventEnd ? eventEnd.toISOString().split('T')[0] : startDate;
          const description = [
            `GHL Meeting: ${title}`,
            `Contact: ${contactName}`,
            eventStart ? `Time: ${timeStr}` : '',
            event.notes ? `Notes: ${event.notes}` : '',
            `(Auto-synced from GoHighLevel)`,
          ].filter(Boolean).join('\n');

          await createTask({
            jobId: matchedJob.id,
            name: taskName,
            description,
            startDate,
            endDate,
          });
        }

        synced++;
        details.push(`✅ "${title}" → ${matchedJob.name} (#${matchedJob.number}) on ${dateStr}${dryRun ? ' [DRY RUN]' : ''}`);
      } catch (err: any) {
        errors++;
        details.push(`❌ Error processing event: ${err.message}`);
      }
    }
  } catch (err: any) {
    errors++;
    details.push(`❌ Sync failed: ${err.message}`);
  }

  return { synced, skipped, errors, details };
}

// ============================================================
// PIPELINE STAGE MANAGEMENT & WORKFLOW TRIGGERS
// ============================================================

/**
 * BKB pipeline stage IDs.
 * Used to move opportunities between stages programmatically.
 */
export const PIPELINE_STAGES = {
  NEW_INQUIRY: 'da27d864-0a12-4f4b-9290-21d59a0f9f6f',
  INITIAL_CALL_SCHEDULED: '3e720576-99cc-4e94-baa1-0d82e28b265d',
  DISCOVERY_SCHEDULED: '25c69200-e006-4a7f-b949-687a66d019a7',
  NO_SHOW: 'ae9b3d90-5264-4f38-9e96-85a537d5c035',
  NURTURE: 'df802d7c-8a49-4e82-b9c1-2ad9d3dd1b80',
  ESTIMATING: 'c4012dfe-bc76-4447-8947-96a9e846ff2b',
  IN_DESIGN: '73fd2284-6b5f-4b24-9c10-cd8bca259552',
  READY: '4d8a8bf2-0044-4c76-ae8b-2c71b0f47598',
  IN_PRODUCTION: '787aa694-fac7-4ce6-ad93-2c9cf7a2e20d',
  FINAL_BILLING: 'b00dfbb4-2440-451b-9975-17246d535ab3',
  COMPLETED: '3d4bde41-7ee1-4ca0-ba2d-f4a6bc80238c',
  CLOSED_NOT_INTERESTED: '84984d39-705e-406a-91ae-fcf2e98b4a03',
  ON_HOLD: 'b85ba5c6-8ee6-419f-9ff7-a08a9106e58e',
} as const;

/**
 * GHL workflow IDs that should fire when entering a given stage.
 * Map: stageId → workflowId
 *
 * GHL workflows only auto-trigger on UI-based stage changes.
 * When moving stages via API, we enroll the contact into the
 * workflow manually using addContactToWorkflow().
 */
export const STAGE_WORKFLOWS: Record<string, string> = {
  [PIPELINE_STAGES.ESTIMATING]: 'efc2c619-9afb-410b-9af5-67276caa4ebe',
  // Add more stage → workflow mappings here as needed
};

/**
 * Enroll a contact into a GHL workflow.
 * This triggers the workflow's actions (webhooks, emails, etc.)
 * regardless of the workflow's trigger type.
 */
export async function addContactToWorkflow(contactId: string, workflowId: string) {
  return ghlFetch(`/contacts/${contactId}/workflow/${workflowId}`, {
    method: 'POST',
  });
}

/**
 * Move an opportunity to a new pipeline stage AND trigger any
 * associated workflows. This is the single function to call
 * whenever code needs to change an opportunity's stage.
 *
 * Handles the GHL limitation where API-based stage changes don't
 * trigger workflows by enrolling the contact into the workflow
 * after updating the stage.
 *
 * @returns Object with stage update result and workflow trigger status
 */
export async function moveOpportunityStage(params: {
  opportunityId: string;
  contactId: string;
  stageId: string;
}): Promise<{
  stageUpdated: boolean;
  workflowTriggered: boolean;
  workflowId?: string;
  error?: string;
}> {
  const { opportunityId, contactId, stageId } = params;

  // Step 1: Move the stage via API
  await updateOpportunity(opportunityId, {
    pipelineStageId: stageId,
  });

  // Step 2: Check if there's a workflow to trigger for this stage
  const workflowId = STAGE_WORKFLOWS[stageId];
  if (!workflowId) {
    return { stageUpdated: true, workflowTriggered: false };
  }

  // Step 3: Enroll the contact in the workflow
  try {
    await addContactToWorkflow(contactId, workflowId);
    return { stageUpdated: true, workflowTriggered: true, workflowId };
  } catch (err: any) {
    // Stage moved successfully but workflow failed — log but don't throw
    console.error(`[GHL] Stage moved but workflow trigger failed: ${err.message}`);
    return {
      stageUpdated: true,
      workflowTriggered: false,
      workflowId,
      error: `Workflow trigger failed: ${err.message}`,
    };
  }
}

// ============================================================
// FREE SLOTS
// ============================================================

/**
 * Get free/available time slots for a calendar on a given date range.
 * Uses GHL's /calendars/{calendarId}/free-slots endpoint.
 * GHL expects startDate/endDate as epoch milliseconds.
 */
export async function getFreeSlots(params: {
  calendarId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  timezone?: string;
}) {
  const tz = params.timezone || 'America/New_York';
  // Convert YYYY-MM-DD to epoch milliseconds
  const startMs = new Date(`${params.startDate}T00:00:00`).getTime();
  const endMs = new Date(`${params.endDate}T23:59:59`).getTime();
  const url = `/calendars/${params.calendarId}/free-slots?startDate=${startMs}&endDate=${endMs}&timezone=${encodeURIComponent(tz)}`;
  const data = await ghlFetch(url);
  return data;
}

// ============================================================
// CROSS-REFERENCE FIELDS
// ============================================================

// Custom field IDs for JT↔GHL linking
export const CUSTOM_FIELDS = {
  JT_JOB_ID: 'GjwWvbGyh7CQfGmFir5p',
  JT_CUSTOMER_ID: 'QzmJOO31vKrjXZmRSm3X',
} as const;

// Calendar IDs
export const GHL_CALENDARS = {
  DISCOVERY_CALL: 'XAmFYzHwTcxmDRUrJSgJ',     // BKB Online Discovery Call
  ONSITE_VISIT: 'DeoYiZ8TjDVoW6bFraUN',        // Initial Consultation - On Site
} as const;

// User IDs
export const GHL_USERS = {
  NATHAN: 'cFyoFwK0LIr0npmY7W34',
} as const;

// ============================================================
// DATABASE-ONLY READ FUNCTIONS (messages & notes)
//
// These read ONLY from the Supabase database — never from the
// live GHL API. This prevents duplication. The database is kept
// current by the daily sync cron + on-demand force-sync.
//
// For all other GHL data (contacts, opportunities, etc.)
// agents continue to use the live API functions above.
// ============================================================

import { readCache } from './cache';

/**
 * Get all messages for a contact from the database.
 * Falls back to live API only if DB has zero rows (bootstrap).
 */
export async function getMessagesFromDB(contactId: string, limit = 2000): Promise<any[]> {
  try {
    const cached = await readCache<any>(
      'ghl_messages',
      { contact_id: contactId },
      { orderBy: 'date_added', ascending: false, limit }
    );

    if (cached.length > 0) {
      return cached.map((row) => row.raw_data || row);
    }

    // DB empty — fall back to live API for bootstrap
    console.warn(`[db] No cached GHL messages for contact ${contactId}, falling back to live API`);
    const conversations = await searchConversations(contactId);
    const allMsgs: any[] = [];
    for (const convo of conversations) {
      const msgs = await getConversationMessages(convo.id, 40);
      allMsgs.push(...msgs);
    }
    return allMsgs;
  } catch (err) {
    console.warn('[db] getMessagesFromDB error, falling back to live:', err);
    const conversations = await searchConversations(contactId);
    const allMsgs: any[] = [];
    for (const convo of conversations) {
      const msgs = await getConversationMessages(convo.id, 40);
      allMsgs.push(...msgs);
    }
    return allMsgs;
  }
}

/**
 * Get all notes for a contact from the database.
 * Falls back to live API only if DB has zero rows (bootstrap).
 */
export async function getNotesFromDB(contactId: string, limit = 2000): Promise<any[]> {
  try {
    const cached = await readCache<any>(
      'ghl_notes',
      { contact_id: contactId },
      { orderBy: 'date_added', ascending: false, limit }
    );

    if (cached.length > 0) {
      return cached.map((row) => row.raw_data || row);
    }

    console.warn(`[db] No cached GHL notes for contact ${contactId}, falling back to live API`);
    return getContactNotes(contactId);
  } catch (err) {
    console.warn('[db] getNotesFromDB error, falling back to live:', err);
    return getContactNotes(contactId);
  }
}

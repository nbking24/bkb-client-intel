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
}) {
  const body: any = {
    calendarId: params.calendarId,
    locationId: GHL_LOC(),
    contactId: params.contactId,
    startTime: params.startTime,
    endTime: params.endTime,
    status: params.status || 'confirmed',
  };
  if (params.title) body.title = params.title;
  if (params.notes) body.notes = params.notes;
  if (params.address) body.address = params.address;

  return ghlFetch('/calendars/events/appointments', {
    method: 'POST',
    body: JSON.stringify(body),
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
// CROSS-REFERENCE FIELDS
// ============================================================

// Custom field IDs for JT↔GHL linking
export const CUSTOM_FIELDS = {
  JT_JOB_ID: 'GjwWvbGyh7CQfGmFir5p',
  JT_CUSTOMER_ID: 'QzmJOO31vKrjXZmRSm3X',
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

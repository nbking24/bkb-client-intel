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
}) {
  let url = `/calendars/events?locationId=${GHL_LOC()}&startTime=${params.startTime}&endTime=${params.endTime}`;
  if (params.userId) url += `&userId=${params.userId}`;
  if (params.calendarId) url += `&calendarId=${params.calendarId}`;
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

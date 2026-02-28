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
  return data.messages || [];
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

// ============================================================
// CROSS-REFERENCE FIELDS
// ============================================================

// Custom field IDs for JT↔GHL linking
export const CUSTOM_FIELDS = {
  JT_JOB_ID: 'GjwWvbGyh7CQfGmFir5p',
  JT_CUSTOMER_ID: 'QzmJOO31vKrjXZmRSm3X',
} as const;

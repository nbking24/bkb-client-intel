const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_KEY = () => process.env.GHL_API_KEY || '';
const GHL_LOC = () => process.env.GHL_LOCATION_ID || '';

function headers() {
  return {
    Authorization: 'Bearer ' + GHL_KEY(),
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

export async function getContact(contactId: string) {
  const res = await fetch(GHL_BASE + '/contacts/' + contactId, { headers: headers() });
  if (!res.ok) throw new Error('GHL get contact failed: ' + res.status);
  return res.json();
}

export async function searchContacts(query: string) {
  const url = GHL_BASE + '/contacts/?locationId=' + GHL_LOC() + '&query=' + encodeURIComponent(query) + '&limit=10';
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error('GHL contacts search failed: ' + res.status);
  const data = await res.json();
  return (data.contacts || []).map((c: Record<string, string>) => ({
    id: c.id,
    name: (c.firstName || '') + ' ' + (c.lastName || ''),
    email: c.email || '',
    phone: c.phone || '',
    companyName: c.companyName || '',
  }));
}

export async function createContactNote(contactId: string, body: string) {
  const res = await fetch(GHL_BASE + '/contacts/' + contactId + '/notes', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error('GHL create note failed: ' + res.status);
  return res.json();
}

export async function getContactNotes(contactId: string) {
  const res = await fetch(GHL_BASE + '/contacts/' + contactId + '/notes', { headers: headers() });
  if (!res.ok) throw new Error('GHL get notes failed: ' + res.status);
  const data = await res.json();
  return data.notes || [];
}

export async function getContactTasks(contactId: string) {
  const res = await fetch(GHL_BASE + '/contacts/' + contactId + '/tasks', { headers: headers() });
  if (!res.ok) throw new Error('GHL get tasks failed: ' + res.status);
  const data = await res.json();
  return data.tasks || [];
}

export async function searchConversations(contactId: string) {
  const url = GHL_BASE + '/conversations/search?locationId=' + GHL_LOC() + '&contactId=' + contactId;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error('GHL conversations search failed: ' + res.status);
  const data = await res.json();
  return data.conversations || [];
}

export async function getConversationMessages(conversationId: string, limit = 40) {
  const url = GHL_BASE + '/conversations/' + conversationId + '/messages?limit=' + limit;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error('GHL get messages failed: ' + res.status);
  const data = await res.json();
  return data.messages || [];
}

// === OPPORTUNITY FUNCTIONS ===

export async function getContactOpportunities(contactId: string) {
  const url = GHL_BASE + '/opportunities/search?location_id=' + GHL_LOC() + '&contact_id=' + contactId;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error('GHL opportunities search failed: ' + res.status);
  const data = await res.json();
  return data.opportunities || [];
}

export async function getOpportunity(opportunityId: string) {
  const url = GHL_BASE + '/opportunities/' + opportunityId;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error('GHL get opportunity failed: ' + res.status);
  return res.json();
}

export async function getPipelines() {
  const url = GHL_BASE + '/opportunities/pipelines?locationId=' + GHL_LOC();
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error('GHL get pipelines failed: ' + res.status);
  const data = await res.json();
  return data.pipelines || [];
}

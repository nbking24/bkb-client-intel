// @ts-nocheck
/**
 * Meeting sync: the Loop (GoHighLevel) side. Loop only delivers messages.
 * The Hub finds or creates the client contact, writes the meeting details into
 * contact fields the workflow emails use, and enrolls the contact into the
 * workflow with eventStartTime so Loop's "before the event" waits are timed
 * from the meeting.
 */

const BASE = 'https://services.leadconnectorhq.com';
const KEY = () => process.env.GHL_API_KEY || '';
const LOC = () => process.env.GHL_LOCATION_ID || '';

async function ghl(path: string, opts: RequestInit = {}, version = '2021-07-28') {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json', Version: version, ...(opts.headers || {}) },
    cache: 'no-store',
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Loop ${res.status} ${path.split('?')[0]}: ${text.slice(0, 200)}`);
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

/** The contact fields the Hub fills before enrolling. Merge tags in Loop: {{contact.<key>}}. */
export const MEETING_FIELDS = ['Meeting Title', 'Meeting Time', 'Meeting Location', 'Meeting With', 'Meeting Note'];

/** Find (or create once) the meeting contact fields. Returns name -> {id, key}. */
export async function ensureMeetingFields(existing: Record<string, any> = {}): Promise<Record<string, { id: string; key: string }>> {
  if (MEETING_FIELDS.every((n) => existing[n]?.id)) return existing;
  const data = await ghl(`/locations/${LOC()}/customFields?model=contact`);
  const list = data.customFields || [];
  const out: Record<string, { id: string; key: string }> = {};
  for (const name of MEETING_FIELDS) {
    let f = list.find((x: any) => String(x.name).toLowerCase() === name.toLowerCase());
    if (!f) {
      const created = await ghl(`/locations/${LOC()}/customFields`, {
        method: 'POST',
        body: JSON.stringify({ name, dataType: name === 'Meeting Note' ? 'LARGE_TEXT' : 'TEXT', model: 'contact' }),
      });
      f = created.customField || created;
    }
    out[name] = { id: f.id, key: String(f.fieldKey || '').replace(/^contact\./, '') };
  }
  return out;
}

export async function findContactByEmail(email: string): Promise<any | null> {
  const q = new URLSearchParams({ locationId: LOC(), email });
  const data = await ghl(`/contacts/search/duplicate?${q}`).catch(() => null);
  return data?.contact || null;
}

export async function findContactByPhone(phone: string): Promise<any | null> {
  const q = new URLSearchParams({ locationId: LOC(), number: phone });
  const data = await ghl(`/contacts/search/duplicate?${q}`).catch(() => null);
  return data?.contact || null;
}

export async function createContact(p: { firstName: string; lastName: string; email?: string; phone?: string }) {
  const data = await ghl('/contacts/', {
    method: 'POST',
    body: JSON.stringify({ locationId: LOC(), ...p, source: 'BKB Hub meeting sync' }),
  });
  return data.contact || data;
}

export async function updateContact(id: string, body: Record<string, any>) {
  return ghl(`/contacts/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function enroll(contactId: string, workflowId: string, eventStartTime: string) {
  return ghl(`/contacts/${contactId}/workflow/${workflowId}`, {
    method: 'POST',
    body: JSON.stringify({ eventStartTime }),
  });
}

export async function unenroll(contactId: string, workflowId: string) {
  return ghl(`/contacts/${contactId}/workflow/${workflowId}`, { method: 'DELETE' });
}

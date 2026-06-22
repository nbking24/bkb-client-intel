// @ts-nocheck
/**
 * Push a raffle entry into Loop (GHL).
 *
 *   - Search by email for an existing contact.
 *   - If found: update tags only (don't clobber other fields).
 *   - If not found: create a new contact with name, email, phone, source,
 *     and the right tags.
 *
 * Tags applied (Loop will auto-create them on first use):
 *   bucks-beautiful-2026                  (always)
 *   bucks-beautiful-2026-lead             (when contact_ok=true)
 *   bucks-beautiful-2026-raffle-only      (when contact_ok=false)
 *   interest-kitchen / interest-bathroom / interest-addition / interest-interior
 *   interest-exterior / interest-landscaping / interest-historic / interest-other
 *
 * Returns: { contactId: string | null, error: string | null }
 *
 * Designed to never throw — failures are returned so the entry route can
 * record them on the raffle_entries row without breaking the visitor flow.
 */
import { searchContacts, createContact } from '../../../lib/ghl';

const GHL_BASE = 'https://services.leadconnectorhq.com';

function headers() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

async function addTagsToContact(contactId: string, tags: string[]): Promise<boolean> {
  if (!tags.length) return true;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ tags }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = (full || '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export async function syncRaffleEntryToLoop(input: {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;          // required
  phone?: string | null;
  contactOk: boolean | null;  // null = blank (user left Y/N empty)
  interests: string[];
}): Promise<{ contactId: string | null; error: string | null }> {
  if (!process.env.GHL_API_KEY) {
    return { contactId: null, error: 'missing_GHL_API_KEY' };
  }
  if (!input.email) {
    return { contactId: null, error: 'email_required_for_loop_sync' };
  }

  let contactTag: string;
  if (input.contactOk === true)       contactTag = 'bucks-beautiful-2026-lead';
  else if (input.contactOk === false) contactTag = 'bucks-beautiful-2026-raffle-only';
  else                                contactTag = 'bucks-beautiful-2026-blank-contact';
  const tags: string[] = [
    'bucks-beautiful-2026',
    contactTag,
    ...input.interests.map((i) => `interest-${i}`),
  ];

  try {
    // 1) Search by email
    const matches = await searchContacts(input.email, 5);
    const existing = matches.find((c: any) => (c.email || '').toLowerCase() === input.email.toLowerCase());

    if (existing) {
      // 2a) Existing contact: add the tags
      const ok = await addTagsToContact(existing.id, tags);
      if (!ok) return { contactId: existing.id, error: 'tag_add_failed' };
      return { contactId: existing.id, error: null };
    }

    // 2b) Create — prefer explicit first/last, fall back to splitName(name)
    let firstName = (input.firstName || '').trim();
    let lastName  = (input.lastName  || '').trim();
    if (!firstName && !lastName) {
      ({ firstName, lastName } = splitName(input.name));
    }
    const created = await createContact({
      firstName,
      lastName,
      email: input.email,
      phone: input.phone || undefined,
      tags,
      source: 'Bucks Beautiful Tour 2026 Raffle',
    });
    const contactId =
      created?.contact?.id ||
      created?.id ||
      created?.contactId ||
      null;
    if (!contactId) return { contactId: null, error: 'no_contact_id_returned' };
    return { contactId, error: null };
  } catch (err: any) {
    return { contactId: null, error: (err?.message || 'loop_sync_failed').slice(0, 240) };
  }
}

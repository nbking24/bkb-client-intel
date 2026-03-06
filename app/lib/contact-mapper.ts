// ============================================================
// Contact Mapper — JT Client Name → GHL Contact ID
//
// The precon dashboard starts with JobTread job data which has
// clientName strings. Supabase (and GHL) key by contact_id.
// This module bridges the gap with fuzzy name matching.
// ============================================================

import { searchContactsByName } from '@/app/api/lib/supabase';
import { searchContacts } from '@/app/api/lib/ghl';

interface MappedContact {
  contactId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  companyName: string | null;
  source: 'supabase' | 'ghl';
}

// In-memory cache for the duration of a single request cycle
const nameCache = new Map<string, MappedContact | null>();

/**
 * Resolve a client name (from JT) to a GHL contact ID.
 * Tries Supabase first, falls back to live GHL search.
 */
export async function findContactByName(clientName: string): Promise<MappedContact | null> {
  if (!clientName || clientName === 'Unknown') return null;

  const cacheKey = clientName.toLowerCase().trim();
  if (nameCache.has(cacheKey)) return nameCache.get(cacheKey) || null;

  // 1. Try Supabase
  try {
    const results = await searchContactsByName(clientName);
    if (results.length > 0) {
      const best = results[0];
      const mapped: MappedContact = {
        contactId: best.id,
        firstName: best.first_name,
        lastName: best.last_name,
        email: best.email,
        companyName: best.company_name,
        source: 'supabase',
      };
      nameCache.set(cacheKey, mapped);
      return mapped;
    }
  } catch (err) {
    console.error('Supabase contact search failed:', err);
  }

  // 2. Fall back to live GHL
  try {
    const ghlResults = await searchContacts(clientName);
    if (ghlResults.length > 0) {
      const c = ghlResults[0];
      const mapped: MappedContact = {
        contactId: c.id,
        firstName: c.firstName || null,
        lastName: c.lastName || null,
        email: c.email || null,
        companyName: c.companyName || null,
        source: 'ghl',
      };
      nameCache.set(cacheKey, mapped);
      return mapped;
    }
  } catch (err) {
    console.error('GHL contact search fallback failed:', err);
  }

  nameCache.set(cacheKey, null);
  return null;
}

/**
 * Build a mapping for multiple client names at once.
 * Returns Map<clientName, contactId>.
 */
export async function buildJobContactMap(
  clientNames: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(clientNames.filter(n => n && n !== 'Unknown')));

  // Process in parallel batches of 5 to avoid overwhelming APIs
  const BATCH_SIZE = 5;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(name => findContactByName(name))
    );
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) {
        map.set(batch[idx], result.value.contactId);
      }
    });
  }

  return map;
}

/**
 * Clear the in-memory name cache (call between request cycles if needed).
 */
export function clearNameCache() {
  nameCache.clear();
}

// @ts-nocheck
/**
 * GET /api/dashboard/lead-detail?contactId=xxx&opportunityId=yyy
 *
 * Fetch complete lead/contact profile from GHL for the detail popup.
 * Returns contact info, custom fields (including MOSCOW form fields),
 * notes history, and upcoming appointments.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getContact,
  getContactNotes,
  getContactAppointments,
  getOpportunity,
} from '@/app/lib/ghl';

// Fields to skip in the custom fields display (internal/system fields)
const SKIP_FIELD_KEYS = new Set([
  'GjwWvbGyh7CQfGmFir5p',  // JT Job ID
  'QzmJOO31vKrjXZmRSm3X',  // JT Customer ID
]);

export async function GET(req: NextRequest) {
  try {
    const contactId = req.nextUrl.searchParams.get('contactId');
    const opportunityId = req.nextUrl.searchParams.get('opportunityId');

    if (!contactId) {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
    }

    // Fetch contact, notes, and appointments in parallel
    const [contactRes, notes, appointments, opportunity] = await Promise.all([
      getContact(contactId).catch((e: any) => {
        console.warn('[lead-detail] getContact failed:', e.message);
        return null;
      }),
      getContactNotes(contactId).catch((e: any) => {
        console.warn('[lead-detail] getContactNotes failed:', e.message);
        return [];
      }),
      getContactAppointments(contactId).catch((e: any) => {
        console.warn('[lead-detail] getContactAppointments failed:', e.message);
        return [];
      }),
      opportunityId
        ? getOpportunity(opportunityId).catch((e: any) => {
            console.warn('[lead-detail] getOpportunity failed:', e.message);
            return null;
          })
        : Promise.resolve(null),
    ]);

    const contact = contactRes?.contact || contactRes || null;

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // Parse custom fields into a clean structure
    const customFields: Array<{ id: string; name: string; value: any }> = [];
    const moscowFields: Array<{ name: string; value: any }> = [];

    if (contact.customFields && Array.isArray(contact.customFields)) {
      for (const cf of contact.customFields) {
        const id = cf.id || '';
        const name = cf.fieldKey || cf.key || cf.name || id;
        const value = cf.value ?? cf.fieldValue ?? cf.fieldValueString ?? '';

        // Skip internal/empty fields
        if (SKIP_FIELD_KEYS.has(id)) continue;
        if (!value || (typeof value === 'string' && !value.trim())) continue;
        if (Array.isArray(value) && value.length === 0) continue;

        // Check if this is a MOSCOW-related field (case-insensitive match on field key/name)
        const nameLower = name.toLowerCase();
        if (
          nameLower.includes('moscow') ||
          nameLower.includes('must_have') || nameLower.includes('must have') ||
          nameLower.includes('should_have') || nameLower.includes('should have') ||
          nameLower.includes('could_have') || nameLower.includes('could have') ||
          nameLower.includes('wont_have') || nameLower.includes("won't have") || nameLower.includes('wont have')
        ) {
          moscowFields.push({ name: formatFieldName(name), value });
        } else {
          customFields.push({ id, name: formatFieldName(name), value });
        }
      }
    }

    // ── Project address salvage ────────────────────────────────
    // Many leads come in with the Loop contact's address1/city/state/zip
    // blank — the address actually lives in a custom field (e.g. "Project
    // Address", "Property Location") or buried in a note. Try multiple
    // sources in priority order so the briefing always has SOMETHING to
    // anchor the map / Zillow / Google Maps links on.
    const fmtContactAddr = [contact.address1, contact.city, contact.state, contact.postalCode]
      .filter(Boolean)
      .join(', ')
      .trim();

    // Custom fields whose name suggests they hold a property address.
    // Anchored on common BKB/Loop naming conventions.
    const addressFieldRegex = /address|location|property|street|site|project[\s_-]*(address|location|site)/i;
    const customAddressField = [...moscowFields, ...customFields].find(f =>
      addressFieldRegex.test(f.name) && typeof f.value === 'string' && f.value.trim().length > 5
    );

    // Last resort: regex-extract a US-style address from any note body.
    // Looks for "<number> <street name> <suffix>", optionally followed by
    // a city/state/zip. Returns the first match.
    function findAddressInText(text: string): string | null {
      if (!text) return null;
      const m = text.match(
        /\b(\d{1,6}\s+[A-Za-z0-9][\w .'-]{2,}?\s+(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Boulevard|Blvd|Highway|Hwy|Parkway|Pkwy|Terrace|Ter|Circle|Cir|Square|Sq|Trail|Tr|Crossing|Xing|Pike)\b\.?(?:\s*,\s*[A-Za-z .'-]+(?:\s*,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?)?)/i
      );
      return m ? m[1].trim() : null;
    }
    const noteAddress = (notes || [])
      .map((n: any) => findAddressInText(n.body || ''))
      .find((s: string | null) => !!s) || null;

    const projectAddress = {
      // The best address string we could find, plain text.
      text: fmtContactAddr || customAddressField?.value || noteAddress || '',
      // Where it came from, for UI to label / debug.
      source: fmtContactAddr
        ? 'contact'
        : customAddressField
          ? `custom field "${customAddressField.name}"`
          : noteAddress
            ? 'note body'
            : 'none',
    };

    // Build response
    return NextResponse.json({
      projectAddress,
      contact: {
        id: contact.id,
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
        email: contact.email || '',
        phone: contact.phone || '',
        address: contact.address1 || '',
        city: contact.city || '',
        state: contact.state || '',
        postalCode: contact.postalCode || '',
        country: contact.country || '',
        companyName: contact.companyName || '',
        website: contact.website || '',
        source: contact.source || '',
        dateAdded: contact.dateAdded || contact.dateCreated || '',
        lastActivity: contact.lastActivity || '',
        tags: contact.tags || [],
        dnd: contact.dnd || false,
        assignedTo: contact.assignedTo || '',
      },
      moscowFields,
      customFields,
      notes: (notes || []).map((n: any) => ({
        id: n.id,
        body: n.body || '',
        dateAdded: n.dateAdded || '',
      })).sort((a: any, b: any) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime()),
      appointments: (appointments || []).slice(0, 5).map((a: any) => ({
        id: a.id,
        title: a.title || '',
        startTime: a.startTime || '',
        endTime: a.endTime || '',
        status: a.appointmentStatus || a.status || '',
      })),
      opportunity: opportunity ? {
        id: opportunity.id,
        name: opportunity.name || '',
        status: opportunity.status || '',
        monetaryValue: opportunity.monetaryValue || 0,
        source: opportunity.source || '',
        createdAt: opportunity.createdAt || '',
        stageName: opportunity.pipelineStageName || opportunity.stageName || '',
      } : null,
    });
  } catch (err: any) {
    console.error('[lead-detail] Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch lead detail' }, { status: 500 });
  }
}

/**
 * Convert field keys like "contact.moscow_must_have" or "must_have_items"
 * into readable labels like "Moscow Must Have" or "Must Have Items"
 */
function formatFieldName(key: string): string {
  // Remove "contact." prefix if present
  let name = key.replace(/^contact\./, '');
  // Replace underscores and dots with spaces
  name = name.replace(/[_.]/g, ' ');
  // Title case
  name = name.replace(/\b\w/g, c => c.toUpperCase());
  return name.trim();
}

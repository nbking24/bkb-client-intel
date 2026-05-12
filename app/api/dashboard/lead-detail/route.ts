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
  getMessagesFromDB,
} from '@/app/lib/ghl';
import { getCommentsFromDB } from '@/app/lib/jobtread';
import { getProjectMemoryForLead } from '@/app/lib/project-memory';

// Fields to skip in the custom fields display (internal/system fields)
const SKIP_FIELD_KEYS = new Set([
  'GjwWvbGyh7CQfGmFir5p',  // JT Job ID
  'QzmJOO31vKrjXZmRSm3X',  // JT Customer ID
]);

export async function GET(req: NextRequest) {
  try {
    const contactId = req.nextUrl.searchParams.get('contactId');
    const opportunityId = req.nextUrl.searchParams.get('opportunityId');
    // jobId (JT job id) is optional — passed by the leads dashboard when we
    // have a matched JT job for this lead. Drives the "Recent Activity"
    // feed: JT comments are scoped to a job, GHL messages to a contact.
    const jobId = req.nextUrl.searchParams.get('jobId');

    if (!contactId) {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
    }

    // Fetch contact, notes, appointments, optional opportunity + the activity
    // feed sources (JT comments + Loop messages + PML project events) in parallel.
    const [contactRes, notes, appointments, opportunity, jtComments, loopMessages, pmlEvents] = await Promise.all([
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
      // JT job comments — only fetch if we have a job id. Cached in Supabase
      // (jt_comments table), falls back to live JT API when DB is empty.
      jobId
        ? getCommentsFromDB(jobId, 25).catch((e: any) => {
            console.warn('[lead-detail] getCommentsFromDB failed:', e.message);
            return [];
          })
        : Promise.resolve([]),
      // Loop/GHL messages (SMS + email) for the contact. Cached in Supabase
      // (ghl_messages table), falls back to live GHL API when DB is empty.
      getMessagesFromDB(contactId, 50).catch((e: any) => {
        console.warn('[lead-detail] getMessagesFromDB failed:', e.message);
        return [];
      }),
      // Project Memory Layer events — call transcripts, decisions, meeting
      // logs saved by Nathan / Terri through the Post-Call Actions panel
      // or Ask Agent. Queries by jobId (when matched) AND by GHL contact /
      // opportunity in source_ref so transcripts saved at the lead stage
      // (before a JT job exists) still appear.
      getProjectMemoryForLead({
        jobId: jobId || null,
        ghlContactId: contactId,
        ghlOpportunityId: opportunityId || null,
        daysBack: 365,
        limit: 50,
      }).catch((e: any) => {
        console.warn('[lead-detail] getProjectMemoryForLead failed:', e.message);
        return [];
      }),
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

    // ── Recent Activity feed ──────────────────────────────────
    // Merge JT comments + Loop messages into a single chronological
    // feed so Nathan / Terri can see the most recent touchpoints on
    // the project from one place. Fezzuoglio surfaced this gap — the
    // leads dashboard showed "last activity: comment" but there was
    // no UI to read the actual comment body.
    //
    // Each activity item carries:
    //   kind:        'jt_comment' | 'sms' | 'email' | 'call' | 'message' | 'pml_transcript' | 'pml_event'
    //   body:        plain text of the comment / message / event detail
    //   author:      who wrote it (JT user name, "Inbound"/"Outbound", or PML participants)
    //   direction:   'inbound' | 'outbound' | null (only for Loop messages)
    //   subject:     email subject (Loop emails only) or PML event summary
    //   date:        ISO timestamp
    //   source:      'jobtread' | 'loop' | 'pml'
    type ActivityItem = {
      kind: string;
      body: string;
      author: string;
      direction: 'inbound' | 'outbound' | null;
      subject: string;
      date: string;
      source: 'jobtread' | 'loop' | 'pml';
    };
    const recentActivity: ActivityItem[] = [];

    // PML events come first since these are the most semantically rich
    // (full transcripts, decisions, action items). Channel maps to the
    // visual kind on the UI side.
    for (const ev of (pmlEvents || []) as any[]) {
      const body = (ev.detail || ev.summary || '').toString().trim();
      if (!body) continue;
      const channel = (ev.channel || '').toString().toLowerCase();
      const kind = ev.event_type === 'meeting_held' || channel === 'meeting' || channel === 'phone'
        ? 'pml_transcript'
        : 'pml_event';
      const participants = Array.isArray(ev.participants) ? ev.participants.filter(Boolean).join(', ') : '';
      recentActivity.push({
        kind,
        body,
        author: participants || 'Project Memory',
        direction: null,
        subject: (ev.summary || '').toString(),
        date: ev.event_date || ev.created_at || '',
        source: 'pml',
      });
    }

    for (const c of (jtComments || []) as any[]) {
      const body = (c.message || '').trim();
      if (!body) continue;
      recentActivity.push({
        kind: 'jt_comment',
        body,
        author: c.name || 'JobTread',
        direction: null,
        subject: '',
        date: c.createdAt || '',
        source: 'jobtread',
      });
    }

    // Loop messages come from GHL conversations. The shape varies a bit
    // depending on whether they were pulled from the cache or live API,
    // so we normalize defensively. Map GHL's numeric/string `type` into
    // a friendly kind label (SMS / Email / Call).
    const msgKind = (t: any): string => {
      const s = String(t || '').toLowerCase();
      if (s === '1' || s.includes('sms')) return 'sms';
      if (s === '2' || s.includes('phone') || s.includes('call')) return 'call';
      if (s === '3' || s.includes('email')) return 'email';
      return 'message';
    };
    for (const m of (loopMessages || []) as any[]) {
      const bodyRaw = (m.body || m.message || m.preview || '').toString().trim();
      // Email body sometimes lives in messageHTML; strip HTML for the feed.
      const body = bodyRaw || ((m.messageHTML || '').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      if (!body && !m.subject) continue; // skip purely empty rows
      const dir = (m.direction || '').toString().toLowerCase();
      recentActivity.push({
        kind: msgKind(m.type),
        body: body || '(no body)',
        author: dir === 'inbound' ? 'Inbound' : dir === 'outbound' ? 'Outbound' : 'Loop',
        direction: dir === 'inbound' ? 'inbound' : dir === 'outbound' ? 'outbound' : null,
        subject: (m.subject || '').toString(),
        date: m.dateAdded || m.dateUpdated || m.dateCreated || '',
        source: 'loop',
      });
    }

    // Sort newest first, cap at 30 entries so the modal stays responsive.
    recentActivity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const recentActivityCapped = recentActivity.slice(0, 30);

    // Build response
    return NextResponse.json({
      projectAddress,
      recentActivity: recentActivityCapped,
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

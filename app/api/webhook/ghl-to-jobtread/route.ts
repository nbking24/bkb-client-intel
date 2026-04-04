/**
 * GHL → JobTread Webhook
 *
 * Called by a GHL/Loop workflow when an opportunity moves to the "Estimating" stage.
 * Creates a customer account, contact, location, and job in JobTread.
 *
 * GHL sends the contact's details via POST body. The webhook:
 *   1. Creates a customer account in JT (name = contact full name)
 *   2. Creates a contact on that account (with email + phone)
 *   3. Creates a location on that account (using the contact's address)
 *   4. Creates a job linked to that location (name capped at 30 chars)
 *   5. Sets the account's primary contact and primary location
 *   6. Writes the JT job ID back to the GHL opportunity custom field
 *
 * Expects POST JSON body (from GHL Custom Webhook dynamic values):
 * {
 *   "firstName": "{{contact.first_name}}",
 *   "lastName": "{{contact.last_name}}",
 *   "email": "{{contact.email}}",
 *   "phone": "{{contact.phone}}",
 *   "address": "{{contact.address1}}",
 *   "city": "{{contact.city}}",
 *   "state": "{{contact.state}}",
 *   "zip": "{{contact.postal_code}}",
 *   "opportunityName": "{{opportunity.name}}",
 *   "ghlContactId": "{{contact.id}}",
 *   "ghlOpportunityId": "{{opportunity.id}}"
 * }
 *
 * Security: Protected by a shared secret in the X-Webhook-Secret header.
 */

import { NextRequest, NextResponse } from 'next/server';

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = process.env.JOBTREAD_API_KEY || '';
const JT_ORG = process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';
const WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET || '';

// GHL API config (for writing JT job ID back to opportunity)
const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_API_URL = 'https://services.leadconnectorhq.com';
const GHL_LOCATION_ID = 'H3fSXP5K9fMGf0eJIkXk';
const GHL_CF_JT_JOB_ID = 'GjwWvbGyh7CQfGmFir5p'; // "JT Job ID" custom field on opportunities

// Custom field IDs for contact email/phone (stored as custom fields in JT)
const CF_EMAIL = '22P5SRxXsV55';
const CF_PHONE = '22P5SRxmTkuH';

// ── PAVE helper ──
async function pave(query: Record<string, unknown>) {
  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { $: { grantKey: JT_KEY }, ...query } }),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PAVE ${res.status}: ${text.slice(0, 300)}`);
  if (!text) return {};
  return JSON.parse(text);
}

// ── Main handler ──
export async function POST(request: NextRequest) {
  // Top-level debug: log raw request info
  const contentType = request.headers.get('content-type') || 'none';
  console.log('[WEBHOOK] Incoming request — Content-Type:', contentType);

  // --- Auth check ---
  if (WEBHOOK_SECRET) {
    const secret = request.headers.get('x-webhook-secret') || '';
    if (secret !== WEBHOOK_SECRET) {
      console.log('[WEBHOOK] Auth FAILED — secret mismatch');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.log('[WEBHOOK] Auth OK');
  } else {
    console.log('[WEBHOOK] No webhook secret configured — skipping auth');
  }

  // Read the raw body text first so we can log it
  let rawBody: string;
  let body: any;
  try {
    rawBody = await request.text();
    console.log('[WEBHOOK] Raw body:', rawBody.slice(0, 1000));
  } catch (e: any) {
    console.log('[WEBHOOK] Failed to read body text:', e.message);
    return NextResponse.json({ error: 'Failed to read body' }, { status: 400 });
  }

  try {
    body = JSON.parse(rawBody);
    console.log('[WEBHOOK] Parsed body keys:', Object.keys(body).join(', '));
  } catch {
    console.log('[WEBHOOK] Invalid JSON — could not parse body');
    return NextResponse.json({ error: 'Invalid JSON body', rawBodyPreview: rawBody.slice(0, 500) }, { status: 400 });
  }

  // Accept both camelCase (spec) and snake_case (GHL webhook default)
  const firstName = body.firstName || body.first_name || '';
  const lastName = body.lastName || body.last_name || '';
  const email = body.email || '';
  const phone = body.phone || '';
  const address = body.address || '';
  const city = body.city || '';
  const state = body.state || '';
  const zip = body.zip || body.zip_code || '';
  const opportunityName = body.opportunityName || body.opportunity_name || '';
  const ghlContactId = body.ghlContactId || body.contact_id || '';
  const ghlOpportunityId = body.ghlOpportunityId || body.opportunity_id || '';

  const fullName = `${firstName} ${lastName}`.trim();
  console.log('[WEBHOOK] Extracted — name:', fullName, '| email:', email, '| phone:', phone, '| opp:', opportunityName, '| ghlOppId:', ghlOpportunityId);
  if (!fullName) {
    console.log('[WEBHOOK] FAIL — no name extracted from body');
    return NextResponse.json({ error: 'firstName or lastName is required' }, { status: 400 });
  }

  const fullAddress = [address, city, state, zip].filter(Boolean).join(', ');
  // JobTread caps job names at 30 characters
  const rawJobName = opportunityName || `${fullName} Renovation`;
  const jobName = rawJobName.length > 30 ? rawJobName.slice(0, 30).trim() : rawJobName;

  const log: string[] = [];

  try {
    // ── Step 1: Create customer account ──
    log.push(`Creating account: ${fullName}`);
    const acctData = await pave({
      createAccount: {
        $: { name: fullName, type: 'customer', organizationId: JT_ORG },
        createdAccount: { id: {}, name: {} },
      },
    });
    const accountId = acctData?.createAccount?.createdAccount?.id;
    if (!accountId) throw new Error('createAccount did not return an ID');
    log.push(`  → Account created: ${accountId}`);

    // ── Step 2: Create contact on the account ──
    // Email/phone are stored as custom fields in JobTread, not native fields.
    log.push(`Creating contact: ${fullName}`);
    const contactParams: Record<string, unknown> = { name: fullName, accountId };

    // Build custom field values for email and phone
    const customFieldValues: Record<string, string> = {};
    if (email) customFieldValues[CF_EMAIL] = email;
    if (phone) customFieldValues[CF_PHONE] = phone;
    if (Object.keys(customFieldValues).length > 0) {
      contactParams.customFieldValues = customFieldValues;
    }

    const contactData = await pave({
      createContact: {
        $: contactParams,
        createdContact: { id: {}, name: {} },
      },
    });
    const contactId = contactData?.createContact?.createdContact?.id;
    if (!contactId) throw new Error('createContact did not return an ID');
    log.push(`  → Contact created: ${contactId}${email ? ` (${email})` : ''}`);

    // ── Step 3: Create location on the account ──
    const locationName = fullAddress || 'TBD';
    log.push(`Creating location: ${locationName}`);
    const locationParams: Record<string, unknown> = {
      name: locationName,
      accountId,
    };
    if (fullAddress) locationParams.address = fullAddress;

    const locData = await pave({
      createLocation: {
        $: locationParams,
        createdLocation: { id: {}, name: {} },
      },
    });
    const locationId = locData?.createLocation?.createdLocation?.id;
    if (!locationId) throw new Error('createLocation did not return an ID');
    log.push(`  → Location created: ${locationId}`);

    // ── Step 4: Create the job ──
    log.push(`Creating job: ${jobName}`);
    const jobData = await pave({
      createJob: {
        $: { name: jobName, locationId },
        createdJob: { id: {}, name: {}, number: {} },
      },
    });
    const job = jobData?.createJob?.createdJob;
    if (!job?.id) throw new Error('createJob did not return an ID');
    log.push(`  → Job created: ${job.id} (#${job.number})`);

    // ── Step 5: Set primary contact and primary location on the account ──
    try {
      await pave({
        updateAccount: {
          $: { id: accountId, primaryContactId: contactId, primaryLocationId: locationId },
        },
      });
      log.push('  → Primary contact and location set');
    } catch (e: any) {
      log.push(`  ⚠ Could not set primary contact/location: ${e.message}`);
    }

    // ── Step 6: Write JT job ID back to GHL opportunity ──
    if (ghlOpportunityId && GHL_API_KEY) {
      try {
        const ghlRes = await fetch(
          `${GHL_API_URL}/opportunities/${ghlOpportunityId}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${GHL_API_KEY}`,
              'Content-Type': 'application/json',
              Version: '2021-07-28',
            },
            body: JSON.stringify({
              customFields: [
                { id: GHL_CF_JT_JOB_ID, value: job.id },
              ],
            }),
          }
        );
        if (ghlRes.ok) {
          log.push(`  → JT Job ID written back to GHL opportunity`);
        } else {
          const errText = await ghlRes.text();
          log.push(`  ⚠ GHL write-back failed (${ghlRes.status}): ${errText.slice(0, 200)}`);
        }
      } catch (e: any) {
        log.push(`  ⚠ GHL write-back error: ${e.message}`);
      }
    } else {
      if (!ghlOpportunityId) log.push('  ⚠ No GHL opportunity ID — skipping write-back');
      if (!GHL_API_KEY) log.push('  ⚠ No GHL API key configured — skipping write-back');
    }

    // ── Done ──
    return NextResponse.json({
      success: true,
      accountId,
      contactId,
      locationId,
      jobId: job.id,
      jobNumber: job.number,
      jobName: job.name,
      ghlContactId,
      ghlOpportunityId,
      log,
    });
  } catch (err: any) {
    console.error('[WEBHOOK] ERROR in JT creation chain:', err.message, err.stack?.slice(0, 300));
    log.push(`ERROR: ${err.message}`);
    return NextResponse.json(
      { success: false, error: err.message, log },
      { status: 500 }
    );
  }
}

// Also support GET for health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'GHL → JobTread webhook',
    description: 'POST contact data to create a customer account + job in JobTread',
  });
}

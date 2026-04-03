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
 *   4. Creates a job linked to that location
 *   5. Sets the account's primary contact and primary location
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
  // --- Auth check ---
  if (WEBHOOK_SECRET) {
    const secret = request.headers.get('x-webhook-secret') || '';
    if (secret !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    firstName = '',
    lastName = '',
    email = '',
    phone = '',
    address = '',
    city = '',
    state = '',
    zip = '',
    opportunityName = '',
    ghlContactId = '',
    ghlOpportunityId = '',
  } = body;

  const fullName = `${firstName} ${lastName}`.trim();
  if (!fullName) {
    return NextResponse.json({ error: 'firstName or lastName is required' }, { status: 400 });
  }

  const fullAddress = [address, city, state, zip].filter(Boolean).join(', ');
  const jobName = opportunityName || `${fullName} Renovation`;

  const log: string[] = [];

  try {
    // ── Step 1: Check for existing account, create if not found ──
    log.push(`Checking for existing account: ${fullName}`);
    let accountId: string | null = null;

    // Search for existing customer account by name
    const searchData = await pave({
      accounts: {
        $: { organizationId: JT_ORG, type: 'customer', search: fullName },
        nodes: { id: {}, name: {} },
      },
    });
    const existingAccounts = searchData?.accounts?.nodes || [];
    const exactMatch = existingAccounts.find(
      (a: any) => a.name?.toLowerCase() === fullName.toLowerCase()
    );

    if (exactMatch) {
      accountId = exactMatch.id;
      log.push(`  → Found existing account: ${accountId} ("${exactMatch.name}")`);
    } else {
      log.push(`Creating new account: ${fullName}`);
      const acctData = await pave({
        createAccount: {
          $: { name: fullName, type: 'customer', organizationId: JT_ORG },
          createdAccount: { id: {}, name: {} },
        },
      });
      accountId = acctData?.createAccount?.createdAccount?.id;
      if (!accountId) throw new Error('createAccount did not return an ID');
      log.push(`  → Account created: ${accountId}`);
    }

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

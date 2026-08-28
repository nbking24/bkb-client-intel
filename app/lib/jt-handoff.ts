// @ts-nocheck
/**
 * Shared "hand off a Loop lead to JobTread" routine.
 *
 * Creates the JobTread customer account, contact (email/phone as custom
 * fields), location, and job, sets the account primaries, and writes the
 * new JobTread job id back onto the Loop opportunity's "JT Job ID" field.
 *
 * Mirrors the logic in app/api/webhook/ghl-to-jobtread but callable from a
 * cron so the hand-off no longer depends on a Loop workflow trigger.
 */

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';
const JT_ORG = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';

const GHL_API_URL = 'https://services.leadconnectorhq.com';
const GHL_API_KEY = () => process.env.GHL_API_KEY || '';

// JobTread customer-contact custom fields
const CF_EMAIL = '22P5SRxXsV55';
const CF_PHONE = '22P5SRxmTkuH';
// GHL opportunity custom field
const GHL_CF_JT_JOB_ID = 'GjwWvbGyh7CQfGmFir5p';

async function pave(query: Record<string, unknown>) {
  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { $: { grantKey: JT_KEY() }, ...query } }),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PAVE ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

export interface HandoffLead {
  fullName: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  opportunityName?: string;
  ghlOpportunityId?: string;
}

export interface HandoffResult {
  ok: boolean;
  jobId?: string;
  jobNumber?: string;
  accountId?: string;
  wroteBack?: boolean;
  error?: string;
}

export async function createJobTreadJobForLead(lead: HandoffLead): Promise<HandoffResult> {
  const fullName = (lead.fullName || '').trim();
  if (!fullName) return { ok: false, error: 'missing name' };

  const fullAddress = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
  const rawJobName = lead.opportunityName || `${fullName} Renovation`;
  const jobName = rawJobName.length > 30 ? rawJobName.slice(0, 30).trim() : rawJobName;

  // 1) Account
  const acct = await pave({
    createAccount: {
      $: { name: fullName, type: 'customer', organizationId: JT_ORG() },
      createdAccount: { id: {}, name: {} },
    },
  });
  const accountId = acct?.createAccount?.createdAccount?.id;
  if (!accountId) throw new Error('createAccount returned no id');

  // 2) Contact (email/phone as custom fields)
  const cfv: Record<string, string> = {};
  if (lead.email) cfv[CF_EMAIL] = lead.email;
  if (lead.phone) cfv[CF_PHONE] = lead.phone;
  const contactParams: Record<string, unknown> = { name: fullName, accountId };
  if (Object.keys(cfv).length) contactParams.customFieldValues = cfv;
  const contact = await pave({
    createContact: { $: contactParams, createdContact: { id: {} } },
  });
  const contactId = contact?.createContact?.createdContact?.id;

  // 3) Location
  const loc = await pave({
    createLocation: {
      $: { name: fullAddress || 'TBD', accountId, ...(fullAddress ? { address: fullAddress } : {}) },
      createdLocation: { id: {} },
    },
  });
  const locationId = loc?.createLocation?.createdLocation?.id;
  if (!locationId) throw new Error('createLocation returned no id');

  // 4) Job
  const jobData = await pave({
    createJob: {
      $: { name: jobName, locationId },
      createdJob: { id: {}, name: {}, number: {} },
    },
  });
  const job = jobData?.createJob?.createdJob;
  if (!job?.id) throw new Error('createJob returned no id');

  // 5) Primaries
  try {
    await pave({
      updateAccount: {
        $: { id: accountId, ...(contactId ? { primaryContactId: contactId } : {}), primaryLocationId: locationId },
      },
    });
  } catch { /* non-fatal */ }

  // 6) Write JT job id back to the Loop opportunity
  let wroteBack = false;
  if (lead.ghlOpportunityId && GHL_API_KEY()) {
    try {
      const res = await fetch(`${GHL_API_URL}/opportunities/${lead.ghlOpportunityId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${GHL_API_KEY()}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28',
        },
        body: JSON.stringify({ customFields: [{ id: GHL_CF_JT_JOB_ID, value: job.id }] }),
      });
      wroteBack = res.ok;
    } catch { /* non-fatal */ }
  }

  return { ok: true, jobId: job.id, jobNumber: job.number, accountId, wroteBack };
}

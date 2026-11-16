// @ts-nocheck
/**
 * New leads into JobTread (replaces Loop's website form and booking widget).
 *
 * Two doors:
 *   1. Website contact form (/contact, POST /api/public/contact)
 *   2. Calendly "Informational Call" bookings (POST /api/webhook/calendly)
 *
 * Both call ensureLeadJob(): find the person in JobTread by the contact Email
 * custom field. If they already have an open job, use it (and move a
 * "1. New Lead" job to "2. Meeting Scheduled" when they book). If not, create
 * what is missing: customer account, contact, location (address or "Address
 * TBD"), and a job with Status, Lead Source, Job Type, Referred By and Intake
 * Notes filled in.
 *
 * Style: no em or en dashes in anything written to JobTread or email.
 */

const JT_URL = 'https://api.jobtread.com/pave';
const JT_ORG = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';

export const CF = {
  contactEmail: '22P5SRxXsV55',
  contactPhone: '22P5SRxmTkuH',
  jobStatus: '22P5SRxYPb7Q',
  jobType: '22P624zkWwW9',
  referredBy: '22P7Vz3AYRyj',
  leadSource: '22PfZ9fi3Mdz',
  intakeNotes: '22Pg3NbLqeBK',
};

export const STATUS_NEW_LEAD = '1. New Lead';
export const STATUS_MEETING = '2. Meeting Scheduled';

export const LEAD_SOURCES = ['Website', 'Referral', 'Repeat Client', 'Google', 'Social Media', 'Event', 'Truck / Sign', 'Other'];

/** Website project types -> JobTread Job Type option (single select). */
const JOB_TYPE_MAP: Record<string, string> = {
  Kitchen: 'Kitchen',
  Bathroom: 'Bathroom',
  Basement: 'Basement',
  Addition: 'Addition',
  'Whole House': 'Full Remodel',
  'Detached Structure': 'Garage',
  Exterior: 'Exterior',
};

/** Short job-name word for each type: "Smith Kitchen". */
const NAME_WORD: Record<string, string> = {
  Kitchen: 'Kitchen',
  Bathroom: 'Bathroom',
  Basement: 'Basement',
  Addition: 'Addition',
  'Whole House': 'Renovation',
  'Detached Structure': 'Outbuilding',
  Exterior: 'Exterior',
};

export const INFORMATIONAL_CALL_URL =
  process.env.INFORMATIONAL_CALL_URL || 'https://calendly.com/d/dty2-rqd-5mv/informational-call';

export async function pave(query: Record<string, unknown>) {
  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { $: { grantKey: process.env.JOBTREAD_API_KEY || '' }, ...query } }),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PAVE ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function contactsByEmail(email: string) {
  const data = await pave({
    organization: {
      $: { id: JT_ORG() },
      contacts: {
        $: {
          size: 10,
          with: { em: { _: 'customFieldValues', $: { where: [['customField', 'id'], CF.contactEmail] }, values: { $: { field: 'value' } } } },
          where: [['em', 'values'], '=', email],
        },
        nodes: {
          id: {},
          name: {},
          account: {
            id: {},
            name: {},
            locations: { $: { size: 5 }, nodes: { id: {}, name: {} } },
            jobs: {
              $: { size: 25 },
              nodes: {
                id: {}, name: {}, number: {}, closedOn: {}, createdAt: {},
                customFieldValues: { $: { size: 5, where: [['customField', 'id'], '=', CF.jobStatus] }, nodes: { value: {} } },
              },
            },
          },
        },
      },
    },
  });
  return data?.organization?.contacts?.nodes || [];
}

/** Everything we know about an email in JobTread. */
export async function lookupByEmail(rawEmail: string) {
  const tries = Array.from(new Set([rawEmail.trim(), rawEmail.trim().toLowerCase()])).filter(Boolean);
  for (const e of tries) {
    const contacts = await contactsByEmail(e);
    if (contacts.length) {
      const c = contacts[0];
      const jobs = contacts.flatMap((x) => x?.account?.jobs?.nodes || []);
      const open = jobs.filter((j) => !j.closedOn);
      const main = open.filter((j) => !/ongoing/i.test(j.name || ''));
      const pool = (main.length ? main : open).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const job = pool[0] || null;
      return {
        contact: { id: c.id, name: c.name },
        account: c.account ? { id: c.account.id, name: c.account.name, locations: c.account.locations?.nodes || [] } : null,
        openJob: job ? { id: job.id, name: job.name, number: job.number, status: job.customFieldValues?.nodes?.[0]?.value || null } : null,
        hadClosedJob: jobs.some((j) => j.closedOn),
      };
    }
  }
  return { contact: null, account: null, openJob: null, hadClosedJob: false };
}

function splitName(full: string) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || '', last: parts[0] || '' };
  return { first: parts[0], last: parts[parts.length - 1] };
}

export function jobNameFor(fullName: string, types: string[] = []) {
  const { last } = splitName(fullName);
  const word = types.map((t) => NAME_WORD[t]).find(Boolean) || 'Project';
  const name = `${last || 'New'} ${word}`.trim();
  return name.length > 30 ? name.slice(0, 30).trim() : name;
}

export interface LeadInput {
  name: string;           // full name
  email: string;
  phone?: string;
  address?: string;       // single line, may be blank
  types?: string[];       // website project types
  message?: string;       // "Tell us about your project"
  leadSource?: string;    // one of LEAD_SOURCES
  referredBy?: string;
  via: 'contact form' | 'Informational Call';
  meetingWhen?: string;   // for bookings, human-readable Eastern time
}

export interface LeadResult {
  action: 'existing' | 'created' | 'created-on-existing-account';
  jobId: string;
  jobName: string;
  jobNumber?: string;
  statusChanged?: string;
  log: string[];
}

export function jobUrl(jobId: string) {
  return `https://app.jobtread.com/jobs/${jobId}`;
}

function intakeNotes(input: LeadInput) {
  const lines = [
    `Came in via the ${input.via} on ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}.`,
    input.meetingWhen ? `Informational Call: ${input.meetingWhen}` : '',
    input.types?.length ? `Project type: ${input.types.join(', ')}` : '',
    input.phone ? `Phone: ${input.phone}` : '',
    input.email ? `Email: ${input.email}` : '',
    input.address ? `Address: ${input.address}` : 'Address: not given yet',
    input.leadSource ? `How they heard about us: ${input.leadSource}${input.referredBy ? ' (' + input.referredBy + ')' : ''}` : '',
    input.message ? `\n${input.message}` : '',
  ];
  return lines.filter(Boolean).join('\n').slice(0, 4000);
}

/**
 * Find or create the lead's job. Never throws for "already exists";
 * throws only when a JobTread write fails.
 */
export async function ensureLeadJob(input: LeadInput, opts: { bumpToMeeting?: boolean } = {}): Promise<LeadResult> {
  const log: string[] = [];
  const found = await lookupByEmail(input.email);

  // 1. Open job already there: use it.
  if (found.openJob) {
    let statusChanged;
    if (opts.bumpToMeeting && (!found.openJob.status || found.openJob.status === STATUS_NEW_LEAD)) {
      await pave({ updateJob: { $: { id: found.openJob.id, customFieldValues: { [CF.jobStatus]: STATUS_MEETING } } } });
      statusChanged = STATUS_MEETING;
      log.push(`Status set to ${STATUS_MEETING}`);
    }
    log.push(`Existing job ${found.openJob.name} (${found.openJob.number})`);
    return { action: 'existing', jobId: found.openJob.id, jobName: found.openJob.name, jobNumber: found.openJob.number, statusChanged, log };
  }

  const fullName = String(input.name || '').trim() || input.email;
  let accountId = found.account?.id;
  let contactId = found.contact?.id;

  // 2. New person: account + contact.
  if (!accountId) {
    const acct = await pave({
      createAccount: { $: { name: fullName, type: 'customer', organizationId: JT_ORG(), suffixIfNecessary: true }, createdAccount: { id: {} } },
    });
    accountId = acct?.createAccount?.createdAccount?.id;
    if (!accountId) throw new Error('createAccount returned no id');
    log.push(`Account created: ${fullName}`);

    const cfv: Record<string, string> = { [CF.contactEmail]: input.email.trim() };
    if (input.phone) cfv[CF.contactPhone] = input.phone.trim();
    const ct = await pave({ createContact: { $: { accountId, name: fullName, customFieldValues: cfv }, createdContact: { id: {} } } });
    contactId = ct?.createContact?.createdContact?.id;
    if (!contactId) throw new Error('createContact returned no id');
    log.push('Contact created');
  }

  // 3. Location: the given address, else the account's existing one, else "Address TBD".
  let locationId;
  const address = String(input.address || '').trim();
  if (address) {
    const loc = await pave({ createLocation: { $: { accountId, name: address, address, parseAddress: true, ...(contactId ? { contactId } : {}) }, createdLocation: { id: {} } } });
    locationId = loc?.createLocation?.createdLocation?.id;
  } else if (found.account?.locations?.length) {
    locationId = found.account.locations[0].id;
  } else {
    const loc = await pave({ createLocation: { $: { accountId, name: 'Address TBD', ...(contactId ? { contactId } : {}) }, createdLocation: { id: {} } } });
    locationId = loc?.createLocation?.createdLocation?.id;
  }
  if (!locationId) throw new Error('No location for the job');
  log.push(address ? `Location: ${address}` : 'Location: Address TBD');

  // 4. Job.
  const jobType = (input.types || []).map((t) => JOB_TYPE_MAP[t]).find(Boolean);
  const source = LEAD_SOURCES.includes(input.leadSource || '') ? input.leadSource : (found.hadClosedJob ? 'Repeat Client' : 'Website');
  const cfv: Record<string, string> = {
    [CF.jobStatus]: opts.bumpToMeeting ? STATUS_MEETING : STATUS_NEW_LEAD,
    [CF.leadSource]: source,
    [CF.intakeNotes]: intakeNotes(input),
  };
  if (jobType) cfv[CF.jobType] = jobType;
  if (input.referredBy) cfv[CF.referredBy] = input.referredBy.slice(0, 200);

  const name = jobNameFor(fullName, input.types);
  const job = await pave({
    createJob: {
      $: { locationId, name, description: String(input.message || '').slice(0, 30000) || undefined, customFieldValues: cfv },
      createdJob: { id: {}, name: {}, number: {} },
    },
  });
  const j = job?.createJob?.createdJob;
  if (!j?.id) throw new Error('createJob returned no id');
  log.push(`Job created: ${j.name} (${j.number})`);

  if (!found.account) {
    try { await pave({ updateAccount: { $: { id: accountId, primaryContactId: contactId, primaryLocationId: locationId } } }); } catch {}
  }

  return { action: found.account ? 'created-on-existing-account' : 'created', jobId: j.id, jobName: j.name, jobNumber: j.number, log };
}

/** Attach a public file URL to a JobTread job (createUploadRequest + createFile). */
export async function attachUrlToJob(jobId: string, f: { url: string; name: string; type?: string }) {
  const up = await pave({
    createUploadRequest: {
      $: { url: f.url, organizationId: JT_ORG(), ...(f.type ? { type: f.type } : { type: { fromName: f.name } }) },
      createdUploadRequest: { id: {} },
    },
  });
  const uploadRequestId = up?.createUploadRequest?.createdUploadRequest?.id;
  if (!uploadRequestId) throw new Error('createUploadRequest returned no id');
  await pave({ createFile: { $: { name: f.name, targetType: 'job', targetId: jobId, uploadRequestId }, createdFile: { id: {} } } });
}

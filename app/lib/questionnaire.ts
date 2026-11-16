// @ts-nocheck
/**
 * Project Questionnaire: match a submission to its JobTread job and log it.
 *
 * Flow (see /start and /api/public/questionnaire):
 *   1. Client submits; the row is saved to Supabase `project_questionnaires` first.
 *   2. pushSubmission() finds the JobTread contact by the Email custom field,
 *      picks the account's main open job (not an "Ongoing" job, newest first),
 *      creates a daily log with every answer, and attaches the photos to that
 *      log through createUploadRequest(url) + createFile.
 *   3. No match: status 'unmatched', Nathan and Terri get one email, and the
 *      nightly cron retries until the job exists.
 *
 * Style: no em or en dashes in anything written to JobTread or email.
 */
import { createServerClient } from '@/app/lib/supabase';
import { sendEmail, escapeHtml } from '@/app/api/lib/email';
import { easternDateString } from '@/app/lib/eastern-time';
import { labelMap, ANSWER_ORDER, PROJECT_TYPES } from '@/app/lib/questionnaire-config';

const JT_URL = 'https://api.jobtread.com/pave';
const JT_ORG = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';
const CF_EMAIL = '22P5SRxXsV55';
export const BUCKET = 'questionnaire-uploads';
const NOTIFY = () =>
  [process.env.TICKET_NOTIFY_NATHAN || 'nathan@brettkingbuilder.com', process.env.TICKET_NOTIFY_TERRI || 'brett@brettkingbuilder.com'];

async function pave(query: Record<string, unknown>) {
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
          with: { em: { _: 'customFieldValues', $: { where: [['customField', 'id'], CF_EMAIL] }, values: { $: { field: 'value' } } } },
          where: [['em', 'values'], '=', email],
        },
        nodes: {
          id: {},
          name: {},
          account: { id: {}, name: {}, jobs: { $: { size: 25 }, nodes: { id: {}, name: {}, closedOn: {}, createdAt: {} } } },
        },
      },
    },
  });
  return data?.organization?.contacts?.nodes || [];
}

/** Find the client's main open job by email. Returns null when there's no job yet. */
export async function findJobForEmail(rawEmail: string): Promise<{ id: string; name: string } | null> {
  const tries = Array.from(new Set([rawEmail.trim(), rawEmail.trim().toLowerCase()]));
  let jobs: any[] = [];
  for (const e of tries) {
    const contacts = await contactsByEmail(e);
    for (const c of contacts) jobs.push(...(c?.account?.jobs?.nodes || []));
    if (jobs.length) break;
  }
  const open = jobs.filter((j) => !j.closedOn);
  if (!open.length) return null;
  const main = open.filter((j) => !/ongoing/i.test(j.name || ''));
  const pool = main.length ? main : open;
  pool.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { id: pool[0].id, name: pool[0].name };
}

function formatAnswer(v: any): string {
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  return String(v ?? '').trim();
}

export function buildLogNotes(row: any, isUpdate: boolean): string {
  const labels = labelMap();
  const a = row.answers || {};
  const types = (row.project_types || []).map((t) => PROJECT_TYPES.find((p) => p.id === t)?.label || t).join(', ');
  const lines: string[] = [];
  lines.push(`**Project Questionnaire${isUpdate ? ' (update)' : ''}**`);
  lines.push(`Submitted by ${row.name} (${row.email}${row.phone ? ', ' + row.phone : ''}) on ${easternDateString(row.created_at)}.`);
  lines.push('');
  if (types) lines.push(`**Project type:** ${types}`, '');
  for (const id of ANSWER_ORDER) {
    const val = formatAnswer(a[id]);
    if (!val) continue;
    lines.push(`**${labels[id] || id}**`, val, '');
  }
  const files = row.files || [];
  if (files.length) lines.push(`**Uploaded files:** ${files.length}, attached to this log.`);
  return lines.join('\n').trim();
}

async function attachFile(dailyLogId: string, f: { url: string; name: string; type?: string }) {
  const up = await pave({
    createUploadRequest: {
      $: { url: f.url, organizationId: JT_ORG(), ...(f.type ? { type: f.type } : { type: { fromName: f.name } }) },
      createdUploadRequest: { id: {} },
    },
  });
  const uploadRequestId = up?.createUploadRequest?.createdUploadRequest?.id;
  if (!uploadRequestId) throw new Error('createUploadRequest returned no id');
  await pave({
    createFile: {
      $: { name: f.name, targetType: 'dailyLog', targetId: dailyLogId, uploadRequestId },
      createdFile: { id: {} },
    },
  });
}

/** Try to land one submission in JobTread. Never throws; updates the row. */
export async function pushSubmission(rowId: string): Promise<{ status: string; jobName?: string; error?: string }> {
  const sb = createServerClient();
  const { data: row } = await sb.from('project_questionnaires').select('*').eq('id', rowId).single();
  if (!row) return { status: 'missing' };
  if (row.status === 'matched') return { status: 'matched', jobName: row.jt_job_name };

  try {
    const job = await findJobForEmail(row.email);
    if (!job) {
      const firstTime = !row.unmatched_notified_at;
      await sb.from('project_questionnaires').update({
        status: 'unmatched', attempts: (row.attempts || 0) + 1, last_error: null,
        ...(firstTime ? { unmatched_notified_at: new Date().toISOString() } : {}),
      }).eq('id', rowId);
      if (firstTime) await notifyUnmatched(row);
      return { status: 'unmatched' };
    }

    const { count } = await sb.from('project_questionnaires').select('id', { count: 'exact', head: true })
      .eq('status', 'matched').eq('jt_job_id', job.id);
    const notes = buildLogNotes(row, (count || 0) > 0);
    const created = await pave({
      createDailyLog: {
        $: { jobId: job.id, date: easternDateString(row.created_at), notes },
        createdDailyLog: { id: {} },
      },
    });
    const logId = created?.createDailyLog?.createdDailyLog?.id;
    if (!logId) throw new Error('createDailyLog returned no id');

    const fileErrors: string[] = [];
    for (const f of row.files || []) {
      try { await attachFile(logId, f); } catch (e: any) { fileErrors.push(`${f.name}: ${e?.message || e}`); }
    }

    await sb.from('project_questionnaires').update({
      status: 'matched', jt_job_id: job.id, jt_job_name: job.name, jt_daily_log_id: logId,
      matched_at: new Date().toISOString(), attempts: (row.attempts || 0) + 1,
      last_error: fileErrors.length ? fileErrors.join(' | ').slice(0, 1000) : null,
    }).eq('id', rowId);
    return { status: 'matched', jobName: job.name };
  } catch (e: any) {
    await sb.from('project_questionnaires').update({
      status: 'error', attempts: (row.attempts || 0) + 1, last_error: String(e?.message || e).slice(0, 1000),
    }).eq('id', rowId);
    return { status: 'error', error: String(e?.message || e) };
  }
}

async function notifyUnmatched(row: any) {
  const html = `<p>A Project Questionnaire came in, but there's no JobTread job with this email yet.</p>
<p><b>${escapeHtml(row.name)}</b><br>${escapeHtml(row.email)}${row.phone ? '<br>' + escapeHtml(row.phone) : ''}</p>
<p>Create the job in JobTread (or add this email to the client's contact) and the answers will land on it automatically overnight.</p>`;
  await sendEmail({
    to: NOTIFY(),
    subject: `Questionnaire waiting for a job: ${row.name}`,
    html,
    text: `A Project Questionnaire came in from ${row.name} (${row.email}) but no JobTread job has that email yet. Create the job or add the email to the contact; the answers will land overnight.`,
  });
}

/** Has this email already submitted? Used to show "We already have your answers". */
export async function hasSubmitted(email: string): Promise<boolean> {
  const sb = createServerClient();
  const { count } = await sb.from('project_questionnaires').select('id', { count: 'exact', head: true }).ilike('email', email.trim());
  return (count || 0) > 0;
}

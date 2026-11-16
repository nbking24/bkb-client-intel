// @ts-nocheck
/**
 * Nightly: retry questionnaire submissions that had no JobTread job (or errored).
 * Mondays: email Nathan and Terri a summary of anything still unmatched.
 * Auth: Bearer CRON_SECRET or Vercel's cron header (same as other crons).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/app/lib/supabase';
import { pushSubmission } from '@/app/lib/questionnaire';
import { sendEmail, escapeHtml } from '@/app/api/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

function checkAuth(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') || '';
  if (expected && auth === `Bearer ${expected}`) return true;
  return !!req.headers.get('x-vercel-cron');
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createServerClient();
  const { data: rows } = await sb.from('project_questionnaires').select('id').in('status', ['unmatched', 'error', 'pending']).order('created_at').limit(40);
  const results = [];
  for (const r of rows || []) results.push({ id: r.id, ...(await pushSubmission(r.id)) });

  let summarySent = false;
  const isMonday = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' }) === 'Mon';
  if (isMonday || req.nextUrl.searchParams.get('summary') === '1') {
    const { data: open } = await sb.from('project_questionnaires').select('name,email,created_at,status,last_error').in('status', ['unmatched', 'error']).order('created_at');
    if (open && open.length) {
      const list = open.map((o) => `<li><b>${escapeHtml(o.name)}</b> (${escapeHtml(o.email)}), ${o.status}${o.last_error ? ': ' + escapeHtml(o.last_error.slice(0, 150)) : ''}</li>`).join('');
      await sendEmail({
        to: [process.env.TICKET_NOTIFY_NATHAN || 'nathan@brettkingbuilder.com', process.env.TICKET_NOTIFY_TERRI || 'brett@brettkingbuilder.com'],
        subject: `Questionnaires still waiting for a JobTread job: ${open.length}`,
        html: `<p>These Project Questionnaires haven't landed in JobTread yet. Usually the job hasn't been created or the email on the contact doesn't match.</p><ul>${list}</ul>`,
      });
      summarySent = true;
    }
  }
  return NextResponse.json({ processed: results.length, results, summarySent });
}

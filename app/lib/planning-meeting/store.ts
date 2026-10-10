// @ts-nocheck
/**
 * Planning Meeting: Supabase storage and request auth shared by the API routes.
 * Tables: planning_meetings, planning_meeting_tasks, planning_job_holds (migration 031).
 */
import { NextRequest } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getEffectiveAccess } from '@/app/lib/access';
import { getSupabase } from '@/app/api/lib/supabase';
import { buildBrief, buildJobById } from './brief';
import { fetchJobContext, jobInsight } from './insight';
import { nextTuesday, todayEastern, addDays, meetingNotesText } from './constants';

export const DASHBOARD_ID = 'planning-meeting';

/** Logged-in user with the planning-meeting dashboard (owners always). */
export async function authorize(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) return { ok: false, status: 401, error: 'Unauthorized' };
  const access = await getEffectiveAccess(auth.userId);
  if (!access || access.enabled === false) return { ok: false, status: 403, error: 'No access' };
  const allowed = access.role === 'owner' || (access.effectiveDashboards || []).includes(DASHBOARD_ID);
  if (!allowed) return { ok: false, status: 403, error: 'The Planning Meeting page is not turned on for this user' };
  return { ok: true, userId: auth.userId, name: access.name };
}

export async function lastConfirmedMeeting(sb = getSupabase()) {
  const { data } = await sb.from('planning_meetings').select('*').eq('status', 'confirmed').order('meeting_date', { ascending: false }).order('confirmed_at', { ascending: false }).limit(1);
  return data?.[0] || null;
}

export async function meetingTasks(meetingId: string, sb = getSupabase()) {
  if (!meetingId) return [];
  const { data } = await sb.from('planning_meeting_tasks').select('*').eq('meeting_id', meetingId);
  return data || [];
}

/** Rebuild the Prep Brief from JobTread and save it on the meeting. */
export async function refreshBrief(meeting: any, sb = getSupabase()) {
  const last = await lastConfirmedMeeting(sb);
  const lastTasks = last ? await meetingTasks(last.id, sb) : [];
  const team = await teamContextByJob(last, sb);
  const brief = await buildBrief({ lastTasks, team });
  const { data, error } = await sb.from('planning_meetings').update({ brief, brief_at: new Date().toISOString() }).eq('id', meeting.id).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

/** The open draft meeting, created for the next Tuesday if there is none. */
export async function getOrCreateDraft(userId: string | null, sb = getSupabase()) {
  const { data: drafts } = await sb.from('planning_meetings').select('*').eq('status', 'draft').limit(1);
  if (drafts?.[0]) return drafts[0];
  // The next Tuesday on or after today, but always after the last confirmed meeting
  // (confirming Tuesday's meeting on Tuesday must open next week's, not the same day).
  const last = await lastConfirmedMeeting(sb);
  let base = todayEastern();
  if (last?.meeting_date && last.meeting_date >= base) base = addDays(last.meeting_date, 1);
  const { data, error } = await sb.from('planning_meetings').insert({ meeting_date: nextTuesday(base), status: 'draft', state: {}, created_by: userId }).select('*').single();
  if (error) {
    // Another request created it at the same moment.
    const { data: again } = await sb.from('planning_meetings').select('*').eq('status', 'draft').limit(1);
    if (again?.[0]) return again[0];
    throw new Error(error.message);
  }
  return data;
}

export async function listHolds(sb = getSupabase()) {
  const { data } = await sb.from('planning_job_holds').select('*').eq('on_hold', true);
  return data || [];
}

/** Every hold row, including jobs taken off hold (for the review list). */
export async function listAllHolds(sb = getSupabase()) {
  const { data } = await sb.from('planning_job_holds').select('*');
  return data || [];
}

export async function history(sb = getSupabase()) {
  const { data: meetings } = await sb.from('planning_meetings').select('id, meeting_date, plus, delta, confirmed_at, confirmed_by').eq('status', 'confirmed').order('meeting_date', { ascending: false }).limit(30);
  const ids = (meetings || []).map((m) => m.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: t } = await sb.from('planning_meeting_tasks').select('meeting_id').in('meeting_id', ids);
    for (const r of t || []) counts[r.meeting_id] = (counts[r.meeting_id] || 0) + 1;
  }
  return (meetings || []).map((m) => ({ ...m, tasks: counts[m.id] || 0 }));
}

export async function saveCreatedTasks(meetingId: string, rows: any[], sb = getSupabase()) {
  if (!rows.length) return;
  await sb.from('planning_meeting_tasks').upsert(rows.map((r) => ({ ...r, meeting_id: meetingId })), { onConflict: 'jt_task_id', ignoreDuplicates: true });
}

/* ---------------- what the team has told Claude (planning_job_context, migration 034) ---------------- */

/** Active corrections and context rows, oldest first. */
export async function listContext(sb = getSupabase()) {
  const { data } = await sb.from('planning_job_context').select('*').is('removed_at', null).order('created_at', { ascending: true });
  return data || [];
}

/**
 * Per job: the corrections, standing context and last meeting's notes that go
 * into Claude's read. `last` is the last confirmed meeting (looked up if omitted).
 */
export async function teamContextByJob(last?: any, sb = getSupabase()) {
  if (last === undefined) last = await lastConfirmedMeeting(sb);
  const rows = await listContext(sb);
  const out: Record<string, any> = {};
  const of = (jid: string) => (out[jid] = out[jid] || { corrections: [], context: [], lastMeeting: null });
  for (const r of rows) {
    const date = String(r.created_at || '').slice(0, 10);
    if (r.kind === 'dismiss') of(r.job_id).corrections.push({ date, by: r.created_by_name || '', target: r.target || '', note: r.note || '' });
    else if (r.note?.trim()) of(r.job_id).context.push({ date, by: r.created_by_name || '', note: r.note.trim() });
  }
  for (const [jid, js] of Object.entries(last?.state?.jobs || {})) {
    const notes = meetingNotesText(js);
    if (notes) of(jid).lastMeeting = { date: last.meeting_date, notes };
  }
  return out;
}

/** Rebuild Claude's read for one job (fresh from JobTread) and save it on the meeting's brief. */
export async function redoInsight(meeting: any, jobId: string, sb = getSupabase()) {
  const today = todayEastern();
  const last = await lastConfirmedMeeting(sb);
  const [built, ctx, team] = await Promise.all([buildJobById(jobId, { today }), fetchJobContext(jobId, today), teamContextByJob(last, sb)]);
  const insight = await jobInsight(built.job, ctx, built.job._planText, today, team[jobId] || {});
  if (!insight) throw new Error('Claude did not return a read');
  // Re-read the brief so a parallel refresh is not overwritten with stale jobs.
  const { data: cur } = await sb.from('planning_meetings').select('brief').eq('id', meeting.id).single();
  const brief = cur?.brief || meeting.brief;
  const jobs = (brief?.jobs || []).map((j) => (j.id === jobId ? { ...j, insight } : j));
  const { error } = await sb.from('planning_meetings').update({ brief: { ...brief, jobs } }).eq('id', meeting.id);
  if (error) throw new Error(error.message);
  return insight;
}

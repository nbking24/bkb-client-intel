// @ts-nocheck
/**
 * Production Meeting: Supabase storage and request auth shared by the API routes.
 * Tables: production_meetings, production_meeting_tasks (migration 035).
 */
import { NextRequest } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getEffectiveAccess } from '@/app/lib/access';
import { getSupabase } from '@/app/api/lib/supabase';
import { addDays, todayEastern } from '../planning-meeting/constants';
import { buildProductionBrief } from './brief';
import { nextMonday } from './constants';

export const DASHBOARD_ID = 'production-meeting';

/** Logged-in user with the production-meeting dashboard (owners always). isOwner gates the money panel. */
export async function authorize(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid || !auth.userId) return { ok: false, status: 401, error: 'Unauthorized' };
  const access = await getEffectiveAccess(auth.userId);
  if (!access || access.enabled === false) return { ok: false, status: 403, error: 'No access' };
  const isOwner = access.role === 'owner';
  const allowed = isOwner || (access.effectiveDashboards || []).includes(DASHBOARD_ID);
  if (!allowed) return { ok: false, status: 403, error: 'The Production Meeting page is not turned on for this user' };
  return { ok: true, userId: auth.userId, name: access.name, isOwner };
}

export async function lastConfirmedMeeting(sb = getSupabase()) {
  const { data } = await sb.from('production_meetings').select('*').eq('status', 'confirmed').order('meeting_date', { ascending: false }).order('confirmed_at', { ascending: false }).limit(1);
  return data?.[0] || null;
}

export async function meetingTasks(meetingId: string, sb = getSupabase()) {
  if (!meetingId) return [];
  const { data } = await sb.from('production_meeting_tasks').select('*').eq('meeting_id', meetingId);
  return data || [];
}

/** Rebuild the Production Brief from JobTread and save it on the meeting. */
export async function refreshBrief(meeting: any, sb = getSupabase()) {
  const last = await lastConfirmedMeeting(sb);
  const lastTasks = last ? await meetingTasks(last.id, sb) : [];
  const brief = await buildProductionBrief({ lastTasks });
  const { data, error } = await sb.from('production_meetings').update({ brief, brief_at: new Date().toISOString() }).eq('id', meeting.id).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

/** The open draft meeting, created for the next Monday if there is none. */
export async function getOrCreateDraft(userId: string | null, sb = getSupabase()) {
  const { data: drafts } = await sb.from('production_meetings').select('*').eq('status', 'draft').limit(1);
  if (drafts?.[0]) return drafts[0];
  const last = await lastConfirmedMeeting(sb);
  let base = todayEastern();
  if (last?.meeting_date && last.meeting_date >= base) base = addDays(last.meeting_date, 1);
  const { data, error } = await sb.from('production_meetings').insert({ meeting_date: nextMonday(base), status: 'draft', state: {}, created_by: userId }).select('*').single();
  if (error) {
    const { data: again } = await sb.from('production_meetings').select('*').eq('status', 'draft').limit(1);
    if (again?.[0]) return again[0];
    throw new Error(error.message);
  }
  return data;
}

export async function history(sb = getSupabase()) {
  const { data: meetings } = await sb.from('production_meetings').select('id, meeting_date, plus, delta, confirmed_at, confirmed_by').eq('status', 'confirmed').order('meeting_date', { ascending: false }).limit(30);
  const ids = (meetings || []).map((m) => m.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: t } = await sb.from('production_meeting_tasks').select('meeting_id').in('meeting_id', ids);
    for (const r of t || []) counts[r.meeting_id] = (counts[r.meeting_id] || 0) + 1;
  }
  return (meetings || []).map((m) => ({ ...m, tasks: counts[m.id] || 0 }));
}

export async function saveCreatedTasks(meetingId: string, rows: any[], sb = getSupabase()) {
  if (!rows.length) return;
  await sb.from('production_meeting_tasks').upsert(rows.map((r) => ({ ...r, meeting_id: meetingId })), { onConflict: 'jt_task_id', ignoreDuplicates: true });
}

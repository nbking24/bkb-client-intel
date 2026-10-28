// @ts-nocheck
/**
 * Meeting sync: Google Calendar is the only place anyone books a meeting.
 *
 * Every run (cron, every 10 minutes):
 *   1. Read the BKB calendars in config.calendars (now - 2 days to + 120 days).
 *   2. Keep events whose title starts with a trigger word (triggers.ts) or
 *      that Loop's own booking page created (description has the widget link).
 *   3. JobTread (config.jt_enabled): one 📅 task per meeting in the job's
 *      🔵 ACTIVE group, kept in step with the event; done after it ends;
 *      deleted if the event is cancelled before it happens.
 *   4. Loop (config.loop_enabled): each client guest is found or created in
 *      Loop, gets the meeting details in contact fields, and is enrolled in
 *      the workflow for that trigger word with eventStartTime = meeting start.
 *      Moves re-enroll, cancels and removed guests unenroll.
 *   5. Problems go to meeting_sync_events.flags and a once-a-day email.
 *
 * Safety switches live in the meeting_sync_config row (Supabase), so they can
 * be flipped without a deploy. With jt_enabled and loop_enabled both off the
 * run only records what it would do.
 */
import { getSupabase } from '@/app/api/lib/supabase';
import { fetchCalendarEventsRaw } from '@/app/lib/google-api';
import { sendEmail, escapeHtml } from '@/app/api/lib/email';
import { parseTitle, triggerByKey } from './triggers';
import * as jt from './jobtread';
import * as loop from './loop';

const TZ = 'America/New_York';
const BKB_DOMAIN = '@brettkingbuilder.com';
const LOOP_WIDGET = 'go.brettkingbuilder.com/widget';
const BOARD_KEY = '[bkb-board:';

const fmtParts = (iso: string) => {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
const pretty = (iso: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d);
  return `${day} at ${time}`;
};
const firstName = (n: string) => String(n || '').trim().split(/\s+/)[0] || '';
const digits = (s: string) => String(s || '').replace(/\D/g, '');
const normPhone = (s: string) => { const d = digits(s); return d.length === 10 ? `+1${d}` : d.length === 11 && d[0] === '1' ? `+${d}` : ''; };
const phoneFromText = (t: string) => { const m = String(t || '').replace(/<[^>]+>/g, ' ').match(/phone\s*[:#-]?\s*(\+?1?[\s.(-]*\d{3}[\s.)-]*\d{3}[\s.-]*\d{4})/i); return m ? normPhone(m[1]) : ''; };
const splitName = (n: string) => { const parts = String(n || '').trim().split(/\s+/); return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') }; };

function meetLink(e: any) {
  if (e.hangoutLink) return e.hangoutLink;
  const v = (e.conferenceData?.entryPoints || []).find((x: any) => x.entryPointType === 'video');
  return v?.uri || '';
}

function locationText(e: any, typeKey: string | null) {
  const link = meetLink(e);
  const loc = String(e.location || '').trim();
  if (loc && !/^https?:/i.test(loc)) return loc;
  if (link || /^https?:/i.test(loc)) return `Video call: ${link || loc}`;
  if (['info_call', 'discovery_call', 'design_agreement', 'phone_call'].includes(typeKey || '')) return 'Phone call. We will call you at the number we have on file.';
  return 'Details to follow';
}

export async function runMeetingSync(opts: { force?: boolean } = {}) {
  const sb = getSupabase();
  const { data: cfg } = await sb.from('meeting_sync_config').select('*').eq('id', 1).single();
  if (!cfg?.enabled && !opts.force) return { skipped: 'disabled' };

  const now = new Date();
  const summary: any = { calendars: {}, events: 0, tracked: 0, jtCreated: 0, jtUpdated: 0, jtDone: 0, jtDeleted: 0, enrolled: 0, unenrolled: 0, errors: [] as string[] };
  const team = await jt.teamMemberships(cfg.team || {});
  const isInternal = (email: string) => email.endsWith(BKB_DOMAIN) || !!team[email];
  const testList: string[] = (cfg.loop_test_emails || []).map((x: string) => x.toLowerCase());

  let fields = cfg.loop_fields || {};
  if (cfg.loop_enabled) {
    try {
      fields = await loop.ensureMeetingFields(fields);
      if (JSON.stringify(fields) !== JSON.stringify(cfg.loop_fields)) await sb.from('meeting_sync_config').update({ loop_fields: fields }).eq('id', 1);
    } catch (e: any) { summary.errors.push(`Loop fields: ${e.message}`); }
  }

  // 1. read calendars, de-duplicate by iCalUID (first calendar wins)
  const timeMin = new Date(now.getTime() - 2 * 864e5).toISOString();
  const timeMax = new Date(now.getTime() + 120 * 864e5).toISOString();
  const byUid = new Map<string, { e: any; user: string }>();
  for (const user of cfg.calendars || []) {
    try {
      const items = await fetchCalendarEventsRaw({ userId: user, timeMin, timeMax });
      summary.calendars[user] = items.length;
      for (const e of items) {
        const uid = e.iCalUID || e.id;
        const prev = byUid.get(uid);
        if (!prev || (prev.e.status === 'cancelled' && e.status !== 'cancelled')) byUid.set(uid, { e, user });
      }
    } catch (err: any) { summary.errors.push(err.message); }
  }
  // A failed calendar read must not look like "every event was cancelled".
  const readOk = Object.keys(summary.calendars).length === (cfg.calendars || []).length;

  const { data: rows } = await sb.from('meeting_sync_events').select('*').gte('end_at', timeMin);
  const tracked = new Map((rows || []).map((r: any) => [r.ical_uid, r]));

  for (const [uid, { e, user }] of byUid) {
    summary.events++;
    const title = e.summary || '';
    const desc = e.description || '';
    if (desc.includes(BOARD_KEY)) continue;
    const { type, subject } = parseTitle(title);
    const fromLoop = desc.includes(LOOP_WIDGET);
    const row = tracked.get(uid);
    if (!type && !fromLoop && !row) continue;
    summary.tracked++;
    try {
      await syncOne({ sb, cfg, e, uid, user, title, subject, type, fromLoop, row, team, isInternal, testList, fields, now, summary });
    } catch (err: any) {
      summary.errors.push(`${title}: ${err.message}`);
    }
  }

  // Rows whose event vanished from every calendar (deleted outright) count as cancelled.
  if (readOk) {
    for (const r of rows || []) {
      if (byUid.has(r.ical_uid) || r.status === 'cancelled') continue;
      if (new Date(r.start_at) < now) continue;
      try {
        await syncOne({ sb, cfg, e: { status: 'cancelled', start: { dateTime: r.start_at }, end: { dateTime: r.end_at } }, uid: r.ical_uid, user: r.calendar_user, title: r.title, subject: '', type: r.meeting_type ? triggerByKey(r.meeting_type) : null, fromLoop: r.from_loop, row: r, team, isInternal, testList, fields, now, summary });
      } catch (err: any) { summary.errors.push(`${r.title}: ${err.message}`); }
    }
  }

  await sb.from('meeting_sync_config').update({ last_run_at: now.toISOString(), last_run: summary }).eq('id', 1);
  await maybeDigest(sb, cfg, now).catch((e) => summary.errors.push(`digest: ${e.message}`));
  return summary;
}

async function syncOne(ctx: any) {
  const { sb, cfg, e, uid, user, title, subject, type, fromLoop, team, isInternal, testList, fields, now, summary } = ctx;
  let row = ctx.row;
  const cancelled = e.status === 'cancelled';
  const startIso = e.start?.dateTime || (e.start?.date ? `${e.start.date}T09:00:00-05:00` : null);
  const endIso = e.end?.dateTime || startIso;
  if (!startIso) return;
  const log: any[] = [];
  const stamp = () => new Date().toISOString();

  const attendees = (e.attendees || []).filter((a: any) => a.email && !a.resource && a.responseStatus !== 'declined');
  const organizer = String(e.organizer?.email || '').toLowerCase();
  const internal = [...new Set([organizer, ...attendees.map((a: any) => a.email.toLowerCase())].filter((x) => x && isInternal(x) && !testList.includes(x)))];
  const clients = attendees.filter((a: any) => { const m = a.email.toLowerCase(); return testList.includes(m) || !isInternal(m); }).map((a: any) => ({ email: a.email.toLowerCase(), name: a.displayName || '' }));

  const base: any = {
    ical_uid: uid, calendar_user: user, event_id: e.id || row?.event_id || uid, title,
    meeting_type: type?.key || null, start_at: startIso, end_at: endIso,
    location: cancelled ? row?.location : locationText(e, type?.key), status: cancelled ? 'cancelled' : 'active', from_loop: !!fromLoop,
    guests: cancelled ? (row?.guests || []) : clients, updated_at: stamp(),
  };
  if (!row) {
    const ins = await sb.from('meeting_sync_events').upsert({ ...base, created_at: stamp() }).select('*').single();
    row = ins.data || { ...base, enrollments: [], flags: [], log: [] };
  }
  const flags: string[] = [];

  // ---------- job match ----------
  let jobId = row.job_id;
  let jobName = row.job_name;
  if (!jobId && !cancelled) {
    const found = await jt.findJob(subject || title, clients.map((c: any) => c.email));
    if (found.job) { jobId = found.job.id; jobName = `${found.job.name} (${found.job.number})`; log.push({ at: stamp(), msg: `Matched job ${jobName}` }); }
    else flags.push(found.reason);
  }
  const contacts = jobId ? await jt.jobContacts(jobId).catch(() => []) : [];

  // ---------- JobTread task ----------
  let taskId = row.jt_task_id;
  let taskDone = row.jt_task_done;
  let taskSig = row.task_sig || null;
  if (cfg.jt_enabled && jobId) {
    const s = fmtParts(startIso);
    const en = fmtParts(endIso);
    const shape = {
      name: `📅 ${title}`,
      description: [
        `${type ? type.label : 'Meeting'} on ${pretty(startIso)}`,
        `Where: ${base.location}`,
        clients.length ? `Clients: ${clients.map((c: any) => c.name || c.email).join(', ')}` : '',
        internal.length ? `BKB: ${internal.map((m) => team[m]?.name || m).join(', ')}` : '',
        '',
        'Synced from Google Calendar. Change or cancel the calendar event, not this task.',
      ].filter((x) => x !== '').join('\n'),
      date: s.date, startTime: s.time, endTime: en.date === s.date ? en.time : '23:59',
      membershipIds: internal.map((m) => team[m]?.id).filter(Boolean),
    };
    const sig = JSON.stringify(shape);
    if (taskId && taskId !== 'removed') {
      const st = await jt.taskState(taskId);
      if (!st.exists) { log.push({ at: stamp(), msg: 'Task was deleted in JobTread; not recreating' }); taskId = 'removed'; }
      else if (cancelled) {
        if (!st.done) { await jt.deleteTask(taskId); summary.jtDeleted++; log.push({ at: stamp(), msg: 'Event cancelled; task deleted' }); taskId = null; }
      } else {
        if (row.task_sig !== sig && !st.done) { await jt.updateMeetingTask(taskId, shape); summary.jtUpdated++; log.push({ at: stamp(), msg: 'Task updated' }); }
        taskSig = sig;
        if (!st.done && new Date(endIso) < now) { await jt.completeTask(taskId); summary.jtDone++; log.push({ at: stamp(), msg: 'Meeting over; task completed' }); taskDone = true; }
        if (st.done) taskDone = true;
      }
    } else if (!taskId && !cancelled) {
      const existing = await jt.openMeetingTasksOn(jobId, s.date).catch(() => []);
      if (existing.length === 1) {
        taskId = existing[0].id;
        await jt.updateMeetingTask(taskId, shape);
        log.push({ at: stamp(), msg: `Adopted hand-entered task "${existing[0].name}"` });
        summary.jtUpdated++;
      } else {
        taskId = await jt.createMeetingTask(jobId, shape);
        summary.jtCreated++;
        log.push({ at: stamp(), msg: 'Task created' });
      }
      taskSig = sig;
      if (new Date(endIso) < now) { await jt.completeTask(taskId); taskDone = true; }
    }
  }

  // ---------- Loop reminders ----------
  let enrollments: any[] = Array.isArray(row.enrollments) ? [...row.enrollments] : [];
  const wfId = type ? (cfg.workflow_map?.[type.key] || (!type.sales ? cfg.workflow_map?.standard : null)) : null;
  const createdOk = !cfg.enroll_created_after || (e.created && new Date(e.created) >= new Date(cfg.enroll_created_after)) || enrollments.length > 0;
  const wantLoop = cfg.loop_enabled && !fromLoop && !cancelled && !!wfId && createdOk && new Date(startIso).getTime() > now.getTime() + 5 * 60e3;

  if (type?.sales && !cancelled && !clients.length) flags.push('No client is invited to this meeting, so no confirmation or reminders go out. Add the client as a guest.');
  if (type && !cancelled && !wfId && cfg.loop_enabled) flags.push(`No Loop workflow is set up for "${type.label}" yet.`);

  if (cfg.loop_enabled) {
    const keep: any[] = [];
    for (const en of enrollments) {
      const still = wantLoop && clients.some((c: any) => c.email === en.email) && en.workflowId === wfId && en.startAt === startIso;
      if (still) { keep.push(en); continue; }
      try { await loop.unenroll(en.contactId, en.workflowId); summary.unenrolled++; log.push({ at: stamp(), msg: `Removed ${en.email} from reminders (${cancelled ? 'cancelled' : 'changed'})` }); }
      catch (err: any) { log.push({ at: stamp(), msg: `Unenroll ${en.email} failed: ${err.message}` }); }
    }
    enrollments = keep;

    if (wantLoop) {
      const withNames = internal.map((m) => firstName(team[m]?.name || '')).filter(Boolean);
      for (const c of clients) {
        if (testList.length && !testList.includes(c.email)) continue;
        if (enrollments.some((en) => en.email === c.email)) continue;
        try {
          const jtc = contacts.find((x: any) => x.email === c.email);
          const phone = normPhone(jtc?.phone || '') || phoneFromText(e.description) || '';
          let contact = await loop.findContactByEmail(c.email);
          if (!contact && phone) contact = await loop.findContactByPhone(phone);
          if (!contact) {
            const nm = splitName(jtc?.name || c.name || c.email.split('@')[0]);
            contact = await loop.createContact({ ...nm, email: c.email, ...(phone ? { phone } : {}) });
            log.push({ at: stamp(), msg: `Created Loop contact for ${c.email}` });
          }
          const custom = [
            ['Meeting Title', title], ['Meeting Time', pretty(startIso)], ['Meeting Location', base.location],
            ['Meeting With', withNames.join(' and ') || 'the BKB team'],
          ].filter(([n]) => fields[n]?.id).map(([n, v]) => ({ id: fields[n].id, field_value: v }));
          await loop.updateContact(contact.id, { customFields: custom, ...(!contact.phone && phone ? { phone } : {}) });
          if (!contact.phone && !phone) flags.push(`No phone number for ${c.name || c.email}, so text reminders will not send. Add it to their JobTread contact.`);
          await loop.enroll(contact.id, wfId, startIso);
          enrollments.push({ email: c.email, contactId: contact.id, workflowId: wfId, startAt: startIso, at: stamp() });
          summary.enrolled++;
          log.push({ at: stamp(), msg: `Enrolled ${c.email} in ${type.label} reminders` });
        } catch (err: any) {
          flags.push(`Could not start reminders for ${c.email}: ${err.message}`);
        }
      }
    }
  }

  await sb.from('meeting_sync_events').update({
    ...base, job_id: jobId || null, job_name: jobName || null, jt_task_id: taskId || null, jt_task_done: !!taskDone, task_sig: taskSig,
    enrollments, flags: cancelled ? [] : flags, log: [...(row.log || []), ...log].slice(-40),
  }).eq('ical_uid', uid);
}

/** Once a day after 7 am Eastern: one email listing upcoming meetings with open problems. */
async function maybeDigest(sb: any, cfg: any, now: Date) {
  const today = fmtParts(now.toISOString()).date;
  const hour = Number(fmtParts(now.toISOString()).time.slice(0, 2));
  if (hour < 7 || cfg.last_digest_on === today || !(cfg.notify_emails || []).length) return;
  const until = new Date(now.getTime() + 21 * 864e5).toISOString();
  const { data } = await sb.from('meeting_sync_events').select('title,start_at,flags,job_name').eq('status', 'active').gte('start_at', now.toISOString()).lte('start_at', until).order('start_at');
  const bad = (data || []).filter((r: any) => (r.flags || []).length);
  await sb.from('meeting_sync_config').update({ last_digest_on: today }).eq('id', 1);
  if (!bad.length) return;
  const items = bad.map((r: any) => `<li><b>${escapeHtml(r.title)}</b> (${escapeHtml(pretty(r.start_at))})<ul>${r.flags.map((f: string) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></li>`).join('');
  await sendEmail({
    to: cfg.notify_emails,
    subject: `Meetings that need a fix (${bad.length})`,
    html: `<p>These upcoming meetings in Google Calendar need a quick fix so they reach JobTread and the client gets their reminders.</p><ul>${items}</ul><p>Fix the calendar event or the JobTread contact. The Hub checks again every 10 minutes.</p>`,
  });
}

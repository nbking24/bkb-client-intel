// @ts-nocheck
/**
 * GET /api/dashboard/leads/needs-attention
 *
 * Single endpoint powering the new "Needs Your Attention" zone at the top
 * of the Leads dashboard. Returns three buckets so Nathan can see at a
 * glance what needs action, what's booked, and what's silently rotting.
 *
 * Buckets:
 *   newUncontacted: active-stage leads with NO scheduled appointment AND
 *                   no outbound message in the last 48 hours. Includes
 *                   how many hours old the lead is. These are the leads
 *                   currently slipping through the cracks.
 *   upcoming:       chronological list of every scheduled call/meeting
 *                   for active leads in the next N days (default 14).
 *   stale:          active-stage leads with no scheduled appointment AND
 *                   no outbound contact in the last 7 days AND the lead
 *                   itself is more than 7 days old.
 *
 * Each row also carries a `nextStep` string the leads dashboard can render
 * on the row directly so you don't have to click in to know status.
 *
 * Active-stage definition matches the existing leads page: New Inquiry,
 * Initial Call Scheduled, Discovery Scheduled, No Show, Nurture,
 * Estimating, In Design.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '@/app/api/lib/auth';
import { getSupabase } from '@/app/api/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_KEY = () => process.env.GHL_API_KEY || '';
const GHL_LOC = () => process.env.GHL_LOCATION_ID || '';

function ghlHeaders() {
  return {
    Authorization: `Bearer ${GHL_KEY()}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

async function ghlGet(path: string) {
  const res = await fetch(`${GHL_BASE}${path}`, { headers: ghlHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`GHL GET ${path} ${res.status}`);
  return res.json();
}

async function ghlPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GHL POST ${path} ${res.status}`);
  return res.json();
}

const ACTIVE_STAGE_NAMES = new Set([
  'New Inquiry',
  'Initial Call Scheduled',
  'Discovery Scheduled',
  'No Show',
  'Nurture',
  'Estimating',
  'In Design',
]);

async function fetchAllActiveOpportunities(): Promise<any[]> {
  const all: any[] = [];
  let startAfterId = '';
  for (let page = 0; page < 8; page++) {
    const body: Record<string, unknown> = { locationId: GHL_LOC(), limit: 100 };
    if (startAfterId) body.startAfterId = startAfterId;
    const data = await ghlPost('/opportunities/search', body);
    const opps = data.opportunities || [];
    all.push(...opps);
    if (opps.length < 100) break;
    startAfterId = opps[opps.length - 1].id;
  }
  return all;
}

async function fetchContactAppointments(contactId: string): Promise<any[]> {
  try {
    const data = await ghlGet(`/contacts/${contactId}/appointments`);
    return (data.events || []).filter((ev: any) => !ev.deleted);
  } catch {
    return [];
  }
}

function classifyAppointment(title: string): 'discovery' | 'onsite' | 'design' | 'followup' | 'meeting' {
  const t = (title || '').toLowerCase();
  if (/discovery|intro|initial/.test(t)) return 'discovery';
  if (/onsite|on-site|site visit|home visit|walkthrough/.test(t)) return 'onsite';
  if (/design|selection|spec/.test(t)) return 'design';
  if (/follow[\s-]*up|callback|catch[\s-]*up/.test(t)) return 'followup';
  return 'meeting';
}

function formatWhen(d: Date): string {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  if (isTomorrow) return `Tomorrow ${time}`;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + time;
}

function hoursBetween(later: Date | number, earlier: Date | number): number {
  return Math.floor((Number(later) - Number(earlier)) / 3600_000);
}

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const upcomingDays = 14;
  const newWindowHours = 48;          // window for "recent outbound counts as contacted"
  const staleDays = 7;                // > 7d no touch + no appt = stale
  const now = Date.now();
  const upcomingHorizon = now + upcomingDays * 86400_000;
  const newWindowMs = newWindowHours * 3600_000;
  const staleWindowMs = staleDays * 86400_000;

  // 1) Pull active opportunities from Loop.
  let opportunities: any[] = [];
  try {
    opportunities = await fetchAllActiveOpportunities();
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load opportunities: ' + err.message }, { status: 502 });
  }
  const activeOpps = opportunities.filter((o: any) => {
    const stage = (o.pipelineStageName || o.stageName || '').trim();
    return ACTIVE_STAGE_NAMES.has(stage) && (o.contactId || o.contact?.id);
  });

  // 2) Dedup to one primary opportunity per contact (most-recent createdAt).
  const contactIdToOpps = new Map<string, any[]>();
  for (const o of activeOpps) {
    const cid = o.contactId || o.contact?.id;
    if (!contactIdToOpps.has(cid)) contactIdToOpps.set(cid, []);
    contactIdToOpps.get(cid)!.push(o);
  }
  const primaryByContact = new Map<string, any>();
  for (const [cid, opps] of contactIdToOpps.entries()) {
    const primary = opps.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    )[0];
    primaryByContact.set(cid, primary);
  }
  const contactIds = Array.from(primaryByContact.keys());

  // 3) Bulk-pull last outbound message timestamp per contact from our
  //    ghl_messages mirror. Cheap one-shot query; covers the "did we
  //    reply/message them recently?" check.
  const sb = getSupabase();
  const lastOutboundByContact = new Map<string, number>();
  if (contactIds.length > 0) {
    const { data } = await sb
      .from('ghl_messages')
      .select('contact_id, raw_data, direction')
      .in('contact_id', contactIds);
    for (const row of (data || []) as any[]) {
      if ((row.direction || '').toLowerCase() !== 'outbound') continue;
      const ts = row.raw_data?.dateAdded || row.raw_data?.dateUpdated || row.raw_data?.dateCreated;
      if (!ts) continue;
      const t = new Date(ts).getTime();
      if (!Number.isFinite(t)) continue;
      const prev = lastOutboundByContact.get(row.contact_id) || 0;
      if (t > prev) lastOutboundByContact.set(row.contact_id, t);
    }
  }

  // 4) Fan-out: appointments per contact. Bounded concurrency so we don't
  //    hammer GHL.
  const apptsByContact = new Map<string, any[]>();
  const BATCH = 8;
  for (let i = 0; i < contactIds.length; i += BATCH) {
    const chunk = contactIds.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map(async (cid) => ({ cid, appts: await fetchContactAppointments(cid) })),
    );
    for (const { cid, appts } of results) apptsByContact.set(cid, appts);
  }

  // 5) Classify into buckets. For every contact we also compute a `nextStep`
  //    label the dashboard can render on the row.
  const newUncontacted: any[] = [];
  const upcoming: any[] = [];
  const stale: any[] = [];
  const nextStepByContact: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' }> = {};

  for (const cid of contactIds) {
    const opp = primaryByContact.get(cid);
    const contact = opp.contact || {};
    const name =
      contact.name ||
      [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
      opp.name ||
      'Unknown contact';
    const stage = (opp.pipelineStageName || opp.stageName || '').trim();
    const oppCreatedAt = new Date(opp.createdAt || 0).getTime();
    const leadAgeHours = Number.isFinite(oppCreatedAt) ? hoursBetween(now, oppCreatedAt) : null;

    // Next future appointment in the upcoming horizon.
    const allAppts = (apptsByContact.get(cid) || [])
      .map((ap: any) => ({ ap, t: new Date(ap.startTime).getTime() }))
      .filter((x) => Number.isFinite(x.t) && x.t > now - 60 * 60 * 1000)
      .sort((a, b) => a.t - b.t);
    const nextAppt = allAppts[0];

    const lastOutboundT = lastOutboundByContact.get(cid) || 0;
    const recentOutbound = lastOutboundT > now - newWindowMs;
    const lastTouchT = Math.max(lastOutboundT, oppCreatedAt || 0);

    // Build nextStep label for the row.
    if (nextAppt) {
      const d = new Date(nextAppt.t);
      const kind = classifyAppointment(nextAppt.ap.title || '');
      const kindLabel = kind === 'discovery' ? 'Discovery call'
        : kind === 'onsite' ? 'Onsite visit'
        : kind === 'design' ? 'Design meeting'
        : kind === 'followup' ? 'Follow-up'
        : 'Meeting';
      nextStepByContact[cid] = { label: `${kindLabel} ${formatWhen(d)}`, tone: 'good' };
    } else if (recentOutbound) {
      const lastT = new Date(lastOutboundT);
      const ageH = hoursBetween(now, lastOutboundT);
      nextStepByContact[cid] = { label: `Awaiting reply (last sent ${ageH}h ago)`, tone: 'warn' };
    } else if (leadAgeHours !== null && leadAgeHours <= newWindowHours) {
      nextStepByContact[cid] = { label: `Needs first touch (lead is ${leadAgeHours}h old)`, tone: 'bad' };
    } else {
      const days = Math.floor((now - lastTouchT) / 86400_000);
      nextStepByContact[cid] = { label: `No next step (last touch ${days}d ago)`, tone: 'bad' };
    }

    // Build a base row object shared by all three buckets.
    const base = {
      contactId: cid,
      contactName: name,
      phone: contact.phone || '',
      email: contact.email || '',
      opportunityId: opp.id,
      opportunityName: opp.name || '',
      stage,
      leadCreatedAt: opp.createdAt || null,
      leadAgeHours,
      lastOutboundAt: lastOutboundT ? new Date(lastOutboundT).toISOString() : null,
      hoursSinceLastOutbound: lastOutboundT ? hoursBetween(now, lastOutboundT) : null,
    };

    // Bucket: upcoming.
    if (nextAppt && nextAppt.t <= upcomingHorizon) {
      upcoming.push({
        ...base,
        appointment: {
          id: nextAppt.ap.id,
          title: nextAppt.ap.title || '',
          kind: classifyAppointment(nextAppt.ap.title || ''),
          startTime: nextAppt.ap.startTime,
          endTime: nextAppt.ap.endTime || null,
          status: nextAppt.ap.appointmentStatus || nextAppt.ap.status || '',
          calendarName: nextAppt.ap.calendarName || null,
          location: nextAppt.ap.address || nextAppt.ap.location || '',
          notes: nextAppt.ap.notes || '',
          whenLabel: formatWhen(new Date(nextAppt.t)),
        },
      });
      continue;
    }

    // Bucket: new + uncontacted.
    // Conditions: no appointment, no outbound in last 48h, AND either the lead
    // is young (< 7d) OR the stage is "New Inquiry" / "No Show" (states where
    // first touch should have happened already).
    const isNewish = leadAgeHours !== null && leadAgeHours <= staleDays * 24;
    const firstTouchStage = stage === 'New Inquiry' || stage === 'No Show';
    if (!nextAppt && !recentOutbound && (isNewish || firstTouchStage)) {
      newUncontacted.push(base);
      continue;
    }

    // Bucket: stale.
    // Conditions: no appointment, no outbound in last 7d, lead older than 7d,
    // not already classified as "needs first touch".
    if (!nextAppt && now - lastTouchT > staleWindowMs) {
      stale.push({ ...base, daysSinceLastTouch: Math.floor((now - lastTouchT) / 86400_000) });
    }
  }

  // Sort each bucket so the most urgent item floats to the top.
  newUncontacted.sort(
    (a, b) => (b.leadAgeHours ?? 0) - (a.leadAgeHours ?? 0), // oldest first (longest waiting)
  );
  upcoming.sort(
    (a, b) => new Date(a.appointment.startTime).getTime() - new Date(b.appointment.startTime).getTime(),
  );
  stale.sort((a, b) => (b.daysSinceLastTouch ?? 0) - (a.daysSinceLastTouch ?? 0));

  return NextResponse.json({
    newUncontacted,
    upcoming,
    stale,
    nextStepByContact,
    counts: {
      newUncontacted: newUncontacted.length,
      upcoming: upcoming.length,
      stale: stale.length,
      totalActive: contactIds.length,
    },
    generatedAt: new Date().toISOString(),
  });
}

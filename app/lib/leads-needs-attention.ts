// @ts-nocheck
/**
 * Shared bucketing logic for the "Needs Your Attention" zone.
 *
 * Used by:
 *   - /api/dashboard/leads/needs-attention (dashboard render)
 *   - /api/cron/uncontacted-lead-alerts (email Terri on new uncontacted leads)
 *
 * Keeping the logic here means both surfaces classify the same way; the cron
 * and the dashboard cannot drift.
 */
import { getSupabase } from '../api/lib/supabase';

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

export const ACTIVE_STAGE_NAMES = new Set([
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

export interface NeedsAttentionResult {
  newUncontacted: any[];
  upcoming: any[];
  stale: any[];
  nextStepByContact: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' }>;
  counts: { newUncontacted: number; upcoming: number; stale: number; totalActive: number };
  generatedAt: string;
}

export async function computeLeadsNeedsAttention(opts?: {
  upcomingDays?: number;
  newWindowHours?: number;
  staleDays?: number;
}): Promise<NeedsAttentionResult> {
  const upcomingDays = opts?.upcomingDays ?? 14;
  const newWindowHours = opts?.newWindowHours ?? 48;
  const staleDays = opts?.staleDays ?? 7;
  const now = Date.now();
  const upcomingHorizon = now + upcomingDays * 86400_000;
  const newWindowMs = newWindowHours * 3600_000;
  const staleWindowMs = staleDays * 86400_000;

  const opportunities = await fetchAllActiveOpportunities();
  const activeOpps = opportunities.filter((o: any) => {
    const stage = (o.pipelineStageName || o.stageName || '').trim();
    return ACTIVE_STAGE_NAMES.has(stage) && (o.contactId || o.contact?.id);
  });

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

  const apptsByContact = new Map<string, any[]>();
  const BATCH = 8;
  for (let i = 0; i < contactIds.length; i += BATCH) {
    const chunk = contactIds.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map(async (cid) => ({ cid, appts: await fetchContactAppointments(cid) })),
    );
    for (const { cid, appts } of results) apptsByContact.set(cid, appts);
  }

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
    const allAppts = (apptsByContact.get(cid) || [])
      .map((ap: any) => ({ ap, t: new Date(ap.startTime).getTime() }))
      .filter((x) => Number.isFinite(x.t) && x.t > now - 60 * 60 * 1000)
      .sort((a, b) => a.t - b.t);
    const nextAppt = allAppts[0];
    const lastOutboundT = lastOutboundByContact.get(cid) || 0;
    const recentOutbound = lastOutboundT > now - newWindowMs;
    const lastTouchT = Math.max(lastOutboundT, oppCreatedAt || 0);

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
      const ageH = hoursBetween(now, lastOutboundT);
      nextStepByContact[cid] = { label: `Awaiting reply (last sent ${ageH}h ago)`, tone: 'warn' };
    } else if (leadAgeHours !== null && leadAgeHours <= newWindowHours) {
      nextStepByContact[cid] = { label: `Needs first touch (lead is ${leadAgeHours}h old)`, tone: 'bad' };
    } else {
      const days = Math.floor((now - lastTouchT) / 86400_000);
      nextStepByContact[cid] = { label: `No next step (last touch ${days}d ago)`, tone: 'bad' };
    }

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

    const isNewish = leadAgeHours !== null && leadAgeHours <= staleDays * 24;
    const firstTouchStage = stage === 'New Inquiry' || stage === 'No Show';
    if (!nextAppt && !recentOutbound && (isNewish || firstTouchStage)) {
      newUncontacted.push(base);
      continue;
    }

    if (!nextAppt && now - lastTouchT > staleWindowMs) {
      stale.push({ ...base, daysSinceLastTouch: Math.floor((now - lastTouchT) / 86400_000) });
    }
  }

  newUncontacted.sort((a, b) => (b.leadAgeHours ?? 0) - (a.leadAgeHours ?? 0));
  upcoming.sort(
    (a, b) => new Date(a.appointment.startTime).getTime() - new Date(b.appointment.startTime).getTime(),
  );
  stale.sort((a, b) => (b.daysSinceLastTouch ?? 0) - (a.daysSinceLastTouch ?? 0));

  return {
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
  };
}

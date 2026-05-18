// @ts-nocheck
/**
 * GET /api/dashboard/loop-audit
 *
 * One-shot audit endpoint for Nathan's review of Loop/GHL automations.
 * Clients have been reporting too many notifications before meetings;
 * this dumps every signal we can pull via API so we can identify
 * exactly which automations fire pre-meeting and where the noise is
 * coming from. Reads only — no mutations.
 *
 * Returns:
 *   - calendars:    every calendar with its notifications array
 *                   (notification type, channel, timing, template id)
 *   - workflows:    every workflow with basic metadata (name, status,
 *                   trigger if exposed by the API)
 *   - campaigns:    legacy "Campaign" objects if any are still active
 *
 * Anything that requires the GHL workflow-builder UI (step-by-step
 * automation actions, template content) is NOT in this audit and
 * needs a Chrome session.
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_KEY = () => process.env.GHL_API_KEY || '';
const GHL_LOC = () => process.env.GHL_LOCATION_ID || '';

function headers() {
  return {
    Authorization: `Bearer ${GHL_KEY()}`,
    'Content-Type': 'application/json',
    Version: '2021-04-15',
  };
}

async function tryGet(path: string): Promise<any> {
  try {
    const res = await fetch(`${GHL_BASE}${path}`, { headers: headers(), cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { _error: `${res.status} ${res.statusText}`, _body: text.slice(0, 400) };
    }
    return await res.json();
  } catch (err: any) {
    return { _error: err?.message || String(err) };
  }
}

export async function GET() {
  const locationId = GHL_LOC();

  // 1. List calendars
  const calList = await tryGet(`/calendars/?locationId=${locationId}`);
  const calendars: any[] = Array.isArray(calList?.calendars) ? calList.calendars : [];

  // 2. For each calendar, pull its detail (which includes the
  //    `notifications` array — that's where pre-meeting reminders live).
  const detailedCalendars = await Promise.all(
    calendars.map(async (c: any) => {
      const d = await tryGet(`/calendars/${c.id}`);
      const cal = d?.calendar || d || {};
      // Normalize: strip any per-step content/template HTML so the
      // payload stays digestible. Keep the metadata that matters for
      // a notification audit.
      const notes = Array.isArray(cal.notifications) ? cal.notifications : [];
      return {
        id: c.id,
        name: c.name || cal.name || '',
        slug: cal.slug || null,
        widgetSlug: cal.widgetSlug || null,
        isActive: cal.isActive ?? null,
        appointmentTitle: cal.appointmentTitle || null,
        // Notification config — the meaty part for this audit.
        notifications: notes.map((n: any) => ({
          type: n.type || null,                  // e.g. 'confirmation' | 'reminder' | 'cancellation' | 'reschedule'
          channel: n.channel || null,            // e.g. 'email' | 'sms' | 'both'
          notificationType: n.notificationType || null,
          beforeTime: n.beforeTime ?? null,      // numeric value
          beforeUnit: n.beforeUnit ?? null,      // e.g. 'mins' | 'hours' | 'days'
          selectedNotifications: n.selectedNotifications || null,
          receiverType: n.receiverType || null,
          additionalEmailIds: n.additionalEmailIds || null,
          subject: n.subject || null,
          fromAddress: n.fromAddress || null,
          fromName: n.fromName || null,
          isPlivoSms: n.isPlivoSms ?? null,
          deleted: n.deleted ?? null,
        })),
        teamMemberCount: (cal.teamMembers || []).length,
      };
    })
  );

  // 3. Workflows. GHL's public workflows endpoint lists workflows but
  //    doesn't expose the action steps. Useful here as a name+status
  //    inventory — we'll have to open suspicious ones in the Loop UI
  //    to see what they actually send.
  const wfList = await tryGet(`/workflows/?locationId=${locationId}`);
  const workflows = Array.isArray(wfList?.workflows)
    ? wfList.workflows.map((w: any) => ({
        id: w.id,
        name: w.name,
        status: w.status,
        version: w.version || null,
        createdAt: w.createdAt || null,
        updatedAt: w.updatedAt || null,
      }))
    : { _error: wfList?._error || 'workflows endpoint not available', _raw: wfList };

  // 4. Campaigns (legacy GHL email/SMS sequences — separate from workflows)
  const campList = await tryGet(`/campaigns/?locationId=${locationId}&status=published`);
  const campaigns = Array.isArray(campList?.campaigns)
    ? campList.campaigns.map((c: any) => ({
        id: c.id,
        name: c.name,
        status: c.status,
      }))
    : { _error: campList?._error || 'campaigns endpoint not available', _raw: campList };

  return NextResponse.json({
    locationId,
    auditedAt: new Date().toISOString(),
    summary: {
      calendarCount: detailedCalendars.length,
      calendarsWithNotifications: detailedCalendars.filter((c) => (c.notifications || []).length > 0).length,
      totalNotifications: detailedCalendars.reduce(
        (acc, c) => acc + (c.notifications || []).filter((n: any) => !n.deleted).length,
        0
      ),
      workflowCount: Array.isArray(workflows) ? workflows.length : 0,
      campaignCount: Array.isArray(campaigns) ? campaigns.length : 0,
    },
    calendars: detailedCalendars,
    workflows,
    campaigns,
  });
}

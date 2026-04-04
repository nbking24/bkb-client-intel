// @ts-nocheck
import { NextResponse } from 'next/server';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_KEY = () => process.env.GHL_API_KEY || '';
const GHL_LOC = () => process.env.GHL_LOCATION_ID || '';

const STAGES: Record<string, string> = {
  'da27d864-0a12-4f4b-9290-21d59a0f9f6f': 'New Inquiry',
  '3e720576-99cc-4e94-baa1-0d82e28b265d': 'Initial Call Scheduled',
  '25c69200-e006-4a7f-b949-687a66d019a7': 'Discovery Scheduled',
  'ae9b3d90-5264-4f38-9e96-85a537d5c035': 'No Show',
  'df802d7c-8a49-4e82-b9c1-2ad9d3dd1b80': 'Nurture',
  'c4012dfe-bc76-4447-8947-96a9e846ff2b': 'Estimating',
  '73fd2284-6b5f-4b24-9c10-cd8bca259552': 'In Design',
  '4d8a8bf2-0044-4c76-ae8b-2c71b0f47598': 'Ready',
  '787aa694-fac7-4ce6-ad93-2c9cf7a2e20d': 'In Production',
  'b00dfbb4-2440-451b-9975-17246d535ab3': 'Final Billing',
  '3d4bde41-7ee1-4ca0-ba2d-f4a6bc80238c': 'Completed',
  '84984d39-705e-406a-91ae-fcf2e98b4a03': 'Closed Not Interested',
  'b85ba5c6-8ee6-419f-9ff7-a08a9106e58e': 'On Hold',
};

// Front-of-pipeline stages (leads actively being worked)
const LEAD_STAGES = [
  'New Inquiry',
  'Initial Call Scheduled',
  'Discovery Scheduled',
  'No Show',
  'Nurture',
  'Estimating',
];

// "Secured" = moved past estimating into active project work
const SECURED_STAGES = ['In Design', 'Ready', 'In Production', 'Final Billing', 'Completed'];

const DISCOVERY_CAL = 'XAmFYzHwTcxmDRUrJSgJ';
const ONSITE_CAL = 'DeoYiZ8TjDVoW6bFraUN';

function ghlHeaders() {
  return {
    Authorization: `Bearer ${GHL_KEY()}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };
}

async function ghlGet(path: string) {
  const res = await fetch(`${GHL_BASE}${path}`, { headers: ghlHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`GHL ${res.status}`);
  return res.json();
}

export async function GET() {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Fetch all opportunities (all statuses)
    const oppData = await ghlGet(
      `/opportunities/search?location_id=${GHL_LOC()}&status=all&limit=100`
    );
    const opps = oppData.opportunities || [];

    // Fetch calendar events (last 90 days)
    const startMs = ninetyDaysAgo.getTime();
    const endMs = now.getTime();
    const [discoveryData, onsiteData] = await Promise.all([
      ghlGet(`/calendars/events?locationId=${GHL_LOC()}&calendarId=${DISCOVERY_CAL}&startTime=${startMs}&endTime=${endMs}`),
      ghlGet(`/calendars/events?locationId=${GHL_LOC()}&calendarId=${ONSITE_CAL}&startTime=${startMs}&endTime=${endMs}`),
    ]);
    const discoveryEvents = discoveryData.events || [];
    const onsiteEvents = onsiteData.events || [];

    // ── Pipeline breakdown (open only) ──
    const openOpps = opps.filter((o: any) => o.status === 'open');
    const pipelineBreakdown: { stage: string; count: number; stageId: string }[] = [];
    for (const [stageId, stageName] of Object.entries(STAGES)) {
      const count = openOpps.filter((o: any) => o.pipelineStageId === stageId).length;
      if (count > 0) {
        pipelineBreakdown.push({ stage: stageName, count, stageId });
      }
    }

    // ── KPI calculations ──

    // Total active leads (front-of-pipeline open opps)
    const activeLeads = openOpps.filter((o: any) => {
      const name = STAGES[o.pipelineStageId] || '';
      return LEAD_STAGES.includes(name);
    }).length;

    // New leads this week
    const newLeadsThisWeek = opps.filter((o: any) => {
      const created = new Date(o.createdAt);
      return created >= sevenDaysAgo;
    }).length;

    // New leads this month
    const newLeadsThisMonth = opps.filter((o: any) => {
      const created = new Date(o.createdAt);
      return created >= thirtyDaysAgo;
    }).length;

    // Secured clients (In Design or beyond, open)
    const securedClients = openOpps.filter((o: any) => {
      const name = STAGES[o.pipelineStageId] || '';
      return SECURED_STAGES.includes(name);
    }).length;

    // Meetings scheduled (on-site visits total, last 90 days)
    const onsiteCount = onsiteEvents.length;
    const discoveryCount = discoveryEvents.length;

    // Conversion rate: leads that made it to In Design+ out of all leads
    // (including lost/abandoned)
    const allLeadCount = opps.length;
    const everSecured = opps.filter((o: any) => {
      const name = STAGES[o.pipelineStageId] || '';
      return SECURED_STAGES.includes(name);
    }).length;
    const conversionRate = allLeadCount > 0 ? Math.round((everSecured / allLeadCount) * 100) : 0;

    // ── Funnel data (for chart) ──
    // Shows how leads flow: Total Leads → Discovery/On-Site → Estimating → Secured
    const inEstimating = openOpps.filter((o: any) => o.pipelineStageId === 'c4012dfe-bc76-4447-8947-96a9e846ff2b').length;
    const funnel = [
      { label: 'Total Leads', value: allLeadCount },
      { label: 'Discovery Calls', value: discoveryCount },
      { label: 'On-Site Visits', value: onsiteCount },
      { label: 'Estimating', value: inEstimating },
      { label: 'Secured (In Design+)', value: everSecured },
    ];

    // ── Monthly lead creation trend (last 6 months) ──
    const monthlyTrend: { month: string; leads: number; secured: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      const leadsInMonth = opps.filter((o: any) => {
        const created = new Date(o.createdAt);
        return created >= d && created <= monthEnd;
      }).length;
      // Secured = moved to In Design+ during that month (use lastStageChangeAt)
      const securedInMonth = opps.filter((o: any) => {
        const name = STAGES[o.pipelineStageId] || '';
        if (!SECURED_STAGES.includes(name)) return false;
        const changed = new Date(o.lastStageChangeAt || o.createdAt);
        return changed >= d && changed <= monthEnd;
      }).length;
      monthlyTrend.push({ month: monthLabel, leads: leadsInMonth, secured: securedInMonth });
    }

    // ── Recent leads (last 10 created) ──
    const recentLeads = [...opps]
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)
      .map((o: any) => ({
        id: o.id,
        name: o.name,
        stage: STAGES[o.pipelineStageId] || 'Unknown',
        status: o.status,
        createdAt: o.createdAt,
        contactName: o.contact ? `${o.contact.name || ''}`.trim() : '',
      }));

    // ── Pending New Leads (New Inquiry stage, open, with full contact details) ──
    const NEW_INQUIRY_ID = 'da27d864-0a12-4f4b-9290-21d59a0f9f6f';
    const pendingNewLeads = opps
      .filter((o: any) => o.pipelineStageId === NEW_INQUIRY_ID && o.status === 'open')
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((o: any) => ({
        id: o.id,
        name: o.name,
        contactId: o.contact?.id || '',
        contactName: o.contact?.name || o.contact?.firstName
          ? `${o.contact?.firstName || ''} ${o.contact?.lastName || ''}`.trim()
          : '',
        phone: o.contact?.phone || '',
        email: o.contact?.email || '',
        source: o.source || '',
        tags: o.contact?.tags || [],
        createdAt: o.createdAt,
        daysPending: Math.floor((now.getTime() - new Date(o.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
      }));

    return NextResponse.json({
      kpis: {
        newLeadsThisWeek,
        newLeadsThisMonth,
        activeLeads,
        securedClients,
        onsiteVisits: onsiteCount,
        discoveryCalls: discoveryCount,
        conversionRate,
        totalPipeline: openOpps.length,
      },
      pipelineBreakdown,
      funnel,
      monthlyTrend,
      recentLeads,
      pendingNewLeads,
    });
  } catch (err: any) {
    console.error('Leads KPI error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load KPIs' }, { status: 500 });
  }
}

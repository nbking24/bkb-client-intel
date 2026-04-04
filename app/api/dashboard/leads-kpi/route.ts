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

const LEAD_STAGES = [
  'New Inquiry', 'Initial Call Scheduled', 'Discovery Scheduled',
  'No Show', 'Nurture', 'Estimating',
];
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

/**
 * Fetch ALL opportunities with pagination (GHL caps at 100 per page).
 */
async function fetchAllOpportunities(): Promise<any[]> {
  const allOpps: any[] = [];
  let startAfterId = '';
  let page = 0;
  const MAX_PAGES = 10; // safety cap: 10 pages × 100 = 1000 opps max

  while (page < MAX_PAGES) {
    let url = `/opportunities/search?location_id=${GHL_LOC()}&status=all&limit=100`;
    if (startAfterId) url += `&startAfterId=${startAfterId}`;

    const data = await ghlGet(url);
    const opps = data.opportunities || [];
    allOpps.push(...opps);

    // GHL returns a meta.nextPageUrl or we check if we got a full page
    if (opps.length < 100) break; // last page
    startAfterId = opps[opps.length - 1]?.id || '';
    if (!startAfterId) break;
    page++;
  }

  return allOpps;
}

export async function GET() {
  try {
    const now = new Date();

    // Date boundaries for 12-month rolling windows
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
    const twentyFourMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 24, now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Fetch ALL opportunities (paginated)
    const opps = await fetchAllOpportunities();

    // Fetch calendar events (last 12 months + prior 12 months)
    const calStart = twentyFourMonthsAgo.getTime();
    const calEnd = now.getTime();
    const [discoveryData, onsiteData] = await Promise.all([
      ghlGet(`/calendars/events?locationId=${GHL_LOC()}&calendarId=${DISCOVERY_CAL}&startTime=${calStart}&endTime=${calEnd}`),
      ghlGet(`/calendars/events?locationId=${GHL_LOC()}&calendarId=${ONSITE_CAL}&startTime=${calStart}&endTime=${calEnd}`),
    ]);
    const allDiscoveryEvents = discoveryData.events || [];
    const allOnsiteEvents = onsiteData.events || [];

    // ── Partition events and opps into current 12mo vs prior 12mo ──
    const isInPeriod = (dateStr: string, start: Date, end: Date) => {
      const d = new Date(dateStr);
      return d >= start && d <= end;
    };

    // Current 12-month window
    const currentOpps = opps.filter((o: any) => isInPeriod(o.createdAt, twelveMonthsAgo, now));
    const priorOpps = opps.filter((o: any) => isInPeriod(o.createdAt, twentyFourMonthsAgo, twelveMonthsAgo));

    const currentDiscovery = allDiscoveryEvents.filter((e: any) =>
      isInPeriod(e.startTime || e.createdAt, twelveMonthsAgo, now)
    );
    const priorDiscovery = allDiscoveryEvents.filter((e: any) =>
      isInPeriod(e.startTime || e.createdAt, twentyFourMonthsAgo, twelveMonthsAgo)
    );
    const currentOnsite = allOnsiteEvents.filter((e: any) =>
      isInPeriod(e.startTime || e.createdAt, twelveMonthsAgo, now)
    );
    const priorOnsite = allOnsiteEvents.filter((e: any) =>
      isInPeriod(e.startTime || e.createdAt, twentyFourMonthsAgo, twelveMonthsAgo)
    );

    // ── Pipeline breakdown (open only — all time) ──
    const openOpps = opps.filter((o: any) => o.status === 'open');
    const pipelineBreakdown: { stage: string; count: number; stageId: string }[] = [];
    for (const [stageId, stageName] of Object.entries(STAGES)) {
      const count = openOpps.filter((o: any) => o.pipelineStageId === stageId).length;
      if (count > 0) {
        pipelineBreakdown.push({ stage: stageName, count, stageId });
      }
    }

    // ── Helper to count secured from an opp set ──
    const countSecured = (oppSet: any[]) =>
      oppSet.filter((o: any) => SECURED_STAGES.includes(STAGES[o.pipelineStageId] || '')).length;

    // ── 12-Month Rolling KPIs ──
    const totalLeads12m = currentOpps.length;
    const totalLeadsPrior = priorOpps.length;

    const securedClients12m = countSecured(currentOpps);
    const securedClientsPrior = countSecured(priorOpps);

    const onsiteVisits12m = currentOnsite.length;
    const onsiteVisitsPrior = priorOnsite.length;

    const discoveryCalls12m = currentDiscovery.length;
    const discoveryCallsPrior = priorDiscovery.length;

    const conversionRate12m = totalLeads12m > 0
      ? Math.round((securedClients12m / totalLeads12m) * 100)
      : 0;
    const conversionRatePrior = totalLeadsPrior > 0
      ? Math.round((securedClientsPrior / totalLeadsPrior) * 100)
      : 0;

    // Active leads = currently open in lead stages
    const activeLeads = openOpps.filter((o: any) =>
      LEAD_STAGES.includes(STAGES[o.pipelineStageId] || '')
    ).length;

    // Short-term metrics (for sub-labels)
    const newLeadsThisWeek = opps.filter((o: any) => new Date(o.createdAt) >= sevenDaysAgo).length;
    const newLeadsThisMonth = opps.filter((o: any) => new Date(o.createdAt) >= thirtyDaysAgo).length;

    // ── Percent change helper ──
    const pctChange = (current: number, prior: number): number | null => {
      if (prior === 0 && current === 0) return null;
      if (prior === 0) return 100; // went from 0 to something
      return Math.round(((current - prior) / prior) * 100);
    };

    // ── Funnel (current 12m) ──
    const inEstimating = openOpps.filter((o: any) => o.pipelineStageId === 'c4012dfe-bc76-4447-8947-96a9e846ff2b').length;
    const funnel = [
      { label: 'Total Leads (12mo)', value: totalLeads12m },
      { label: 'Discovery Calls', value: discoveryCalls12m },
      { label: 'On-Site Visits', value: onsiteVisits12m },
      { label: 'Estimating', value: inEstimating },
      { label: 'Secured (In Design+)', value: securedClients12m },
    ];

    // ── Monthly lead creation trend (last 12 months) ──
    const monthlyTrend: { month: string; leads: number; secured: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      const leadsInMonth = opps.filter((o: any) => {
        const created = new Date(o.createdAt);
        return created >= d && created <= monthEnd;
      }).length;
      const securedInMonth = opps.filter((o: any) => {
        const name = STAGES[o.pipelineStageId] || '';
        if (!SECURED_STAGES.includes(name)) return false;
        const changed = new Date(o.lastStageChangeAt || o.createdAt);
        return changed >= d && changed <= monthEnd;
      }).length;
      monthlyTrend.push({ month: monthLabel, leads: leadsInMonth, secured: securedInMonth });
    }

    // ── Lead Source breakdown (12-month) ──
    const LEAD_SOURCE_FIELD = 'jffMrsPHeWBI581YsIYP';
    const sourceBreakdown: Record<string, number> = {};
    for (const o of currentOpps) {
      const cf = (o as any).customFields || [];
      const lsField = cf.find((f: any) => f.id === LEAD_SOURCE_FIELD);
      const val = lsField?.fieldValueString || '';
      if (val) {
        // MULTIPLE_OPTIONS may be comma-separated
        for (const v of val.split(',')) {
          const trimmed = v.trim();
          if (trimmed) {
            sourceBreakdown[trimmed] = (sourceBreakdown[trimmed] || 0) + 1;
          }
        }
      } else {
        sourceBreakdown['Unknown'] = (sourceBreakdown['Unknown'] || 0) + 1;
      }
    }
    // Sort by count descending
    const sourceData = Object.entries(sourceBreakdown)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    // ── Recent leads ──
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

    // ── Pending New Leads ──
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
        // 12-month rolling primary KPIs
        totalLeads12m,
        totalLeadsPrior,
        totalLeadsChange: pctChange(totalLeads12m, totalLeadsPrior),

        securedClients12m,
        securedClientsPrior,
        securedClientsChange: pctChange(securedClients12m, securedClientsPrior),

        onsiteVisits12m,
        onsiteVisitsPrior,
        onsiteVisitsChange: pctChange(onsiteVisits12m, onsiteVisitsPrior),

        discoveryCalls12m,
        discoveryCallsPrior,
        discoveryCallsChange: pctChange(discoveryCalls12m, discoveryCallsPrior),

        conversionRate12m,
        conversionRatePrior,
        conversionRateChange: pctChange(conversionRate12m, conversionRatePrior),

        // Snapshot metrics (for sub-labels)
        newLeadsThisWeek,
        newLeadsThisMonth,
        activeLeads,
        totalPipeline: openOpps.length,
      },
      pipelineBreakdown,
      funnel,
      monthlyTrend,
      recentLeads,
      pendingNewLeads,
      sourceBreakdown: sourceData,
    });
  } catch (err: any) {
    console.error('Leads KPI error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load KPIs' }, { status: 500 });
  }
}

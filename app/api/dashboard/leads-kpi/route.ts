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

async function ghlPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: 'POST',
    headers: ghlHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GHL POST ${res.status}`);
  return res.json();
}

/**
 * Fetch ALL opportunities via POST /opportunities/search.
 * POST search returns richer customFields (including MULTIPLE_OPTIONS as fieldValueArray)
 * whereas the GET endpoint omits array-type custom fields.
 */
async function fetchAllOpportunities(): Promise<any[]> {
  const allOpps: any[] = [];
  let startAfterId = '';
  let page = 0;
  const MAX_PAGES = 10; // safety cap: 10 pages × 100 = 1000 opps max

  while (page < MAX_PAGES) {
    const body: Record<string, unknown> = {
      locationId: GHL_LOC(),
      limit: 100,
    };
    if (startAfterId) body.startAfterId = startAfterId;

    const data = await ghlPost('/opportunities/search', body);
    const opps = data.opportunities || [];
    allOpps.push(...opps);

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

    // Date boundaries for 12-month rolling windows (kept for monthly trend
    // + source breakdown which still want a year of data).
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
    const twentyFourMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 24, now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 60-day primary window + the same 60-day window from one year ago.
    // Nathan wants the top KPI cards and the comparison chart on a 60-day
    // basis with a true year-over-year delta (seasonality matters more than
    // raw rolling 12-month volume).
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    // "Same 60 days last year" = shift both endpoints back 365 days.
    const sixtyDaysAgoLastYear = new Date(sixtyDaysAgo.getTime() - 365 * 24 * 60 * 60 * 1000);
    const nowLastYear = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // Fetch ALL opportunities (paginated)
    const opps = await fetchAllOpportunities();

    // Fetch calendar events. The pull spans 24 months ago → now so it
    // covers both the rolling 12-month frame AND the "60 days last year"
    // window (which sits inside the 12–14-months-ago slice).
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

    // 60-day windows: this year and same 60 days a year ago.
    const opps60d = opps.filter((o: any) => isInPeriod(o.createdAt, sixtyDaysAgo, now));
    const oppsPrior60d = opps.filter((o: any) => isInPeriod(o.createdAt, sixtyDaysAgoLastYear, nowLastYear));

    const discovery60d = allDiscoveryEvents.filter((e: any) =>
      isInPeriod(e.startTime || e.createdAt, sixtyDaysAgo, now)
    );
    const discoveryPrior60d = allDiscoveryEvents.filter((e: any) =>
      isInPeriod(e.startTime || e.createdAt, sixtyDaysAgoLastYear, nowLastYear)
    );
    const onsite60d = allOnsiteEvents.filter((e: any) =>
      isInPeriod(e.startTime || e.createdAt, sixtyDaysAgo, now)
    );
    const onsitePrior60d = allOnsiteEvents.filter((e: any) =>
      isInPeriod(e.startTime || e.createdAt, sixtyDaysAgoLastYear, nowLastYear)
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

    // "Secured in <window>" = opps whose lastStageChangeAt fell inside the
    // window AND whose CURRENT stage is in the secured set. This counts the
    // moment a lead moved into Design/Production/etc, not the moment it
    // was first created. For a 60-day window that's far more useful than
    // "leads created in last 60d that are now secured" (most BKB jobs take
    // longer than 60 days to convert, so a creation-window definition
    // would read near-zero).
    const countSecuredInWindow = (start: Date, end: Date) =>
      opps.filter((o: any) => {
        const stageName = STAGES[o.pipelineStageId] || '';
        if (!SECURED_STAGES.includes(stageName)) return false;
        const changed = o.lastStageChangeAt || o.createdAt;
        return isInPeriod(changed, start, end);
      }).length;

    // ── 12-Month Rolling KPIs (still computed for the conversion rate
    //    card and any callers that still want the annual view) ──
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

    // ── 60-Day window with year-over-year comparison ──
    // Primary metrics on the dashboard top row. The "prior" baseline is
    // the same 60-day window from a year ago (true YoY), not the prior
    // rolling 60 days, so seasonality is preserved.
    const totalLeads60d = opps60d.length;
    const totalLeads60dPrior = oppsPrior60d.length;

    const onsiteVisits60d = onsite60d.length;
    const onsiteVisits60dPrior = onsitePrior60d.length;

    const discoveryCalls60d = discovery60d.length;
    const discoveryCalls60dPrior = discoveryPrior60d.length;

    // Secured: count stage-change events into Secured stages that fell in
    // the window (see countSecuredInWindow comment for rationale).
    const securedClients60d = countSecuredInWindow(sixtyDaysAgo, now);
    const securedClients60dPrior = countSecuredInWindow(sixtyDaysAgoLastYear, nowLastYear);

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

    // ── Year-over-Year 60-day comparison ──
    // Replaces the old 12-month funnel chart. Lets Nathan eyeball
    // whether the most recent 60 days are running ahead of or behind
    // the same 60-day window from last year (seasonality matters).
    const yearOverYear60d = [
      { label: 'Total Leads',     thisYear: totalLeads60d,     lastYear: totalLeads60dPrior },
      { label: 'Discovery Calls', thisYear: discoveryCalls60d, lastYear: discoveryCalls60dPrior },
      { label: 'On-Site Visits',  thisYear: onsiteVisits60d,   lastYear: onsiteVisits60dPrior },
      { label: 'Secured',         thisYear: securedClients60d, lastYear: securedClients60dPrior },
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
      // POST search returns fieldValueArray for MULTIPLE_OPTIONS fields
      const arrVal = lsField?.fieldValueArray || [];
      const strVal = lsField?.fieldValueString || '';
      let sources: string[] = [];
      if (Array.isArray(arrVal) && arrVal.length > 0) {
        sources = arrVal.map((v: string) => v.trim()).filter(Boolean);
      } else if (strVal) {
        sources = strVal.split(',').map((v: string) => v.trim()).filter(Boolean);
      }
      if (sources.length > 0) {
        for (const s of sources) {
          sourceBreakdown[s] = (sourceBreakdown[s] || 0) + 1;
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
        contactId: o.contact?.id || '',
      }));

    // ── Pending Leads (open leads in early pipeline stages needing action) ──
    // Excludes 'Estimating' because those leads live in the Estimating Tracker
    // column, so we don't show them as duplicates across both columns.
    const PENDING_STAGES = ['New Inquiry', 'Initial Call Scheduled', 'Discovery Scheduled', 'No Show'];
    const PENDING_STAGE_IDS = new Set(
      Object.entries(STAGES)
        .filter(([, name]) => PENDING_STAGES.includes(name))
        .map(([id]) => id)
    );
    const pendingNewLeads = opps
      .filter((o: any) => PENDING_STAGE_IDS.has(o.pipelineStageId) && o.status === 'open')
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
        stage: STAGES[o.pipelineStageId] || 'Unknown',
      }));

    return NextResponse.json({
      kpis: {
        // 60-day window (primary KPIs Nathan looks at on the dashboard
        // top row). Change is vs the same 60-day window one year ago.
        totalLeads60d,
        totalLeads60dPrior,
        totalLeads60dChange: pctChange(totalLeads60d, totalLeads60dPrior),

        onsiteVisits60d,
        onsiteVisits60dPrior,
        onsiteVisits60dChange: pctChange(onsiteVisits60d, onsiteVisits60dPrior),

        securedClients60d,
        securedClients60dPrior,
        securedClients60dChange: pctChange(securedClients60d, securedClients60dPrior),

        discoveryCalls60d,
        discoveryCalls60dPrior,
        discoveryCalls60dChange: pctChange(discoveryCalls60d, discoveryCalls60dPrior),

        // 12-month rolling — still surfaced so the Conversion Rate card
        // (annualized denominator) has a sensible baseline, and so any
        // downstream client that hasn't migrated yet keeps working.
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
      yearOverYear60d,
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

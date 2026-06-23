// @ts-nocheck
/**
 * GET /api/raffle/pipeline-review
 *
 * Fetch live pipeline + opportunities from Loop, enrich with raffle_entries
 * data (interests, source, contact_ok), and return prioritized review list
 * for New Inquiry stage.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'H3fSXP5K9fMGf0eJIkXk';

function headers() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY || ''}`,
    Version: '2021-07-28',
  };
}

async function fetchJSON(url: string, init: any = {}) {
  const res = await fetch(url, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, body, text };
}

export async function GET(req: NextRequest) {
  // 1. Get pipelines for the location
  const pipes = await fetchJSON(
    `${GHL_BASE}/opportunities/pipelines?locationId=${LOCATION_ID}`,
  );
  if (!pipes.ok) {
    return NextResponse.json({ error: 'fetch_pipelines_failed', detail: pipes.text }, { status: 502 });
  }
  const pipelines = pipes.body?.pipelines || [];

  // 2. Find "New Inquiry" stage IDs
  const newInquiryStages: any[] = [];
  for (const p of pipelines) {
    for (const s of (p.stages || [])) {
      if ((s.name || '').toLowerCase().includes('new inquiry')) {
        newInquiryStages.push({ pipelineId: p.id, pipelineName: p.name, stageId: s.id, stageName: s.name });
      }
    }
  }

  // 3. Fetch opportunities for each New Inquiry stage
  const opportunities: any[] = [];
  for (const ns of newInquiryStages) {
    let page = 1;
    while (true) {
      const url = new URL(`${GHL_BASE}/opportunities/search`);
      url.searchParams.set('location_id', LOCATION_ID);
      url.searchParams.set('pipeline_id', ns.pipelineId);
      url.searchParams.set('pipeline_stage_id', ns.stageId);
      url.searchParams.set('limit', '100');
      url.searchParams.set('page', String(page));
      const r = await fetchJSON(url.toString());
      if (!r.ok) break;
      const items = r.body?.opportunities || [];
      opportunities.push(...items.map((o: any) => ({ ...o, pipeline_name: ns.pipelineName, stage_name: ns.stageName })));
      if (items.length < 100) break;
      page++;
      if (page > 10) break;
    }
  }

  // 4. Enrich with raffle_entries data
  const supabase = getSupabase();
  const contactIds = opportunities.map((o: any) => o.contactId || o.contact?.id).filter(Boolean);
  let raffleByContactId: Record<string, any> = {};
  if (contactIds.length) {
    const { data: raffle } = await supabase
      .from('raffle_entries')
      .select('id, name, email, phone, contact_ok, source, interests, loop_contact_id, loop_sync_error, created_at')
      .in('loop_contact_id', contactIds)
      .is('deleted_at', null);
    for (const r of raffle || []) {
      if (r.loop_contact_id) raffleByContactId[r.loop_contact_id] = r;
    }
  }

  // 5. For each opportunity, fetch the contact for richer data
  const enriched: any[] = [];
  for (const o of opportunities) {
    const contactId = o.contactId || o.contact?.id;
    const raffle = raffleByContactId[contactId];
    let contactData = o.contact || null;
    if (!contactData && contactId) {
      const c = await fetchJSON(`${GHL_BASE}/contacts/${contactId}`);
      if (c.ok) contactData = c.body?.contact || c.body;
    }
    enriched.push({
      opportunity_id: o.id,
      opportunity_name: o.name,
      pipeline_name: o.pipeline_name,
      stage_name: o.stage_name,
      monetary_value: o.monetaryValue,
      assigned_to: o.assignedTo,
      status: o.status,
      created_at: o.createdAt,
      updated_at: o.updatedAt,
      last_status_change_at: o.lastStatusChangeAt,
      last_stage_change_at: o.lastStageChangeAt,
      contact: {
        id: contactId,
        name: contactData?.contactName || `${contactData?.firstName || ''} ${contactData?.lastName || ''}`.trim(),
        email: contactData?.email,
        phone: contactData?.phone,
        tags: contactData?.tags || [],
        source: contactData?.source,
      },
      raffle: raffle ? {
        contact_ok: raffle.contact_ok,
        source: raffle.source,
        interests: raffle.interests,
        loop_sync_error: raffle.loop_sync_error,
      } : null,
    });
  }

  return NextResponse.json({
    ok: true,
    pipelines: pipelines.map((p: any) => ({ id: p.id, name: p.name, stages: (p.stages || []).map((s: any) => s.name) })),
    new_inquiry_stages: newInquiryStages,
    opportunity_count: enriched.length,
    opportunities: enriched,
  });
}

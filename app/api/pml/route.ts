// @ts-nocheck
/**
 * Project Memory Layer — CRUD Endpoint
 *
 * GET  /api/pml?jobId=xxx            — List events for a job
 * GET  /api/pml?open=true            — List all open items
 * GET  /api/pml?search=keyword       — Search events
 * POST /api/pml                      — Create a new event
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../lib/auth';
import {
  createProjectEvent,
  getProjectMemory,
  getOpenItems,
  searchProjectEvents,
  formatEventsForContext,
  formatOpenItemsForContext,
} from '@/app/lib/project-memory';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    const open = searchParams.get('open');
    const search = searchParams.get('search');
    const channel = searchParams.get('channel') as any;
    const eventType = searchParams.get('eventType') as any;
    const daysBack = parseInt(searchParams.get('daysBack') || '30');
    const limit = parseInt(searchParams.get('limit') || '100');
    const format = searchParams.get('format'); // 'text' for formatted string

    // Open items across all projects
    if (open === 'true') {
      const items = await getOpenItems({ jobId: jobId || undefined, limit });
      if (format === 'text') {
        return NextResponse.json({ success: true, count: items.length, formatted: formatOpenItemsForContext(items) });
      }
      return NextResponse.json({ success: true, count: items.length, items });
    }

    // Search across events
    if (search) {
      const results = await searchProjectEvents(search, { jobId: jobId || undefined, limit });
      if (format === 'text') {
        return NextResponse.json({ success: true, count: results.length, formatted: formatEventsForContext(results) });
      }
      return NextResponse.json({ success: true, count: results.length, events: results });
    }

    // List events for a job
    if (jobId) {
      const events = await getProjectMemory({
        jobId,
        channel: channel || undefined,
        eventType: eventType || undefined,
        includeResolved: searchParams.get('includeResolved') !== 'false',
        daysBack,
        limit,
      });
      if (format === 'text') {
        return NextResponse.json({ success: true, count: events.length, formatted: formatEventsForContext(events) });
      }
      return NextResponse.json({ success: true, count: events.length, events });
    }

    return NextResponse.json({ error: 'Provide jobId, open=true, or search parameter' }, { status: 400 });
  } catch (err: any) {
    console.error('[PML GET] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const {
      job_id, job_name, job_number,
      channel, event_type, summary, detail,
      participants, source_ref, related_event_id,
      open_item, open_item_description,
    } = body;

    if (!channel || !event_type || !summary) {
      return NextResponse.json(
        { error: 'Required fields: channel, event_type, summary' },
        { status: 400 }
      );
    }

    const event = await createProjectEvent({
      job_id, job_name, job_number,
      channel, event_type, summary, detail,
      participants, source_ref, related_event_id,
      open_item, open_item_description,
    });

    return NextResponse.json({ success: true, event });
  } catch (err: any) {
    console.error('[PML POST] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

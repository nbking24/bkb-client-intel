// @ts-nocheck
/**
 * Project Memory Layer — Single Event Endpoint
 *
 * GET    /api/pml/[eventId]          — Get a single event
 * PATCH  /api/pml/[eventId]          — Resolve an open item or update event
 * DELETE /api/pml/[eventId]          — Delete a project event (e.g. wrong transcript)
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../../lib/auth';
import { getProjectEventById, resolveOpenItem, deleteProjectEvent } from '@/app/lib/project-memory';

export const maxDuration = 15;

export async function GET(
  req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const event = await getProjectEventById(params.eventId);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    return NextResponse.json({ success: true, event });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const { resolved_note, auto_resolved } = body;

    if (!resolved_note) {
      return NextResponse.json({ error: 'resolved_note is required' }, { status: 400 });
    }

    const event = await resolveOpenItem(params.eventId, resolved_note, auto_resolved || false);
    return NextResponse.json({ success: true, event });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const deleted = await deleteProjectEvent(params.eventId);
    return NextResponse.json({ success: true, deleted });
  } catch (err: any) {
    const status = /not found/i.test(err.message || '') ? 404 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}

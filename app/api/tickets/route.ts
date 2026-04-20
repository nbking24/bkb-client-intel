// @ts-nocheck
/**
 * /api/tickets
 *
 * POST — create a new ticket (multipart form with optional screenshot file).
 * GET  — list tickets. Terri sees her own; Nathan sees all.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth, validateAgentOrUser } from '../lib/auth';
import { createServerClient } from '@/app/lib/supabase';
import {
  TICKET_BUCKET,
  ensureTicketBucket,
  logTicketEvent,
  notifyNathanNewTicket,
} from '../lib/tickets';
import { TEAM_USERS } from '@/app/lib/constants';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
const MAX_SCREENSHOT_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!auth.userId) return NextResponse.json({ error: 'Legacy token not allowed for tickets' }, { status: 401 });

  try {
    const formData = await req.formData();

    const title = String(formData.get('title') || '').trim();
    const description = String(formData.get('description') || '').trim();
    const severity = String(formData.get('severity') || 'medium');
    const pageUrl = String(formData.get('page_url') || '').trim();
    const viewportW = Number(formData.get('viewport_width') || 0) || null;
    const viewportH = Number(formData.get('viewport_height') || 0) || null;
    const userAgent = String(formData.get('user_agent') || '').slice(0, 500);
    const screenshot = formData.get('screenshot') as File | null;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const sb = createServerClient();

    // Optional screenshot upload
    let screenshotUrl: string | null = null;
    if (screenshot && typeof screenshot === 'object' && screenshot.size > 0) {
      if (!ALLOWED_IMAGE_TYPES.includes(screenshot.type)) {
        return NextResponse.json({ error: 'Screenshot must be jpg, png, webp, gif, or heic' }, { status: 400 });
      }
      if (screenshot.size > MAX_SCREENSHOT_SIZE) {
        return NextResponse.json({ error: 'Screenshot must be under 10MB' }, { status: 400 });
      }
      await ensureTicketBucket(sb);
      const ext = screenshot.name.split('.').pop() || 'png';
      const path = `${auth.userId}/${Date.now()}.${ext}`;
      const buffer = Buffer.from(await screenshot.arrayBuffer());
      const { data: uploaded, error: upErr } = await sb.storage
        .from(TICKET_BUCKET)
        .upload(path, buffer, { contentType: screenshot.type, upsert: false });
      if (upErr) {
        console.error('[tickets] screenshot upload failed:', upErr.message);
      } else {
        const { data: urlData } = sb.storage.from(TICKET_BUCKET).getPublicUrl(uploaded.path);
        screenshotUrl = urlData.publicUrl;
      }
    }

    const submitter = TEAM_USERS[auth.userId];
    const submitterName = submitter?.name || auth.userId;
    const submitterEmail = submitter?.email || null;

    // Create the ticket
    const { data: ticket, error } = await sb
      .from('tickets')
      .insert({
        submitter_user_id: auth.userId,
        submitter_name: submitterName,
        submitter_email: submitterEmail,
        title: title.slice(0, 200),
        description: description.slice(0, 4000) || null,
        severity: ['low', 'medium', 'high', 'urgent'].includes(severity) ? severity : 'medium',
        page_url: pageUrl.slice(0, 1000) || null,
        viewport_width: viewportW,
        viewport_height: viewportH,
        user_agent: userAgent || null,
        screenshot_url: screenshotUrl,
        status: 'new',
      })
      .select()
      .single();

    if (error) {
      console.error('[tickets] insert failed:', error.message);
      return NextResponse.json({ error: 'Could not save ticket: ' + error.message }, { status: 500 });
    }

    await logTicketEvent({
      sb,
      ticketId: ticket.id,
      actor: auth.userId,
      actorRole: auth.role,
      eventType: 'created',
      toStatus: 'new',
      note: title,
    });

    // Fire email to Nathan (best effort)
    const emailResult = await notifyNathanNewTicket(ticket);
    if (emailResult.ok) {
      await logTicketEvent({
        sb,
        ticketId: ticket.id,
        actor: 'system',
        actorRole: 'system',
        eventType: 'email_sent',
        note: 'New ticket notification sent to Nathan',
        metadata: { recipient: 'nathan', message_id: emailResult.id },
      });
    }

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (err: any) {
    console.error('[tickets POST] error:', err?.message);
    return NextResponse.json({ error: err?.message || 'Failed to create ticket' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const auth = validateAgentOrUser(req);
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get('status');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
    const mineOnly = url.searchParams.get('mine') === 'true';

    const sb = createServerClient();
    let q = sb.from('tickets').select('*').order('created_at', { ascending: false }).limit(limit);

    // Non-owners only see their own tickets. Nathan sees everything.
    if (auth.role !== 'owner' || mineOnly) {
      q = q.eq('submitter_user_id', auth.userId);
    }

    if (statusFilter) {
      // allow comma-separated multi-status filter, e.g. ?status=new,in_review
      const statuses = statusFilter.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) q = q.eq('status', statuses[0]);
      else if (statuses.length > 1) q = q.in('status', statuses);
    }

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ tickets: data || [] });
  } catch (err: any) {
    console.error('[tickets GET] error:', err?.message);
    return NextResponse.json({ error: err?.message || 'Failed to list tickets' }, { status: 500 });
  }
}

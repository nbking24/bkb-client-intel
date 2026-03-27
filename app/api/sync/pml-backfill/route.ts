// @ts-nocheck
/**
 * PML Backfill — One-time sync of existing data into project_events
 *
 * POST /api/sync/pml-backfill
 *
 * Backfills JT comments and daily logs from Supabase cache tables
 * into the unified project_events table.
 *
 * Safe to run multiple times — uses source_ref deduplication.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAuth } from '../../lib/auth';
import { createProjectEvent, findEventBySourceRef } from '@/app/lib/project-memory';
import { createServerClient } from '@/app/lib/supabase';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = validateAuth(req.headers.get('authorization'));
  if (!auth.valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const stats = {
    jtComments: { synced: 0, skipped: 0, errors: 0 },
    jtDailyLogs: { synced: 0, skipped: 0, errors: 0 },
    texts: { synced: 0, skipped: 0, errors: 0 },
  };

  const supabase = createServerClient();

  // Backfill JT Comments (last 90 days)
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: comments } = await supabase
      .from('jt_comments')
      .select('id, job_id, message, name, created_at, target_type')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(500);

    // We need job names — fetch from jt_jobs cache
    const { data: jobs } = await supabase
      .from('jt_jobs')
      .select('id, name, number');
    const jobMap = new Map((jobs || []).map(j => [j.id, j]));

    for (const comment of (comments || [])) {
      try {
        const existing = await findEventBySourceRef('jobtread', 'comment_id', comment.id);
        if (existing) { stats.jtComments.skipped++; continue; }

        const job = jobMap.get(comment.job_id);
        await createProjectEvent({
          job_id: comment.job_id,
          job_name: job?.name || null,
          job_number: job?.number || null,
          channel: 'jobtread',
          event_type: 'note',
          summary: `JT comment by ${comment.name || 'Unknown'}: ${(comment.message || '').slice(0, 150)}`,
          detail: comment.message,
          participants: comment.name ? [comment.name] : null,
          source_ref: { comment_id: comment.id, target_type: comment.target_type },
        });
        stats.jtComments.synced++;
      } catch (err) {
        stats.jtComments.errors++;
      }
    }
  } catch (err: any) {
    console.error('[PML Backfill] JT comments error:', err.message);
  }

  // Backfill JT Daily Logs (last 90 days)
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: logs } = await supabase
      .from('jt_daily_logs')
      .select('id, job_id, date, notes, assigned_member_names, created_at')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(500);

    const { data: jobs } = await supabase
      .from('jt_jobs')
      .select('id, name, number');
    const jobMap = new Map((jobs || []).map(j => [j.id, j]));

    for (const log of (logs || [])) {
      try {
        const existing = await findEventBySourceRef('jobtread', 'daily_log_id', log.id);
        if (existing) { stats.jtDailyLogs.skipped++; continue; }

        const job = jobMap.get(log.job_id);
        const assignees = log.assigned_member_names || [];
        await createProjectEvent({
          job_id: log.job_id,
          job_name: job?.name || null,
          job_number: job?.number || null,
          channel: 'jobtread',
          event_type: 'status_update',
          summary: `Daily log (${log.date}): ${(log.notes || '').slice(0, 150)}`,
          detail: log.notes,
          participants: assignees.length > 0 ? assignees : null,
          source_ref: { daily_log_id: log.id, date: log.date },
        });
        stats.jtDailyLogs.synced++;
      } catch (err) {
        stats.jtDailyLogs.errors++;
      }
    }
  } catch (err: any) {
    console.error('[PML Backfill] JT daily logs error:', err.message);
  }

  // Backfill recent texts from agent_cache
  try {
    const { data: textCache } = await supabase
      .from('agent_cache')
      .select('data')
      .eq('key', 'nathan-recent-texts')
      .single();

    if (textCache?.data?.messages) {
      for (const msg of (textCache.data.messages as any[])) {
        try {
          if (!msg.text || !msg.date) continue;
          const msgId = msg.id || `text-${msg.date}-${msg.contact_id}`;
          const existing = await findEventBySourceRef('text', 'text_id', msgId);
          if (existing) { stats.texts.skipped++; continue; }

          await createProjectEvent({
            channel: 'text',
            event_type: msg.is_from_me ? 'message_sent' : 'message_received',
            summary: `${msg.is_from_me ? 'Sent to' : 'Received from'} ${msg.contact_display || 'Unknown'}: ${msg.text.slice(0, 150)}`,
            detail: msg.text,
            participants: [msg.contact_display || msg.contact_id || 'Unknown'],
            source_ref: { text_id: msgId, contact_id: msg.contact_id, service: msg.service },
          });
          stats.texts.synced++;
        } catch (err) {
          stats.texts.errors++;
        }
      }
    }
  } catch (err: any) {
    console.error('[PML Backfill] Texts error:', err.message);
  }

  return NextResponse.json({ success: true, stats });
}

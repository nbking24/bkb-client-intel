// @ts-nocheck
/**
 * Project Memory Layer (PML) Service
 *
 * Unified project communication intelligence. Every meaningful event
 * across all channels (Gmail, JobTread, texts, phone, meetings, manual notes)
 * is captured in a single `project_events` Supabase table.
 *
 * The agent queries this one layer to have the full story on any project.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let _client: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_client) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    }
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

// ── Types ──────────────────────────────────────────────────────

export type PMLChannel = 'gmail' | 'jobtread' | 'text' | 'phone' | 'in_person' | 'meeting' | 'manual_note';

export type PMLEventType =
  | 'message_sent'
  | 'message_received'
  | 'meeting_held'
  | 'decision_made'
  | 'question_asked'
  | 'question_answered'
  | 'commitment_made'
  | 'status_update'
  | 'note';

export interface ProjectEvent {
  id: string;
  job_id: string | null;
  job_name: string | null;
  job_number: string | null;
  channel: PMLChannel;
  event_type: PMLEventType;
  summary: string;
  detail: string | null;
  participants: string[] | null;
  source_ref: Record<string, any> | null;
  related_event_id: string | null;
  open_item: boolean;
  open_item_description: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_note: string | null;
  auto_resolved: boolean;
  event_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEventInput {
  job_id?: string | null;
  job_name?: string | null;
  job_number?: string | null;
  channel: PMLChannel;
  event_type: PMLEventType;
  summary: string;
  detail?: string | null;
  participants?: string[] | null;
  source_ref?: Record<string, any> | null;
  related_event_id?: string | null;
  open_item?: boolean;
  open_item_description?: string | null;
  event_date?: string | null;
}

// ── Create Event ───────────────────────────────────────────────

export async function createProjectEvent(input: CreateEventInput): Promise<ProjectEvent> {
  const row: Record<string, any> = {
    job_id: input.job_id || null,
    job_name: input.job_name || null,
    job_number: input.job_number || null,
    channel: input.channel,
    event_type: input.event_type,
    summary: input.summary,
    detail: input.detail || null,
    participants: input.participants || null,
    source_ref: input.source_ref || null,
    related_event_id: input.related_event_id || null,
    open_item: input.open_item || false,
    open_item_description: input.open_item_description || null,
    resolved: false,
    resolved_at: null,
    resolved_note: null,
    auto_resolved: false,
  };
  // event_date: when the event actually occurred (may differ from created_at for past meetings)
  if (input.event_date) {
    row.event_date = input.event_date;
  }

  const { data, error } = await getSupabase()
    .from('project_events')
    .insert(row)
    .select('*')
    .single();

  if (error) throw new Error('Failed to create project event: ' + error.message);
  return data as ProjectEvent;
}

// ── Update Event (for pre-saved transcripts, etc.) ─────────────

export interface UpdateEventInput {
  summary?: string;
  detail?: string;
  participants?: string[] | null;
  event_date?: string | null;
  event_type?: PMLEventType;
  open_item?: boolean;
  open_item_description?: string | null;
}

export async function updateProjectEvent(eventId: string, updates: UpdateEventInput): Promise<ProjectEvent> {
  const row: Record<string, any> = {};
  if (updates.summary !== undefined) row.summary = updates.summary;
  if (updates.detail !== undefined) row.detail = updates.detail;
  if (updates.participants !== undefined) row.participants = updates.participants;
  if (updates.event_date !== undefined) row.event_date = updates.event_date;
  if (updates.event_type !== undefined) row.event_type = updates.event_type;
  if (updates.open_item !== undefined) row.open_item = updates.open_item;
  if (updates.open_item_description !== undefined) row.open_item_description = updates.open_item_description;

  if (Object.keys(row).length === 0) throw new Error('No fields to update');

  const { data, error } = await getSupabase()
    .from('project_events')
    .update(row)
    .eq('id', eventId)
    .select('*')
    .single();

  if (error) throw new Error('Failed to update project event: ' + error.message);
  return data as ProjectEvent;
}

// ── Delete Event ───────────────────────────────────────────────

export async function deleteProjectEvent(eventId: string): Promise<ProjectEvent> {
  // Fetch first so we can return what was removed (useful for confirmation messaging)
  const existing = await getProjectEventById(eventId);
  if (!existing) throw new Error('Project event not found: ' + eventId);

  const { error } = await getSupabase()
    .from('project_events')
    .delete()
    .eq('id', eventId);

  if (error) throw new Error('Failed to delete project event: ' + error.message);
  return existing;
}

// ── Get Project Memory ─────────────────────────────────────────

export interface GetProjectMemoryOptions {
  jobId: string;
  channel?: PMLChannel;
  eventType?: PMLEventType;
  includeResolved?: boolean;
  daysBack?: number;
  limit?: number;
}

export async function getProjectMemory(options: GetProjectMemoryOptions): Promise<ProjectEvent[]> {
  const {
    jobId,
    channel,
    eventType,
    includeResolved = true,
    daysBack = 30,
    limit = 100,
  } = options;

  const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  let query = getSupabase()
    .from('project_events')
    .select('*')
    .eq('job_id', jobId)
    .gte('created_at', cutoffDate)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (channel) query = query.eq('channel', channel);
  if (eventType) query = query.eq('event_type', eventType);
  if (!includeResolved) query = query.or('open_item.eq.false,resolved.eq.false');

  const { data, error } = await query;
  if (error) throw new Error('Failed to get project memory: ' + error.message);
  return (data || []) as ProjectEvent[];
}

// ── Backfill orphan events when a JT job becomes available ─────
// Lead-stage events get saved with job_id = null because no JT job
// exists yet. When the lead converts (a JT job is created and linked
// to the GHL contact), we want every prior project_event tied to that
// contact / opportunity to "catch up" — set its job_id so Ask Agent
// surfaces it against the new project, the job-costing dashboard
// agent answers include it, etc.
//
// Strategy: defensive UPDATE. Whenever code has BOTH a JT job_id AND
// a GHL contact id (or opportunity id) in hand, call this to sweep
// any orphans for that contact / opportunity into the job. Safe to
// call repeatedly — it only touches rows where job_id IS NULL.
//
// Called from:
//   - leads-action route, on every action that carries jtJobId
//     (schedule_meeting, move_to_design, move_to_nurture, save_transcript)
//   - getProjectMemoryForLead, as a defensive read-time backfill so the
//     lead detail modal and Ask Agent's project queries both benefit
//   - /api/cron/backfill-pml (sweep endpoint) for historical cleanup
export async function backfillProjectEventsForLead(args: {
  jobId: string;
  ghlContactId?: string | null;
  ghlOpportunityId?: string | null;
  jobName?: string | null;
  jobNumber?: string | null;
}): Promise<{ updated: number }> {
  const { jobId, ghlContactId, ghlOpportunityId, jobName, jobNumber } = args;
  if (!jobId || (!ghlContactId && !ghlOpportunityId)) return { updated: 0 };

  const sb = getSupabase();
  const update: Record<string, any> = { job_id: jobId };
  if (jobName) update.job_name = jobName;
  if (jobNumber) update.job_number = jobNumber;

  let totalUpdated = 0;

  // Pass 1: rows tagged with this GHL contact id (most reliable — same
  // person, possibly multiple opportunities over time, all should roll
  // up to this JT job).
  if (ghlContactId) {
    const { data, error } = await sb
      .from('project_events')
      .update(update)
      .is('job_id', null)
      .eq('source_ref->>ghl_contact_id', ghlContactId)
      .select('id');
    if (error) {
      console.warn('[backfillProjectEventsForLead] contact-id sweep failed:', error.message);
    } else {
      totalUpdated += (data || []).length;
    }
  }

  // Pass 2: rows tagged with this GHL opportunity id but not the
  // contact id (rare — different opportunity, same contact would
  // have been caught above; but defensive).
  if (ghlOpportunityId) {
    const { data, error } = await sb
      .from('project_events')
      .update(update)
      .is('job_id', null)
      .eq('source_ref->>ghl_opportunity_id', ghlOpportunityId)
      .select('id');
    if (error) {
      console.warn('[backfillProjectEventsForLead] opportunity-id sweep failed:', error.message);
    } else {
      totalUpdated += (data || []).length;
    }
  }

  if (totalUpdated > 0) {
    console.log(`[backfillProjectEventsForLead] Backfilled ${totalUpdated} orphan event(s) to job ${jobId}`);
  }
  return { updated: totalUpdated };
}

// ── Get Project Memory For Lead ────────────────────────────────
// Lead-stage events may have been saved BEFORE a JT job existed
// (e.g. transcript captured during the discovery call when the
// lead was still in Pending Discovery). Those rows have job_id = null
// but carry the GHL contact / opportunity in source_ref. This helper
// queries BOTH paths and merges so the lead detail modal can show
// every project event tied to this lead — whether it's been linked
// to a JT job yet or not.
export interface GetProjectMemoryForLeadOptions {
  jobId?: string | null;
  ghlContactId?: string | null;
  ghlOpportunityId?: string | null;
  daysBack?: number;
  limit?: number;
}

export async function getProjectMemoryForLead(
  options: GetProjectMemoryForLeadOptions
): Promise<ProjectEvent[]> {
  const { jobId, ghlContactId, ghlOpportunityId, daysBack = 180, limit = 50 } = options;
  if (!jobId && !ghlContactId && !ghlOpportunityId) return [];

  // Defensive backfill: if a JT job is now linked to this lead, promote any
  // orphan (job_id IS NULL) events for the contact / opportunity into the
  // job before we read. After backfill, the job_id query path picks them
  // up naturally and the source_ref path is just a safety net.
  if (jobId && (ghlContactId || ghlOpportunityId)) {
    try {
      await backfillProjectEventsForLead({
        jobId,
        ghlContactId: ghlContactId || null,
        ghlOpportunityId: ghlOpportunityId || null,
      });
    } catch (err: any) {
      console.warn('[getProjectMemoryForLead] backfill failed (continuing):', err?.message || err);
    }
  }

  const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const sb = getSupabase();

  // We need an OR across (job_id = X) and (source_ref->>ghl_contact_id = Y)
  // and (source_ref->>ghl_opportunity_id = Z). Supabase's PostgREST `.or()`
  // supports JSON path lookups, but building one combined `.or()` with
  // JSON path is finicky — easier to run them as separate queries and
  // merge in JS.
  const queries: Promise<{ data: any[] | null; error: any }>[] = [];
  if (jobId) {
    queries.push(
      sb.from('project_events')
        .select('*')
        .eq('job_id', jobId)
        .gte('created_at', cutoffDate)
        .order('created_at', { ascending: false })
        .limit(limit)
        .then(({ data, error }) => ({ data, error }))
    );
  }
  if (ghlContactId) {
    queries.push(
      sb.from('project_events')
        .select('*')
        .eq('source_ref->>ghl_contact_id', ghlContactId)
        .gte('created_at', cutoffDate)
        .order('created_at', { ascending: false })
        .limit(limit)
        .then(({ data, error }) => ({ data, error }))
    );
  }
  if (ghlOpportunityId) {
    queries.push(
      sb.from('project_events')
        .select('*')
        .eq('source_ref->>ghl_opportunity_id', ghlOpportunityId)
        .gte('created_at', cutoffDate)
        .order('created_at', { ascending: false })
        .limit(limit)
        .then(({ data, error }) => ({ data, error }))
    );
  }

  const results = await Promise.all(queries);
  const seen = new Set<string>();
  const merged: ProjectEvent[] = [];
  for (const r of results) {
    if (r.error) {
      console.warn('[getProjectMemoryForLead] query error:', r.error.message);
      continue;
    }
    for (const ev of (r.data || []) as ProjectEvent[]) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      merged.push(ev);
    }
  }
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return merged.slice(0, limit);
}

// ── Get Open Items ─────────────────────────────────────────────

export interface GetOpenItemsOptions {
  jobId?: string;
  limit?: number;
}

export async function getOpenItems(options: GetOpenItemsOptions = {}): Promise<ProjectEvent[]> {
  const { jobId, limit = 50 } = options;

  let query = getSupabase()
    .from('project_events')
    .select('*')
    .eq('open_item', true)
    .eq('resolved', false)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (jobId) query = query.eq('job_id', jobId);

  const { data, error } = await query;
  if (error) throw new Error('Failed to get open items: ' + error.message);
  return (data || []) as ProjectEvent[];
}

// ── Resolve Open Item ──────────────────────────────────────────

export async function resolveOpenItem(
  eventId: string,
  resolvedNote: string,
  autoResolved = false
): Promise<ProjectEvent> {
  const { data, error } = await getSupabase()
    .from('project_events')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_note: resolvedNote,
      auto_resolved: autoResolved,
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId)
    .select('*')
    .single();

  if (error) throw new Error('Failed to resolve open item: ' + error.message);
  return data as ProjectEvent;
}

// ── Search Project Events ──────────────────────────────────────

export async function searchProjectEvents(
  searchQuery: string,
  options: { jobId?: string; limit?: number } = {}
): Promise<ProjectEvent[]> {
  const { jobId, limit = 30 } = options;

  let query = getSupabase()
    .from('project_events')
    .select('*')
    .or(`summary.ilike.%${searchQuery}%,detail.ilike.%${searchQuery}%,open_item_description.ilike.%${searchQuery}%`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (jobId) query = query.eq('job_id', jobId);

  const { data, error } = await query;
  if (error) throw new Error('Failed to search project events: ' + error.message);
  return (data || []) as ProjectEvent[];
}

// ── Check for Duplicate (by source_ref) ────────────────────────

export async function findEventBySourceRef(
  channel: PMLChannel,
  refKey: string,
  refValue: string
): Promise<ProjectEvent | null> {
  // Use containedBy/contains to match JSON fields
  const { data, error } = await getSupabase()
    .from('project_events')
    .select('*')
    .eq('channel', channel)
    .contains('source_ref', { [refKey]: refValue })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0] as ProjectEvent;
}

// ── Get Event by ID ────────────────────────────────────────────

export async function getProjectEventById(eventId: string): Promise<ProjectEvent | null> {
  const { data, error } = await getSupabase()
    .from('project_events')
    .select('*')
    .eq('id', eventId)
    .single();

  if (error) return null;
  return data as ProjectEvent;
}

// ── Get Open Items Summary (for dashboard briefing) ────────────

export async function getOpenItemsSummary(): Promise<{
  total: number;
  byProject: { jobId: string; jobName: string; count: number; items: ProjectEvent[] }[];
  oldestUnresolved: ProjectEvent | null;
}> {
  const items = await getOpenItems({ limit: 100 });

  const byProject: Record<string, { jobId: string; jobName: string; count: number; items: ProjectEvent[] }> = {};

  for (const item of items) {
    const key = item.job_id || '_unlinked';
    if (!byProject[key]) {
      byProject[key] = {
        jobId: item.job_id || '',
        jobName: item.job_name || 'Unlinked',
        count: 0,
        items: [],
      };
    }
    byProject[key].count++;
    byProject[key].items.push(item);
  }

  return {
    total: items.length,
    byProject: Object.values(byProject).sort((a, b) => {
      // Sort by oldest open item first
      const aOldest = a.items[0]?.created_at || '';
      const bOldest = b.items[0]?.created_at || '';
      return aOldest.localeCompare(bOldest);
    }),
    oldestUnresolved: items.length > 0 ? items[0] : null,
  };
}

// ── Format Events for Agent Context ────────────────────────────

export function formatEventsForContext(events: ProjectEvent[]): string {
  if (events.length === 0) return 'No events found.';

  const lines: string[] = [];
  for (const e of events) {
    // Use event_date (when the event actually happened) if available, otherwise fall back to created_at
    const displayTimestamp = e.event_date || e.created_at;
    const date = new Date(displayTimestamp).toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const time = new Date(displayTimestamp).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    });
    const channelLabel = e.channel.replace('_', ' ').toUpperCase();
    const participants = e.participants?.length ? ' — ' + e.participants.join(', ') : '';
    const openTag = e.open_item ? (e.resolved ? ' [RESOLVED]' : ' [OPEN - ' + (e.open_item_description || 'awaiting response') + ']') : '';

    lines.push(`[${date} ${time}] [${channelLabel}] ${e.summary}${participants}${openTag}`);
    if (e.detail) {
      // Cap detail at 500 chars in timeline view to prevent oversized tool results.
      // Full transcripts/details are stored in the database and can be retrieved
      // individually via get_event_detail tool.
      const MAX_DETAIL_CHARS = 500;
      if (e.detail.length <= MAX_DETAIL_CHARS) {
        lines.push(`  Detail: ${e.detail}`);
      } else {
        const wordCount = e.detail.split(/\s+/).length;
        lines.push(`  Detail (preview — ${wordCount} words total, use get_event_detail with eventId="${e.id}" for full text): ${e.detail.slice(0, MAX_DETAIL_CHARS)}...`);
      }
    }
    if (e.resolved && e.resolved_note) {
      lines.push(`  → Resolved: ${e.resolved_note}`);
    }
  }
  return lines.join('\n');
}

// ── Format Open Items for Agent Context ────────────────────────

export function formatOpenItemsForContext(items: ProjectEvent[]): string {
  if (items.length === 0) return 'No open items.';

  const lines: string[] = [];
  for (const item of items) {
    const created = new Date(item.created_at);
    const now = new Date();
    const daysAgo = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    const channelLabel = item.channel.replace('_', ' ');
    const project = item.job_name ? `[${item.job_name}]` : '[Unlinked]';

    lines.push(
      `- ${project} ${item.open_item_description || item.summary} (${daysAgo}d ago, via ${channelLabel}) [ID: ${item.id}]`
    );
  }
  return lines.join('\n');
}

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
}

// ── Create Event ───────────────────────────────────────────────

export async function createProjectEvent(input: CreateEventInput): Promise<ProjectEvent> {
  const row = {
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

  const { data, error } = await getSupabase()
    .from('project_events')
    .insert(row)
    .select('*')
    .single();

  if (error) throw new Error('Failed to create project event: ' + error.message);
  return data as ProjectEvent;
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
    const date = new Date(e.created_at).toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const time = new Date(e.created_at).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    });
    const channelLabel = e.channel.replace('_', ' ').toUpperCase();
    const participants = e.participants?.length ? ' — ' + e.participants.join(', ') : '';
    const openTag = e.open_item ? (e.resolved ? ' [RESOLVED]' : ' [OPEN - ' + (e.open_item_description || 'awaiting response') + ']') : '';

    lines.push(`[${date} ${time}] [${channelLabel}] ${e.summary}${participants}${openTag}`);
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

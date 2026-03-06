// @ts-nocheck
/**
 * Supabase Client for BKB Client Intel Hub
 *
 * Uses service_role key for server-side operations (bypasses RLS).
 * This module provides typed helpers for upserting cached GHL/JT data
 * and querying the Supabase tables from the know-it-all agent.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** Convert GHL timestamp (epoch ms or ISO string) to ISO string for Postgres timestamptz */
function toTimestamp(val: any): string | null {
  if (val == null) return null;
  if (typeof val === 'number') return new Date(val).toISOString();
  if (typeof val === 'string') {
    // If it's all digits, treat as epoch ms
    if (/^\d{10,13}$/.test(val)) return new Date(Number(val)).toISOString();
    return val; // already ISO string
  }
  return null;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
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

// ââ UPSERT HELPERS ââââââââââââââââââââââââââââââââââââââââââ

export async function upsertContact(contact: any) {
  const c = contact.contact || contact;
  const row = {
    id: c.id,
    first_name: c.firstName || null,
    last_name: c.lastName || null,
    email: c.email || null,
    phone: c.phone || null,
    company_name: c.companyName || null,
    address: c.address1 || null,
    city: c.city || null,
    state: c.state || null,
    postal_code: c.postalCode || null,
    country: c.country || null,
    website: c.website || null,
    source: c.source || null,
    tags: c.tags || [],
    assigned_to: c.assignedTo || null,
    dnd: c.dnd || false,
    date_added: c.dateAdded || null,
    last_activity: c.lastActivity || null,
    custom_fields: Array.isArray(c.customFields)
      ? Object.fromEntries(c.customFields.filter((cf: any) => cf.value != null && cf.value !== '').map((cf: any) => [cf.fieldKey || cf.key || cf.id, cf.value]))
      : c.customFields || {},
    raw_data: c,
    synced_at: new Date().toISOString(),
  };
  const { error } = await getSupabase().from('contacts').upsert(row, { onConflict: 'id' });
  if (error) throw new Error('Upsert contact failed: ' + error.message);
  return row;
}

export async function upsertOpportunity(opp: any) {
  const o = opp.opportunity || opp;
  const row = {
    id: o.id,
    contact_id: o.contactId || o.contact_id || null,
    name: o.name || null,
    status: o.status || null,
    pipeline_id: o.pipelineId || null,
    pipeline_stage_id: o.pipelineStageId || null,
    pipeline_stage: o.pipelineStageName || o.stageName || null,
    monetary_value: o.monetaryValue || null,
    assigned_to: o.assignedTo || null,
    custom_fields: Array.isArray(o.customFields)
      ? Object.fromEntries(o.customFields.filter((cf: any) => cf.value != null && cf.value !== '').map((cf: any) => [cf.fieldKey || cf.key || cf.id, cf.value]))
      : o.customFields || {},
    raw_data: o,
    synced_at: new Date().toISOString(),
  };
  const { error } = await getSupabase().from('opportunities').upsert(row, { onConflict: 'id' });
  if (error) throw new Error('Upsert opportunity failed: ' + error.message);
  return row;
}

export async function upsertConversation(conv: any) {
  const row = {
    id: conv.id,
    contact_id: conv.contactId || null,
    type: conv.type || null,
    last_message_at: toTimestamp(conv.lastMessageDate || conv.dateUpdated) || null,
    last_message_body: conv.lastMessageBody || null,
    unread_count: conv.unreadCount || 0,
    raw_data: conv,
    synced_at: new Date().toISOString(),
  };
  const { error } = await getSupabase().from('conversations').upsert(row, { onConflict: 'id' });
  if (error) throw new Error('Upsert conversation failed: ' + error.message);
  return row;
}

export async function upsertMessage(msg: any, contactId: string) {
  const row = {
    id: msg.id,
    conversation_id: msg.conversationId || null,
    contact_id: contactId,
    direction: msg.direction || null,
    message_type: msg.messageType || msg.type || null,
    subject: msg.meta?.email?.subject || null,
    body: msg.body || msg.text || msg.message || null,
    body_html: msg.html || null,
    date_added: toTimestamp(msg.dateAdded) || null,
    meta: msg.meta || null,
    synced_at: new Date().toISOString(),
  };
  const { error } = await getSupabase().from('messages').upsert(row, { onConflict: 'id' });
  if (error) throw new Error('Upsert message failed: ' + error.message);
  return row;
}

export async function upsertNote(note: any, contactId: string) {
  const row = {
    id: note.id,
    contact_id: contactId,
    body: note.body || null,
    date_added: note.dateAdded || null,
    created_by: note.createdBy || null,
    synced_at: new Date().toISOString(),
  };
  const { error } = await getSupabase().from('notes').upsert(row, { onConflict: 'id' });
  if (error) throw new Error('Upsert note failed: ' + error.message);
  return row;
}

export async function upsertTask(task: any, contactId: string) {
  const row = {
    id: task.id,
    contact_id: contactId,
    title: task.title || task.body || null,
    description: task.description || null,
    due_date: task.dueDate || null,
    completed: task.completed || false,
    assigned_to: task.assignedTo || null,
    synced_at: new Date().toISOString(),
  };
  const { error } = await getSupabase().from('tasks').upsert(row, { onConflict: 'id' });
  if (error) throw new Error('Upsert task failed: ' + error.message);
  return row;
}

export async function upsertJTJob(job: any, contactId?: string) {
  const row = {
    id: job.id,
    number: job.number || null,
    name: job.name || null,
    status: job.status || null,
    description: job.description || null,
    contact_id: contactId || null,
    raw_data: job,
    synced_at: new Date().toISOString(),
  };
  const { error } = await getSupabase().from('jt_jobs').upsert(row, { onConflict: 'id' });
  if (error) throw new Error('Upsert JT job failed: ' + error.message);
  return row;
}

// ââ SYNC LOG ââââââââââââââââââââââââââââââââââââââââââââââââ

export async function createSyncLog(entityType: string, contactId?: string) {
  const { data, error } = await getSupabase()
    .from('sync_log')
    .insert({ entity_type: entityType, contact_id: contactId || null, status: 'started' })
    .select('id')
    .single();
  if (error) throw new Error('Create sync log failed: ' + error.message);
  return data.id;
}

export async function completeSyncLog(logId: string, recordsSynced: number, errorMessage?: string) {
  const { error } = await getSupabase()
    .from('sync_log')
    .update({
      status: errorMessage ? 'failed' : 'completed',
      records_synced: recordsSynced,
      error_message: errorMessage || null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', logId);
  if (error) console.error('Failed to update sync log:', error.message);
}

// ââ QUERY HELPERS (for know-it-all agent) âââââââââââââââââââ

export async function getContactFromDB(contactId: string) {
  const { data, error } = await getSupabase()
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .single();
  if (error) return null;
  return data;
}

export async function getContactNotesFromDB(contactId: string, limit = 5000) {
  const { data, error } = await getSupabase()
    .from('notes')
    .select('*')
    .eq('contact_id', contactId)
    .order('date_added', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}

export async function getContactMessagesFromDB(contactId: string, limit = 5000) {
  const { data, error } = await getSupabase()
    .from('messages')
    .select('*')
    .eq('contact_id', contactId)
    .order('date_added', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}

export async function getContactTasksFromDB(contactId: string) {
  const { data, error } = await getSupabase()
    .from('tasks')
    .select('*')
    .eq('contact_id', contactId)
    .order('due_date', { ascending: true });
  if (error) return [];
  return data || [];
}

export async function getContactOpportunitiesFromDB(contactId: string) {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .select('*')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

export async function getOpportunityFromDB(opportunityId: string) {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .select('*')
    .eq('id', opportunityId)
    .single();
  if (error) return null;
  return data;
}

export async function getJTJobsFromDB(limit = 50) {
  const { data, error } = await getSupabase()
    .from('jt_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}

export async function searchMessagesFullText(contactId: string, searchQuery: string, limit = 20) {
  const { data, error } = await getSupabase()
    .from('messages')
    .select('*')
    .eq('contact_id', contactId)
    .textSearch('body', searchQuery, { type: 'websearch' })
    .order('date_added', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}

export async function searchNotesFullText(contactId: string, searchQuery: string, limit = 20) {
  const { data, error } = await getSupabase()
    .from('notes')
    .select('*')
    .eq('contact_id', contactId)
    .textSearch('body', searchQuery, { type: 'websearch' })
    .order('date_added', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}

export async function getLastSyncTime(entityType: string, contactId?: string) {
  let query = getSupabase()
    .from('sync_log')
    .select('completed_at')
    .eq('entity_type', entityType)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1);
  if (contactId) query = query.eq('contact_id', contactId);
  const { data } = await query;
  return data?.[0]?.completed_at || null;
}

// -- CONTACT SEARCH BY NAME (for precon dashboard mapping) -----------

export async function searchContactsByName(name: string): Promise<any[]> {
  if (!name || name === 'Unknown') return [];

  const cleaned = name.trim();
  const parts = cleaned.split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.length > 1 ? parts[parts.length - 1] : '';

  try {
    // Try exact full-name match first (first_name + last_name)
    if (firstName && lastName) {
      const { data: exact } = await getSupabase()
        .from('contacts')
        .select('id, first_name, last_name, email, company_name, last_activity')
        .ilike('first_name', firstName)
        .ilike('last_name', lastName)
        .limit(5);
      if (exact && exact.length > 0) return exact;
    }

    // Try last name match
    if (lastName) {
      const { data: byLast } = await getSupabase()
        .from('contacts')
        .select('id, first_name, last_name, email, company_name, last_activity')
        .ilike('last_name', `%${lastName}%`)
        .limit(5);
      if (byLast && byLast.length > 0) return byLast;
    }

    // Try company name match
    const { data: byCompany } = await getSupabase()
      .from('contacts')
      .select('id, first_name, last_name, email, company_name, last_activity')
      .ilike('company_name', `%${cleaned}%`)
      .limit(5);
    if (byCompany && byCompany.length > 0) return byCompany;

    // Try partial first name match as last resort
    if (firstName) {
      const { data: byFirst } = await getSupabase()
        .from('contacts')
        .select('id, first_name, last_name, email, company_name, last_activity')
        .ilike('first_name', `%${firstName}%`)
        .limit(5);
      if (byFirst && byFirst.length > 0) return byFirst;
    }

    return [];
  } catch (err) {
    console.error('searchContactsByName error:', err);
    return [];
  }
}

// ============================================================
// JT Comments Queries
// ============================================================

/**
 * Get all JT comments for a specific job, ordered newest first.
 */
export async function getJTCommentsByJobId(jobId: string, limit = 5000): Promise<any[]> {
  try {
    const { data, error } = await getSupabase()
      .from('jt_comments')
      .select('id, job_id, target_type, target_id, message, name, is_pinned, parent_comment_id, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('getJTCommentsByJobId error:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('getJTCommentsByJobId error:', err);
    return [];
  }
}

/**
 * Full-text search JT comments for a specific job.
 */
export async function searchJTComments(jobId: string, query: string): Promise<any[]> {
  try {
    const { data, error } = await getSupabase()
      .from('jt_comments')
      .select('id, job_id, target_type, target_id, message, name, is_pinned, created_at')
      .eq('job_id', jobId)
      .textSearch('message', query, { type: 'websearch' })
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('searchJTComments error:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('searchJTComments error:', err);
    return [];
  }
}

/**
 * Get JT daily logs for a specific job.
 */
export async function getJTDailyLogsByJobId(jobId: string, limit = 500): Promise<any[]> {
  try {
    const { data, error } = await getSupabase()
      .from('jt_daily_logs')
      .select('id, job_id, date, notes, assigned_member_names, created_at')
      .eq('job_id', jobId)
      .order('date', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('getJTDailyLogsByJobId error:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('getJTDailyLogsByJobId error:', err);
    return [];
  }
}


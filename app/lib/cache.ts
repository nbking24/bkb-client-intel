/**
 * Cache utility layer for BKB Client Intel
 *
 * Provides read/write helpers for the Supabase cache tables.
 * Agents call these instead of hitting JT/GHL APIs directly.
 *
 * Pattern:
 *   1. Check cache (is data present and fresh?)
 *   2. If yes → return cached data instantly
 *   3. If no → fall back to live API, then upsert into cache
 */

import { createServerClient } from './supabase';

// ============================================================
// FRESHNESS THRESHOLDS (milliseconds)
// ============================================================

const FRESH_THRESHOLD = {
  jt_jobs: 60 * 60 * 1000,         // 1 hour
  jt_tasks: 60 * 60 * 1000,        // 1 hour
  jt_comments: 60 * 60 * 1000,     // 1 hour
  jt_daily_logs: 2 * 60 * 60 * 1000, // 2 hours
  jt_time_entries: 4 * 60 * 60 * 1000, // 4 hours
  jt_cost_items: 4 * 60 * 60 * 1000,  // 4 hours
  jt_documents: 4 * 60 * 60 * 1000,   // 4 hours
  jt_members: 24 * 60 * 60 * 1000,    // 24 hours
  ghl_contacts: 60 * 60 * 1000,    // 1 hour
  ghl_messages: 60 * 60 * 1000,    // 1 hour
  ghl_notes: 2 * 60 * 60 * 1000,   // 2 hours
  ghl_opportunities: 2 * 60 * 60 * 1000, // 2 hours
} as const;

type CacheTable = keyof typeof FRESH_THRESHOLD;

// ============================================================
// FRESHNESS CHECK
// ============================================================

/**
 * Check if cached data for a given table + filter is fresh.
 * Returns { isFresh, count, oldestSyncedAt }
 */
export async function checkCacheFreshness(
  table: CacheTable,
  filterColumn: string,
  filterValue: string
): Promise<{ isFresh: boolean; count: number; oldestSyncedAt: string | null }> {
  try {
    const supabase = createServerClient();
    const threshold = new Date(Date.now() - FRESH_THRESHOLD[table]).toISOString();

    // Count total cached rows
    const { count: totalCount } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(filterColumn, filterValue);

    if (!totalCount || totalCount === 0) {
      return { isFresh: false, count: 0, oldestSyncedAt: null };
    }

    // Count rows that are still fresh
    const { count: freshCount } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(filterColumn, filterValue)
      .gte('synced_at', threshold);

    // Find oldest synced_at
    const { data: oldest } = await supabase
      .from(table)
      .select('synced_at')
      .eq(filterColumn, filterValue)
      .order('synced_at', { ascending: true })
      .limit(1)
      .single();

    return {
      isFresh: freshCount === totalCount && totalCount > 0,
      count: totalCount || 0,
      oldestSyncedAt: oldest?.synced_at || null,
    };
  } catch (err) {
    console.warn(`[cache] Freshness check failed for ${table}:`, err);
    return { isFresh: false, count: 0, oldestSyncedAt: null };
  }
}

// ============================================================
// GENERIC CACHE READ
// ============================================================

/**
 * Read from cache table with filters. Returns rows or empty array.
 */
export async function readCache<T = any>(
  table: string,
  filters: Record<string, string>,
  options?: { orderBy?: string; ascending?: boolean; limit?: number }
): Promise<T[]> {
  try {
    const supabase = createServerClient();
    let query = supabase.from(table).select('*');

    for (const [col, val] of Object.entries(filters)) {
      query = query.eq(col, val);
    }

    if (options?.orderBy) {
      query = query.order(options.orderBy, { ascending: options.ascending ?? false });
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    if (error) {
      console.warn(`[cache] Read failed for ${table}:`, error.message);
      return [];
    }
    return (data as T[]) || [];
  } catch (err) {
    console.warn(`[cache] Read exception for ${table}:`, err);
    return [];
  }
}

// ============================================================
// GENERIC CACHE WRITE (UPSERT)
// ============================================================

/**
 * Upsert rows into a cache table. Uses the `id` column as conflict target.
 */
export async function writeCache(
  table: string,
  rows: Record<string, any>[],
  options?: { onConflict?: string }
): Promise<{ success: boolean; count: number; error?: string }> {
  if (!rows || rows.length === 0) {
    return { success: true, count: 0 };
  }

  try {
    const supabase = createServerClient();

    // Stamp synced_at on every row
    const stamped = rows.map((r) => ({
      ...r,
      synced_at: new Date().toISOString(),
    }));

    // Upsert in batches of 500 (Supabase limit)
    const BATCH_SIZE = 500;
    let totalUpserted = 0;

    for (let i = 0; i < stamped.length; i += BATCH_SIZE) {
      const batch = stamped.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from(table)
        .upsert(batch, { onConflict: options?.onConflict || 'id' });

      if (error) {
        console.error(`[cache] Write batch failed for ${table}:`, error.message);
        return { success: false, count: totalUpserted, error: error.message };
      }
      totalUpserted += batch.length;
    }

    return { success: true, count: totalUpserted };
  } catch (err: any) {
    console.error(`[cache] Write exception for ${table}:`, err);
    return { success: false, count: 0, error: err.message };
  }
}

// ============================================================
// DELETE STALE CACHE (for cleanup)
// ============================================================

/**
 * Delete cached rows for a specific entity before re-populating.
 * Useful for deep syncs where we want a clean slate for one job.
 */
export async function clearCacheForEntity(
  table: string,
  filterColumn: string,
  filterValue: string
): Promise<void> {
  try {
    const supabase = createServerClient();
    await supabase.from(table).delete().eq(filterColumn, filterValue);
  } catch (err) {
    console.warn(`[cache] Clear failed for ${table}:`, err);
  }
}

// ============================================================
// SYNC STATE HELPERS
// ============================================================

export interface SyncState {
  id: string;
  entity_type: string;
  entity_id: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  stage: number;
  started_at: string;
  completed_at: string | null;
  items_processed: number;
  error_message: string | null;
  retry_count: number;
}

/**
 * Get the most recent sync state for an entity.
 */
export async function getLatestSyncState(
  entityType: string,
  entityId?: string
): Promise<SyncState | null> {
  try {
    const supabase = createServerClient();
    let query = supabase
      .from('sync_state')
      .select('*')
      .eq('entity_type', entityType)
      .order('created_at', { ascending: false })
      .limit(1);

    if (entityId) {
      query = query.eq('entity_id', entityId);
    }

    const { data } = await query.single();
    return data as SyncState | null;
  } catch {
    return null;
  }
}

/**
 * Create a new sync state record.
 */
export async function createSyncState(
  entityType: string,
  entityId: string | null,
  initiatedBy: string = 'agent'
): Promise<SyncState | null> {
  try {
    const supabase = createServerClient();
    const { data } = await supabase
      .from('sync_state')
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        status: 'in_progress',
        stage: 1,
        initiated_by: initiatedBy,
      })
      .select()
      .single();
    return data as SyncState | null;
  } catch {
    return null;
  }
}

/**
 * Update an existing sync state record.
 */
export async function updateSyncState(
  syncId: string,
  updates: Partial<Pick<SyncState, 'status' | 'stage' | 'items_processed' | 'error_message' | 'completed_at' | 'retry_count'>>
): Promise<void> {
  try {
    const supabase = createServerClient();
    await supabase.from('sync_state').update(updates).eq('id', syncId);
  } catch (err) {
    console.warn('[cache] Failed to update sync state:', err);
  }
}

// ============================================================
// BACKGROUND SYNC TRIGGER
// ============================================================

/**
 * Fire-and-forget trigger for a background sync.
 * Uses the internal API endpoint. Won't block the caller.
 */
export function triggerBackgroundSync(jobId: string, stage: number = 1): void {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  fetch(`${baseUrl}/api/sync/job/${jobId}?stage=${stage}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }).catch((err) => {
    console.warn(`[cache] Background sync trigger failed for job ${jobId}:`, err);
  });
}

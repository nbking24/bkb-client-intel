/**
 * Cache utility layer for BKB Client Intel
 *
 * Only caches data that exceeds API pagination limits:
 *   - JT comments (messages) & daily logs
 *   - GHL messages & notes
 *
 * Everything else (jobs, tasks, cost items, contacts, etc.)
 * is read live from the respective APIs.
 *
 * Agents read messages/notes ONLY from the database (never the live API)
 * to avoid duplication. A daily sync agent + force-sync endpoint
 * keeps the database current.
 */

import { createServerClient } from './supabase';

// ============================================================
// VALID CACHE TABLES
// ============================================================

export type CacheTable = 'jt_comments' | 'jt_daily_logs' | 'ghl_messages' | 'ghl_notes';

// ============================================================
// GENERIC CACHE READ
// ============================================================

/**
 * Read from cache table with filters. Returns rows or empty array.
 */
export async function readCache<T = any>(
  table: CacheTable | 'sync_state',
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
  table: CacheTable,
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
// DELETE STALE CACHE (for cleanup before re-populating)
// ============================================================

export async function clearCacheForEntity(
  table: CacheTable,
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

// @ts-nocheck
/**
 * Past-Client Outreach helpers.
 *
 * Shared logic for the bulk past-client personal text campaign:
 *   - Pulling the next contact to send
 *   - Recording sends, replies, opt-outs
 *   - Detecting opt-out language
 *
 * The actual send happens outside this module (iMessage via AppleScript on
 * Nathan's Mac). Reply capture runs outside too (chat.db scanner on the Mac).
 * This module is the database gateway everything else talks to.
 */
import { getSupabase } from '../supabase';

const OPT_OUT_PATTERNS = [
  /\bstop\b/i,
  /\bunsubscribe\b/i,
  /\bopt\s*out\b/i,
  /\bremove\s+me\b/i,
  /\bdon'?t\s+(text|contact|message|call)\b/i,
  /\bdo\s+not\s+(text|contact|message|call)\b/i,
  /\bno\s+more\s+(texts?|messages?)\b/i,
  /\bleave\s+me\s+alone\b/i,
];

export function isOptOut(text: string): boolean {
  if (!text) return false;
  return OPT_OUT_PATTERNS.some((p) => p.test(text));
}

/** Normalize to 10 digits; returns null if not a valid US phone. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (d.length === 10) return d;
  return null;
}

/**
 * Return the next queued contact to send, or null if the queue is empty or
 * we're outside business hours / over the daily cap.
 *
 * Business rules:
 *   - Only sends between 9am and 7pm in the caller's timezone (enforced by
 *     the caller — we don't know their clock here, so we just return the row).
 *   - Daily cap enforcement also happens caller-side (count of sends today).
 */
export async function getNextQueuedContact() {
  const supabase = getSupabase();
  // Priority ASC (lower = higher priority), then queued_at ASC for FIFO within a priority band.
  // FRIEND/SUB contacts are loaded with priority=10 so they send before past clients (priority=100).
  // Explicit field list — `.select('*')` was returning stale snapshots cached at the
  // PostgREST/Vercel layer for this query. Listing fields forces a fresh shape.
  const FIELDS = [
    'id', 'contact_key', 'ghl_contact_id',
    'first_name', 'last_name', 'full_name',
    'phone', 'phone_digits', 'email',
    'priority', 'stage', 'source', 'project_names',
    'queued_at', 'initial_sent_at',
    'initial_text_body', 'flag_notes',
  ].join(', ');
  const { data, error } = await supabase
    .from('past_client_outreach')
    .select(FIELDS)
    .eq('stage', 'queued')
    .not('phone_digits', 'is', null)
    .not('initial_text_body', 'is', null)
    .order('priority', { ascending: true, nullsFirst: false })
    .order('queued_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Count how many sends happened today (UTC). Used for the daily cap. */
export async function countSentToday(): Promise<number> {
  const supabase = getSupabase();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('past_client_outreach')
    .select('*', { count: 'exact', head: true })
    .gte('initial_sent_at', startOfDay.toISOString());
  if (error) throw error;
  return count || 0;
}

export async function markSent(contactKey: string, sentBody?: string) {
  const supabase = getSupabase();
  const update: any = {
    stage: 'initial_sent',
    initial_sent_at: new Date().toISOString(),
  };
  if (sentBody) update.initial_text_body = sentBody;

  // Two-step pattern instead of update().select().single() — that combination
  // can 500 with "Cannot coerce the result to a single JSON object" when the
  // PostgREST RETURNING shape doesn't match exactly. Splitting it makes the
  // failure modes explicit and prevents the sender from retrying on a
  // false-failure that actually succeeded.
  const { data: updated, error: updateErr } = await supabase
    .from('past_client_outreach')
    .update(update)
    .eq('contact_key', contactKey)
    .eq('stage', 'queued') // guard against double-sends
    .select('id');
  if (updateErr) throw updateErr;

  if (!updated || updated.length === 0) {
    // No row matched — either contact_key doesn't exist or stage already advanced.
    // The sender treats a null return as "already sent / not found" via 409.
    return null;
  }

  // Fetch the full row separately so callers can read back whatever they need
  const { data: row, error: selectErr } = await supabase
    .from('past_client_outreach')
    .select('*')
    .eq('id', updated[0].id)
    .maybeSingle();
  if (selectErr) throw selectErr;
  return row;
}

export async function recordReply(
  contactKey: string,
  replyText: string,
  replyAt?: string,
) {
  const supabase = getSupabase();
  const optedOut = isOptOut(replyText);
  const update: any = {
    reply_text: replyText,
    reply_received_at: replyAt || new Date().toISOString(),
    stage: optedOut ? 'opted_out' : 'replied',
  };
  if (optedOut) update.opted_out_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('past_client_outreach')
    .update(update)
    .eq('contact_key', contactKey)
    .select()
    .single();
  if (error) throw error;
  return { row: data, optedOut };
}

export async function markOptedOut(contactKey: string, reason?: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('past_client_outreach')
    .update({
      stage: 'opted_out',
      opted_out_at: new Date().toISOString(),
      internal_notes: reason || null,
    })
    .eq('contact_key', contactKey)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markSkipped(contactKey: string, reason?: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('past_client_outreach')
    .update({
      stage: 'skipped',
      internal_notes: reason || null,
    })
    .eq('contact_key', contactKey)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Called from /api/public/review-submit when a review gateway submission
 * comes in. If the contactId matches a past_client_outreach row, mark it
 * completed so the reminder automation stops.
 */
export async function markCompletedByContactKey(
  contactKey: string,
  submissionId: string,
) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('past_client_outreach')
    .update({
      stage: 'completed',
      form_completed_at: new Date().toISOString(),
      form_submission_id: submissionId,
    })
    .eq('contact_key', contactKey)
    .in('stage', ['queued', 'initial_sent', 'reminder_sent', 'email_sent', 'replied'])
    .select()
    .maybeSingle();
  if (error) {
    console.error('[pco] markCompletedByContactKey failed:', error);
    return null;
  }
  return data;
}

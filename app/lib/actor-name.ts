/**
 * Who did this? — display name for an audit trail.
 *
 * `app_users` is the canonical user directory (see app/lib/access.ts). The
 * older TEAM_USERS constant in constants.ts only knows the original four
 * people and has no row for Heather, so anything that reads a name from it
 * silently mislabels or blanks newer users. Server-side lookup by the
 * authenticated user id avoids both, and avoids trusting a name the client
 * sent about itself.
 *
 * Falls back to the raw user id, then to 'unknown', so an audit field is
 * never written empty.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export async function resolveActorName(
  supabase: SupabaseClient,
  userId: string | null | undefined,
): Promise<string> {
  const id = (userId || '').trim();
  if (!id) return 'unknown';
  try {
    const { data } = await supabase
      .from('app_users')
      .select('name')
      .eq('id', id)
      .maybeSingle();
    const name = (data as any)?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : id;
  } catch {
    return id;
  }
}

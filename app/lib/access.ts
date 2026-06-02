// ============================================================
// Access layer (server)
//
// `app_users` is the canonical user directory. The original four users were
// inserted by migration 018; everything since is managed through
// /dashboard/admin (create / edit / delete). There is intentionally no
// code-side fallback — a deleted row means the user no longer exists.
//
// Server-only: imports the service-role Supabase client. Do not import from
// client components — use /api/me instead.
// ============================================================

import { createServerClient } from './supabase';
import {
  DASHBOARDS,
  type AccessRole,
} from './access-registry';

export interface AppUser {
  id: string;
  name: string;
  initials: string;
  title: string | null;
  role: AccessRole;
  jtMembershipId: string | null;
  email: string | null;
  enabled: boolean;
  dashboards: string[];
  features: string[];
  overviewWidgets: string[];
  // Google account linkage (populated via /api/auth/google-connect)
  googleEmail: string | null;
  googleConnectedAt: string | null;
}

export interface EffectiveAccess extends AppUser {
  /** Dashboards the user may open, with owner-only pages folded in for owners. */
  effectiveDashboards: string[];
}

const VALID_ROLES: AccessRole[] = ['owner', 'admin', 'field_sup', 'field', 'custom'];

function coerceRole(role: string | null | undefined): AccessRole {
  return (VALID_ROLES as string[]).includes(role || '') ? (role as AccessRole) : 'custom';
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

function rowToUser(row: any): AppUser {
  const role = coerceRole(row.role);
  return {
    id: row.id,
    name: row.name || row.id,
    initials: row.initials || (row.name ? row.name.slice(0, 2).toUpperCase() : '??'),
    title: row.title ?? null,
    role,
    jtMembershipId: row.jt_membership_id ?? null,
    email: row.email ?? null,
    enabled: row.enabled ?? true,
    dashboards: asStringArray(row.dashboards),
    features: asStringArray(row.features),
    overviewWidgets: asStringArray(row.overview_widgets),
    googleEmail: row.google_email ?? null,
    googleConnectedAt: row.google_connected_at ?? null,
  };
}

function withEffective(user: AppUser): EffectiveAccess {
  const ownerOnlyIds = DASHBOARDS.filter((d) => d.ownerOnly).map((d) => d.id);
  let effectiveDashboards = [...user.dashboards];
  if (user.role === 'owner') {
    // Owners always see owner-only pages (e.g. Admin) regardless of stored config.
    for (const id of ownerOnlyIds) {
      if (!effectiveDashboards.includes(id)) effectiveDashboards.push(id);
    }
  } else {
    // Non-owners can never be granted owner-only pages.
    effectiveDashboards = effectiveDashboards.filter((id) => !ownerOnlyIds.includes(id));
  }
  return { ...user, effectiveDashboards };
}

/** All users from the DB (app_users is the canonical source of truth — the
 *  seed migration 018 inserted the original four). No code-side fallback so
 *  that deleting a user from the admin console actually removes them. */
export async function listAppUsers(): Promise<AppUser[]> {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase.from('app_users').select('*').order('name');
    if (!error && Array.isArray(data)) return data.map(rowToUser);
  } catch (err) {
    console.error('[access] listAppUsers DB error:', err);
  }
  return [];
}

export async function getAppUser(id: string): Promise<AppUser | null> {
  try {
    const supabase = createServerClient();
    const { data } = await supabase.from('app_users').select('*').eq('id', id).single();
    if (data) return rowToUser(data);
  } catch {
    // Row not found or DB error — caller treats as "user doesn't exist".
  }
  return null;
}

export async function getEffectiveAccess(id: string): Promise<EffectiveAccess | null> {
  const user = await getAppUser(id);
  if (!user) return null;
  return withEffective(user);
}

export interface UpsertUserInput {
  id: string;
  name: string;
  initials?: string;
  title?: string | null;
  role: AccessRole;
  jtMembershipId?: string | null;
  email?: string | null;
  enabled?: boolean;
  dashboards: string[];
  features: string[];
  overviewWidgets: string[];
}

export async function upsertAppUser(input: UpsertUserInput): Promise<AppUser> {
  const supabase = createServerClient();
  const initials = input.initials || input.name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  const row = {
    id: input.id,
    name: input.name,
    initials,
    title: input.title ?? null,
    role: input.role,
    jt_membership_id: input.jtMembershipId ?? null,
    email: input.email ?? null,
    enabled: input.enabled ?? true,
    dashboards: input.dashboards,
    features: input.features,
    overview_widgets: input.overviewWidgets,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('app_users')
    .upsert(row, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to save user: ${error.message}`);
  return rowToUser(data);
}

/** Slug-safe id from a display name, e.g. "Jane Smith" -> "jane". Falls back to
 *  a longer slug if the first name collides with an existing id. */
export function suggestUserId(name: string, existingIds: string[]): string {
  const base = (name.trim().split(/\s+/)[0] || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!existingIds.includes(base)) return base || 'user';
  const full = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (full && !existingIds.includes(full)) return full;
  let n = 2;
  while (existingIds.includes(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** Owner check used by admin API routes. */
export async function isOwner(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const u = await getAppUser(userId);
  return u?.role === 'owner';
}

// ============================================================
// Google OAuth — per-user refresh-token storage
// Helpers below are server-only and never expose the refresh token to clients;
// the token leaves the DB only via google-api.ts when fetching an access token.
// ============================================================

/** Refresh token for the given user, or null if Google isn't linked. */
export async function getUserGoogleRefreshToken(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const supabase = createServerClient();
    const { data } = await supabase
      .from('app_users')
      .select('google_refresh_token')
      .eq('id', userId)
      .single();
    return (data?.google_refresh_token as string | null) ?? null;
  } catch {
    return null;
  }
}

/** Save a freshly-issued Google refresh token + the linked account's email. */
export async function setUserGoogleLink(
  userId: string,
  refreshToken: string,
  email: string | null,
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from('app_users')
    .update({
      google_refresh_token: refreshToken,
      google_email: email,
      google_connected_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) throw new Error(`Failed to save Google link: ${error.message}`);
}

/** Remove the Google connection for a user (admin disconnect). */
export async function clearUserGoogleLink(userId: string): Promise<void> {
  const supabase = createServerClient();
  await supabase
    .from('app_users')
    .update({
      google_refresh_token: null,
      google_email: null,
      google_connected_at: null,
    })
    .eq('id', userId);
}

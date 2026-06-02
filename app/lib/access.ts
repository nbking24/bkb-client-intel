// ============================================================
// Access layer (server)
//
// Resolves the canonical user directory and each user's effective access by
// merging the DB-backed `app_users` table with the code-defined TEAM_USERS
// fallback. The DB is authoritative; code users that don't yet exist in the DB
// still resolve (so logins keep working even if the seed migration hasn't run).
//
// Server-only: imports the service-role Supabase client. Do not import from
// client components — use /api/me instead.
// ============================================================

import { createServerClient } from './supabase';
import { TEAM_USERS } from './constants';
import {
  presetFor,
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

/** Build an AppUser from the code-defined TEAM_USERS fallback (pre-migration
 *  or for any user not yet in the DB). Access defaults to the role preset. */
function codeFallbackUser(id: string): AppUser | null {
  const t = TEAM_USERS[id];
  if (!t) return null;
  const role = coerceRole(t.role);
  const preset = presetFor(role);
  return {
    id,
    name: t.name,
    initials: t.initials,
    title: null,
    role,
    jtMembershipId: t.membershipId || null,
    email: t.email || null,
    enabled: true,
    dashboards: preset.dashboards,
    features: preset.features,
    overviewWidgets: preset.overviewWidgets,
    googleEmail: null,
    googleConnectedAt: null,
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

/** All users, DB first, with any code-only users merged in. */
export async function listAppUsers(): Promise<AppUser[]> {
  const byId = new Map<string, AppUser>();
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase.from('app_users').select('*').order('name');
    if (!error && Array.isArray(data)) {
      for (const row of data) byId.set(row.id, rowToUser(row));
    }
  } catch (err) {
    console.error('[access] listAppUsers DB error:', err);
  }
  // Merge in any code users not present in the DB (keeps logins working
  // before/if the seed migration hasn't been applied).
  for (const id of Object.keys(TEAM_USERS)) {
    if (!byId.has(id)) {
      const u = codeFallbackUser(id);
      if (u) byId.set(id, u);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAppUser(id: string): Promise<AppUser | null> {
  try {
    const supabase = createServerClient();
    const { data } = await supabase.from('app_users').select('*').eq('id', id).single();
    if (data) return rowToUser(data);
  } catch {
    // fall through to code fallback
  }
  return codeFallbackUser(id);
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

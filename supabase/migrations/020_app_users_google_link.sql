-- 020_app_users_google_link.sql
-- Per-user Google OAuth linkage. Refresh tokens are stored on the user row so
-- the dashboard can fetch Gmail/Calendar data on behalf of each individual user
-- (instead of falling back to the owner's account). Set by
-- /api/auth/google-connect + /api/auth/google-callback; cleared by
-- /api/admin/users/google-disconnect.
alter table public.app_users
  add column if not exists google_refresh_token text,
  add column if not exists google_email         text,
  add column if not exists google_connected_at  timestamptz;

comment on column public.app_users.google_refresh_token is
  'Google OAuth refresh token used by google-api.ts to fetch this user''s Gmail/Calendar.';
comment on column public.app_users.google_email is
  'Display email of the Google account currently linked.';
comment on column public.app_users.google_connected_at is
  'Timestamp when the current Google account was last linked.';

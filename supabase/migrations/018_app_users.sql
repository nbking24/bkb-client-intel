-- 018_app_users.sql
--
-- User directory + per-user access control for the Operations Platform.
--
-- Until now the user list lived only in code (app/lib/constants.ts TEAM_USERS)
-- and navigation was gated by a single coarse role. This table makes users
-- DB-managed so the owner can onboard new employees and assign exactly which
-- dashboards, cross-cutting features, and Overview widgets each person sees —
-- all from the admin dashboard, with no code deploy.
--
-- Access is stored as three id arrays that reference the registries defined in
-- app/lib/access-registry.ts:
--   dashboards       -> top-level nav pages (overview, leads, invoicing, ...)
--   features         -> cross-cutting capabilities (ask_agent, report_issue, jt_write)
--   overview_widgets -> sections on the Overview page (kpis, calendar, all_tasks, ...)
--
-- The server merges this table with the code-defined users as a fallback, so
-- existing logins keep working even before the seed below runs.

create table if not exists public.app_users (
  id               text primary key,                       -- userId slug, e.g. 'nathan', 'jane'
  name             text not null,
  initials         text not null,
  title            text,                                   -- display title on the login screen
  role             text not null default 'custom',         -- owner|admin|field_sup|field|custom
  jt_membership_id text,                                   -- JobTread membership (for task/assignee lookups)
  email            text,
  enabled          boolean not null default true,
  dashboards       jsonb not null default '[]'::jsonb,
  features         jsonb not null default '[]'::jsonb,
  overview_widgets jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.app_users is
  'User directory + per-user dashboard/feature/widget access for the Operations Platform. Managed from /dashboard/admin.';

-- Seed the four existing code-defined users with access matching their current
-- role so behavior is unchanged on day one. ON CONFLICT DO NOTHING keeps this
-- safe to re-run and avoids clobbering any edits made later from the admin UI.
insert into public.app_users (id, name, initials, title, role, jt_membership_id, email, enabled, dashboards, features, overview_widgets)
values
  (
    'nathan', 'Nathan King', 'NK', 'Owner', 'owner',
    '22P5SRwhLaYf', 'nathan@brettkingbuilder.com', true,
    '["overview","leads","precon","estimate","invoicing","job-costing","bill-review","spec-writer","marketing","tickets","admin"]'::jsonb,
    '["ask_agent","report_issue","jt_write"]'::jsonb,
    '["quick_add","bill_review_banner","kpis","calendar","todays_focus","waiting_on","ar_reminders","all_tasks"]'::jsonb
  ),
  (
    'terri', 'Terri King', 'TK', 'Office Manager', 'admin',
    '22P5SpJkype2', null, true,
    '["overview","leads","precon","estimate","invoicing","job-costing","bill-review","spec-writer","marketing","tickets"]'::jsonb,
    '["ask_agent","report_issue","jt_write"]'::jsonb,
    '["quick_add","bill_review_banner","kpis","calendar","todays_focus","waiting_on","ar_reminders","all_tasks"]'::jsonb
  ),
  (
    'evan', 'Evan Harrington', 'EH', 'Lead Carpenter', 'field_sup',
    '22P5nJ7ncFj4', null, true,
    '["field"]'::jsonb,
    '["ask_agent"]'::jsonb,
    '[]'::jsonb
  ),
  (
    'josh', 'Josh King', 'JK', 'Project Manager', 'field_sup',
    '22P6GTEnhCre', null, true,
    '["field"]'::jsonb,
    '["ask_agent"]'::jsonb,
    '[]'::jsonb
  )
on conflict (id) do nothing;

-- 035_production_meetings.sql
--
-- Monday Production Meeting (dashboard: production-meeting). Same shape as the
-- planning meeting tables (031, 033), kept separate so each meeting has its own
-- open draft, history and "from last meeting" list.
-- Design: JobTread Assistant project doc
--   claude/BKB-Production-Meeting-Design-2026-10-12.md
--
-- production_meetings       One row per meeting. `brief` is the Production Brief
--                           snapshot (JobTread + the Hub's money caches). The money
--                           detail inside it is stripped by the API for non-owners.
--                           `state` is everything typed or clicked. `write_log`
--                           records each JobTread write made on Confirm.
-- production_meeting_tasks  Every JobTread task created by a meeting, for next
--                           week's "kept X of Y".
--
-- Server-side access only (service role). RLS on, no policies.
--
-- Applied to production 2026-10-12 via MCP apply_migration.

create table if not exists public.production_meetings (
  id            uuid primary key default gen_random_uuid(),
  meeting_date  date not null,
  status        text not null default 'draft' check (status in ('draft','confirmed','archived')),
  brief         jsonb,
  brief_at      timestamptz,
  state         jsonb not null default '{}'::jsonb,
  plus          text,
  delta         text,
  write_log     jsonb not null default '[]'::jsonb,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz not null default now(),
  confirmed_by  text,
  confirmed_at  timestamptz
);
create index if not exists production_meetings_date_idx on public.production_meetings (meeting_date desc);
create unique index if not exists production_meetings_one_draft on public.production_meetings ((status)) where status = 'draft';

create table if not exists public.production_meeting_tasks (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references public.production_meetings(id) on delete cascade,
  job_id        text not null,
  jt_task_id    text not null,
  kind          text not null check (kind in ('commitment','roadblock')),
  name          text not null,
  assignee      text,
  due_date      date,
  source        text not null default 'meeting',
  created_at    timestamptz not null default now()
);
create index if not exists production_meeting_tasks_meeting_idx on public.production_meeting_tasks (meeting_id);
create index if not exists production_meeting_tasks_job_idx on public.production_meeting_tasks (job_id);
create unique index if not exists production_meeting_tasks_jt_idx on public.production_meeting_tasks (jt_task_id);

alter table public.production_meetings enable row level security;
alter table public.production_meeting_tasks enable row level security;

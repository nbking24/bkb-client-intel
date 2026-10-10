-- 031_planning_meetings.sql
--
-- Tuesday Planning Meeting (dashboard: planning-meeting).
-- Design: JobTread Assistant project doc
--   claude/BKB-Meetings-and-Job-Setup-Game-Plan-2026-10-10.md
--
-- planning_meetings      One row per meeting. `brief` is the Prep Brief
--                        snapshot read from JobTread (refreshed on demand and
--                        by the Tuesday cron). `state` is everything typed or
--                        clicked during prep and the meeting (flag handled
--                        marks, per-job notes, new commitments and roadblocks,
--                        Done / New date / Drop decisions, gate ticks, marker
--                        dates). `write_log` records each JobTread write made
--                        on Confirm so a retry never writes twice.
-- planning_meeting_tasks Every JobTread task created by a meeting, so the next
--                        meeting can show "from last meeting" with live status
--                        and the share kept on time.
-- planning_job_holds     On-hold switch per job (Hub only), with next-touch
--                        date and reason. Persists across meetings.
--
-- Server-side access only (service role). RLS on, no policies.
--
-- Applied to production 2026-10-10 via MCP apply_migration.

create table if not exists public.planning_meetings (
  id            uuid primary key default gen_random_uuid(),
  meeting_date  date not null,
  status        text not null default 'draft' check (status in ('draft','confirmed')),
  brief         jsonb,
  brief_at      timestamptz,
  state         jsonb not null default '{}'::jsonb,
  plus          text,
  delta         text,
  transcript    text,
  transcript_result jsonb,
  write_log     jsonb not null default '[]'::jsonb,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz not null default now(),
  confirmed_by  text,
  confirmed_at  timestamptz
);
create index if not exists planning_meetings_date_idx on public.planning_meetings (meeting_date desc);
-- At most one open draft at a time.
create unique index if not exists planning_meetings_one_draft on public.planning_meetings ((status)) where status = 'draft';

create table if not exists public.planning_meeting_tasks (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references public.planning_meetings(id) on delete cascade,
  job_id        text not null,
  jt_task_id    text not null,
  kind          text not null check (kind in ('commitment','roadblock')),
  name          text not null,
  assignee      text,
  due_date      date,
  source        text not null default 'meeting',  -- meeting | flag | transcript
  created_at    timestamptz not null default now()
);
create index if not exists planning_meeting_tasks_meeting_idx on public.planning_meeting_tasks (meeting_id);
create index if not exists planning_meeting_tasks_job_idx on public.planning_meeting_tasks (job_id);
create unique index if not exists planning_meeting_tasks_jt_idx on public.planning_meeting_tasks (jt_task_id);

create table if not exists public.planning_job_holds (
  job_id        text primary key,
  job_name      text,
  on_hold       boolean not null default true,
  next_touch    date,
  reason        text,
  set_by        text,
  set_at        timestamptz not null default now()
);

alter table public.planning_meetings enable row level security;
alter table public.planning_meeting_tasks enable row level security;
alter table public.planning_job_holds enable row level security;

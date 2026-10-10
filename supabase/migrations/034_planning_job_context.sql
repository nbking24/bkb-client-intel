-- 034_planning_job_context.sql
--
-- planning_job_context   The team's corrections to Claude's read of a job, and
--                        standing context Claude cannot see in JobTread.
--   kind 'dismiss'  a line Claude wrote that is wrong or already handled
--                   (target = the line, note = why). Claude is told not to
--                   raise it again unless something newer in JobTread reopens it.
--   kind 'context'  a standing fact about the job (note only).
-- Rows stay until someone removes them (removed_at set, never deleted).
-- Corrections added during a meeting go into that meeting's daily log at Confirm.
--
-- Server-side access only (service role). RLS on, no policies.
--
-- Applied to production 2026-10-10 via MCP apply_migration.

create table if not exists public.planning_job_context (
  id               uuid primary key default gen_random_uuid(),
  job_id           text not null,
  kind             text not null check (kind in ('dismiss','context')),
  target           text,
  note             text,
  meeting_id       uuid references public.planning_meetings(id) on delete set null,
  created_by       text,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_by       text
);
create index if not exists planning_job_context_job_idx on public.planning_job_context (job_id) where removed_at is null;

alter table public.planning_job_context enable row level security;

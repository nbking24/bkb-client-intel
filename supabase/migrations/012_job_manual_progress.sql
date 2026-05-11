-- 012_job_manual_progress.sql
--
-- Per-job manual % complete override. BKB's JT schedules don't always
-- reflect on-the-ground progress accurately (tasks left open, sub-tasks
-- bundled, etc.), so the Job Costing AI analysis was getting an unreliable
-- "% complete" signal. Nathan can now set the value manually per job and
-- the dashboard / AI use that instead.
--
-- Keyed on JT job id. One row per job (PK). Last writer wins — we keep
-- set_by + set_at + optional notes so the audit trail is on-row.

create table if not exists public.job_manual_progress (
  job_id text primary key,
  percent_complete integer not null check (percent_complete >= 0 and percent_complete <= 100),
  set_by text,
  set_at timestamptz not null default now(),
  notes text
);

create index if not exists idx_job_manual_progress_set_at
  on public.job_manual_progress(set_at desc);

-- 013_job_cost_code_progress.sql
--
-- Per-cost-code % complete override on top of the job-level override added
-- in migration 012. Nathan can mark a single category (e.g. "04 Framing")
-- 100% done, or set partial progress per code, and the AI cost analysis
-- factors those category-level numbers into its assessment.
--
-- Composite primary key on (job_id, cost_code_number) — one row per
-- category per job. cost_code_name is denormalized for display when the
-- JT round-trip is skipped or failing.

create table if not exists public.job_cost_code_progress (
  job_id text not null,
  cost_code_number text not null,
  cost_code_name text,
  percent_complete integer not null check (percent_complete >= 0 and percent_complete <= 100),
  set_by text,
  set_at timestamptz not null default now(),
  notes text,
  primary key (job_id, cost_code_number)
);

create index if not exists idx_cost_code_progress_job
  on public.job_cost_code_progress(job_id);

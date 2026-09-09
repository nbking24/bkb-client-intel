-- 030_production_sales_projections.sql
--
-- Manual "projected contract total" per job for the Production Schedule
-- Sales Outlook. Jobs on the production schedule that have no approved
-- Construction Contract yet usually also have no built budget (their JT
-- budget total is just the design fee), which understates the projected
-- sales line. Nathan enters the expected contract value here; the hub uses
-- it ONLY while the job has no approved contract in JobTread. Once a
-- contract is approved, the JT budget total takes over automatically and
-- this row is kept for history but no longer drives the number.
--
-- Keyed on JT job id. One row per job. Last writer wins; set_by/set_at on-row.
-- Server-side access only (service role) — RLS on, no policies.
--
-- Applied to production 2026-09-09 via MCP apply_migration.

create table if not exists public.production_sales_projections (
  job_id text primary key,
  projected_total numeric(14,2) not null check (projected_total >= 0),
  note text,
  set_by text,
  set_at timestamptz not null default now()
);

alter table public.production_sales_projections enable row level security;

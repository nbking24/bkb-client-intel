-- 024_job_costing_summary_cache.sql
-- Snapshot of the job costing dashboard list payload. One row, keyed by
-- a fixed sentinel ('summary'), so the list page can load instantly from
-- the cache and only recompute against JT when the operator clicks
-- Refresh. Mirrors the per-job job_costing_cache table but for the org
-- wide summary.
create table if not exists public.job_costing_summary_cache (
  key          text primary key default 'summary',
  payload      jsonb not null,
  computed_at  timestamptz not null default now(),
  compute_ms   integer
);

comment on table public.job_costing_summary_cache is
  'Cached payload for GET /api/dashboard/job-costing. Lives forever until force-refreshed - Nathan asked the page never to auto-refresh.';

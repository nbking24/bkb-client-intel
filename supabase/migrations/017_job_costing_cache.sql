-- 017_job_costing_cache.sql
--
-- Cache the computed job-costing detail response per job so that
-- subsequent dashboard loads serve from Supabase in ~100ms instead
-- of re-running the dozens of PAVE round-trips (which can take
-- 30-60 seconds on large jobs with many documents and line items).
--
-- The detail route checks this table first. If `computed_at` is
-- within the freshness window (5 min default), the cached payload
-- is returned with a `cachedAt` indicator. Otherwise the route
-- computes fresh and writes back. A `?refresh=1` query param
-- bypasses the cache entirely for force-refresh.

create table if not exists public.job_costing_cache (
  job_id text primary key,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  -- Diagnostic: how long the compute took in ms. Useful for sanity-
  -- checking whether the new caching is actually helping over time.
  compute_ms integer
);

comment on table public.job_costing_cache is
  'Cached per-job detail payload for the Job Costing dashboard. 5-min TTL by default; ?refresh=1 forces re-compute.';

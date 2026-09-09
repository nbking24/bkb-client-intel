-- 030_company_financials_snapshot.sql
--
-- Company Financials dashboard (owner-only) storage.
--
-- The Hub has no QuickBooks OAuth of its own: QB is only reachable from a
-- Cowork session holding the QB MCP connection. So the QB-derived figures
-- are pushed IN by a scheduled Claude task (POST
-- /api/dashboard/company-financials/snapshot, Bearer CRON_SECRET) and this
-- table holds the latest payload. The page reads this snapshot for QB
-- numbers and joins LIVE JobTread data (job_costing_summary_cache) for the
-- per-job profitability drawer.
--
-- One row per key: 'current' holds the live dashboard payload. Keeping it
-- keyed (rather than a single row) leaves room for dated archives later.
create table if not exists public.company_financials_snapshot (
  key          text primary key,
  payload      jsonb not null,
  computed_at  timestamptz not null default now(),
  -- Free-text provenance, e.g. 'cowork-scheduled-task' or 'manual'.
  source       text
);

comment on table public.company_financials_snapshot is
  'QuickBooks-derived company financials for the owner-only Company Financials dashboard. Written by a scheduled Cowork task because the Hub has no QB OAuth; read by GET /api/dashboard/company-financials.';

-- Server-side access only (service-role key bypasses RLS). RLS on with no
-- policies = deny-all for anon, matching the rest of the schema.
alter table public.company_financials_snapshot enable row level security;

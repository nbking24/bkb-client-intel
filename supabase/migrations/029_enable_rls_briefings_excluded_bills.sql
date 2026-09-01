-- 029_enable_rls_briefings_excluded_bills.sql
--
-- Supabase security advisor (email to Nathan, 2026-08-31): four tables were
-- created without Row-Level Security, leaving them readable/writable by
-- anyone holding the project URL + anon key via the public REST endpoint:
--
--   daily_briefings, briefing_email_dismissals, briefing_monitored_jobs
--   (from the daily-briefing feature) and excluded_vendor_bills (bill review).
--
-- The Hub only ever accesses these tables server-side through the
-- service-role key, which bypasses RLS — so enabling RLS with no policies is
-- a deny-all for the anon role and a zero-behavior change for the app. This
-- matches the posture of the rest of the schema (RLS on, no policies; the
-- only anon-accessed tables, raffle_entries and agent_dismissals, carry
-- explicit policies).
--
-- Applied to production 2026-09-01 via MCP apply_migration.

alter table public.daily_briefings enable row level security;
alter table public.briefing_email_dismissals enable row level security;
alter table public.briefing_monitored_jobs enable row level security;
alter table public.excluded_vendor_bills enable row level security;

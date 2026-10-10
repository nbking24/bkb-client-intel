-- 032_planning_job_holds_held_since.sql
--
-- When the current hold started. Lets the meeting's daily log tell a real
-- change ("put on hold", "taken off hold") from a job that was put on hold
-- and woken again within the same meeting, which should log nothing.
--
-- Applied to production 2026-10-10 via MCP apply_migration.

alter table public.planning_job_holds add column if not exists held_since timestamptz;
update public.planning_job_holds set held_since = set_at where on_hold and held_since is null;

-- 033_planning_meetings_archived_status.sql
--
-- Adds an 'archived' status for planning meetings that should drop out of the
-- Hub (test runs, mistakes) without deleting their history. Only 'draft' and
-- 'confirmed' meetings are read by the page.
--
-- Applied to production 2026-10-10 via MCP apply_migration.

alter table public.planning_meetings drop constraint if exists planning_meetings_status_check;
alter table public.planning_meetings add constraint planning_meetings_status_check check (status in ('draft','confirmed','archived'));

-- Marketing Photo Engine: nightly change detector
--
-- Change detection used to happen inside the heavy weekly Cowork/Claude task,
-- which meant paying to scan every opted in job even when nothing had changed.
-- This migration adds the flags a cheap nightly Vercel cron writes so the AI
-- processor only works the jobs that actually have new items. A job that has
-- never been built (no marketing_photo_doc_state row) gets a full scan the
-- first time; everything after that is a delta of just the new items.
--
-- Style note: no em dashes in this file. The team dislikes them.

-- Detector flags on the selected-jobs table. Idempotent so re-running is safe.
alter table marketing_photo_selected_jobs
  add column if not exists needs_processing boolean not null default true;

alter table marketing_photo_selected_jobs
  add column if not exists scan_mode text;              -- 'full' (first time) or 'delta' (new items only)

alter table marketing_photo_selected_jobs
  add column if not exists last_checked_at timestamptz; -- when the detector last looked at this job

alter table marketing_photo_selected_jobs
  add column if not exists last_processed_at timestamptz; -- when the AI processor last built this job

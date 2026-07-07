-- Marketing Photo Engine (Phase 1) - manual job selection
--
-- The Photo Engine should process only the jobs a user has manually selected in
-- the Hub, not a JobTread custom field. This table is the source of truth for
-- which active jobs are opted in. The Hub upserts a row when a user includes or
-- removes a job, and the queue endpoint checks it before enqueuing a run.
--
-- Style note: no em dashes in this file. The team dislikes them.

create table if not exists marketing_photo_selected_jobs (
  job_id text primary key,
  job_number text,
  job_name text,
  folder_name text,
  included boolean not null default true,
  updated_at timestamptz default now()
);

-- RLS: our server uses the service_role key which bypasses RLS. Mirror the
-- migration 003 pattern so anon reads are allowed and service role has full
-- access.
alter table marketing_photo_selected_jobs enable row level security;
create policy "Allow anon read" on marketing_photo_selected_jobs for select using (true);
create policy "Allow service role all" on marketing_photo_selected_jobs for all using (true) with check (true);

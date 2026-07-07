-- Marketing Photo Engine (Phase 1)
--
-- The Hub is the lightweight control surface. The heavy media work (pulling
-- photos/videos/documents from JobTread, vision curation, video transcoding,
-- building the Word "Marketing Project Profile", and uploading a per-job folder
-- to the web designer's FTP) runs in a Cowork/Claude scheduled task OUTSIDE the
-- Hub. These tables let the Hub queue on-demand runs, mirror run status, and
-- gate the notify email that goes to the marketing advisor.
--
-- Style note: no em dashes in this file. The team dislikes them.

create table if not exists marketing_photo_runs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  job_number text,
  job_name text,
  folder_name text,
  trigger text not null default 'manual',        -- manual | scheduled
  status text not null default 'queued',         -- queued | processing | complete | error
  photos_added int default 0,
  videos_added int default 0,
  profile_updated boolean default false,
  change_summary text,
  email_status text default 'draft',             -- draft | held | sent | skipped
  error text,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists idx_marketing_photo_runs_job_id on marketing_photo_runs(job_id);
create index if not exists idx_marketing_photo_runs_created on marketing_photo_runs(created_at desc);

create table if not exists marketing_photo_settings (
  id int primary key default 1,
  live_mode boolean not null default false,
  recipient text not null default 'mike@lighthoused.com',
  updated_at timestamptz default now(),
  constraint marketing_photo_settings_single_row check (id = 1)
);

-- Seed the single settings row (draft mode by default).
insert into marketing_photo_settings (id, live_mode, recipient)
values (1, false, 'mike@lighthoused.com')
on conflict (id) do nothing;

-- RLS: our server uses the service_role key which bypasses RLS. Mirror the
-- project_events pattern so anon reads are allowed and service role has full
-- access.
alter table marketing_photo_runs enable row level security;
create policy "Allow anon read" on marketing_photo_runs for select using (true);
create policy "Allow service role all" on marketing_photo_runs for all using (true) with check (true);

alter table marketing_photo_settings enable row level security;
create policy "Allow anon read" on marketing_photo_settings for select using (true);
create policy "Allow service role all" on marketing_photo_settings for all using (true) with check (true);

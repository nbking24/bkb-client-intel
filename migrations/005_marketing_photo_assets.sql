-- Marketing Photo Engine: asset ledger + permanent exclusions
--
-- The photo engine pulls media from JobTread and uploads a per-job folder to
-- the web designer's FTP. This table maps each uploaded FTP file back to the
-- JobTread file it came from, so the Hub folder browser can turn a delete into
-- a durable exclusion. When Terri deletes a photo, we flip the matching asset
-- to excluded and the scheduled run never re-adds that JobTread file again.
--
-- The durable exclusion key is jobtread_file_id. The (folder_name, ftp_filename)
-- pair is how the delete route finds the row, since that is all the FTP path
-- gives us at delete time.
--
-- Style note: no em dashes in this file. The team dislikes them.

create table if not exists marketing_photo_assets (
  id uuid primary key default gen_random_uuid(),
  job_id text,
  folder_name text not null,          -- top-level job folder, e.g. "Berntsen-Renovation"
  ftp_filename text not null,         -- the file's base name within its job folder
  jobtread_file_id text,              -- the JobTread file id this upload came from
  kind text,                          -- finished | before | progress | video | doc
  excluded boolean not null default false,
  created_at timestamptz default now(),
  excluded_at timestamptz,
  unique (folder_name, ftp_filename)
);

create index if not exists idx_marketing_photo_assets_job_id on marketing_photo_assets(job_id);
create index if not exists idx_marketing_photo_assets_folder_excluded on marketing_photo_assets(folder_name, excluded);

-- RLS: our server uses the service_role key which bypasses RLS. Mirror the
-- migration 003 pattern so anon reads are allowed and service role has full
-- access.
alter table marketing_photo_assets enable row level security;
create policy "Allow anon read" on marketing_photo_assets for select using (true);
create policy "Allow service role all" on marketing_photo_assets for all using (true) with check (true);

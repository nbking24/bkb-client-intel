-- Marketing Photo Engine: processor support (living document + preview routing)
--
-- Two changes here. First, a preview recipient on the settings row so that while
-- the engine is still in draft mode the composed email goes to Nathan for review
-- instead of nowhere. Second, a per-job living-document state table so the
-- Cowork/Claude processor can remember what each job's Marketing Project Profile
-- currently shows and keep a running "what's new" log across cycles.
--
-- Style note: no em dashes in this file. The team dislikes them.

-- Preview recipient for draft-mode sends (defaults to Nathan).
alter table marketing_photo_settings
  add column if not exists preview_recipient text not null default 'nathan@brettkingbuilder.com';

-- Living-document tracking, one row per job. The processor upserts this each run
-- so it knows what the profile already reflects and what changed this cycle.
create table if not exists marketing_photo_doc_state (
  job_id text primary key,
  folder_name text,
  content jsonb not null default '{}'::jsonb,        -- what the profile currently shows: change orders, photo asset ids, status, videos, plans
  whats_new_log jsonb not null default '[]'::jsonb,  -- running dated list of what changed each cycle
  doc_version int not null default 1,
  updated_at timestamptz default now()
);

-- RLS: our server uses the service_role key which bypasses RLS. Mirror the
-- migration 003 pattern so anon reads are allowed and service role has full
-- access.
alter table marketing_photo_doc_state enable row level security;
create policy "Allow anon read" on marketing_photo_doc_state for select using (true);
create policy "Allow service role all" on marketing_photo_doc_state for all using (true) with check (true);

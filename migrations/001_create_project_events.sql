-- Project Memory Layer (PML) — project_events table
-- Run this in Supabase SQL Editor to create the table

create table if not exists project_events (
  id uuid primary key default gen_random_uuid(),
  job_id text,
  job_name text,
  job_number text,
  channel text not null check (channel in ('gmail', 'jobtread', 'text', 'phone', 'in_person', 'meeting', 'manual_note')),
  event_type text not null check (event_type in ('message_sent', 'message_received', 'meeting_held', 'decision_made', 'question_asked', 'question_answered', 'commitment_made', 'status_update', 'note')),
  summary text not null,
  detail text,
  participants text[],
  source_ref jsonb,
  related_event_id uuid references project_events(id),
  open_item boolean default false,
  open_item_description text,
  resolved boolean default false,
  resolved_at timestamptz,
  resolved_note text,
  auto_resolved boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes for common query patterns
create index if not exists idx_project_events_job_id on project_events(job_id);
create index if not exists idx_project_events_open_items on project_events(open_item, resolved) where open_item = true and resolved = false;
create index if not exists idx_project_events_channel on project_events(channel);
create index if not exists idx_project_events_created on project_events(created_at desc);
create index if not exists idx_project_events_source_ref on project_events using gin(source_ref);

-- RLS: Disable for service-role access (our app uses service_role key)
alter table project_events enable row level security;

-- Allow service role full access (bypasses RLS automatically)
-- Allow anon key read-only access (for future client-side reads)
create policy "Allow anon read" on project_events
  for select using (true);

create policy "Allow service role all" on project_events
  for all using (true) with check (true);

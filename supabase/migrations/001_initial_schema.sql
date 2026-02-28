-- ============================================================
-- BKB Operations Platform - Initial Schema
-- Run this in your Supabase SQL Editor after creating the project
-- ============================================================

-- Enable pgvector for document intelligence (Phase 2)
create extension if not exists vector;

-- ============================================================
-- USERS & AUTH
-- ============================================================

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  role text not null check (role in ('owner', 'admin', 'field_sup', 'field')),
  jt_membership_id text,          -- JobTread membership ID
  ghl_user_id text,               -- GHL user ID
  dashboard_scope text not null default 'limited'
    check (dashboard_scope in ('full', 'office', 'field_sup', 'limited')),
  created_at timestamptz default now()
);

-- Seed the 5 dashboard users + Brett (sales)
insert into public.users (email, name, role, jt_membership_id, ghl_user_id, dashboard_scope) values
  ('nathan@brettkingbuilder.com', 'Nathan King', 'owner', '22P5SRxZKiP7', 'nSwKWyjOFCRbopatJI36', 'full'),
  ('terri@brettkingbuilder.com', 'Terri', 'admin', '22P5fxSXeJXf', null, 'office'),
  ('evan@brettkingbuilder.com', 'Evan', 'field_sup', '22P5SRxfGw9y', null, 'field_sup'),
  ('josh@brettkingbuilder.com', 'Josh', 'field', null, null, 'limited'),
  ('dave@brettkingbuilder.com', 'Dave', 'field', null, null, 'limited'),
  ('brett@brettkingbuilder.com', 'Brett King', 'owner', '22P5SRxcs7r9', 'cFyoFwK0LIr0npmY7W34', 'full');

-- ============================================================
-- PROJECTS (maps to JT Jobs)
-- ============================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  jt_job_id text unique not null,       -- JobTread job ID
  jt_job_number text,
  name text not null,
  client_name text,
  ghl_opportunity_id text,              -- Cross-reference to GHL
  ghl_contact_id text,
  status text not null default 'pre_construction'
    check (status in ('pre_construction', 'active', 'complete', 'on_hold')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- PRE-CONSTRUCTION PHASES
-- ============================================================

create table public.precon_phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_number int not null check (phase_number between 1 and 9),
  phase_name text not null,
  owner_user_id uuid references public.users(id),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'blocked', 'complete')),
  target_date date,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(project_id, phase_number)
);

-- Default phase names for reference
comment on table public.precon_phases is '
Phase 1: Finalize Conceptual Design
Phase 2: Get Conceptual Design Budget Range Approved
Phase 3: Get Selections from Client
Phase 4: Finalize Plans
Phase 5: Finalize Contract Signed
Phase 6: Submit for Permits
Phase 7: Order Long-Lead Materials
Phase 8: Schedule Subs
Phase 9: Hand Off to Field
';

-- ============================================================
-- BLOCKERS
-- ============================================================

create table public.blockers (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references public.precon_phases(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  description text not null,
  blocker_type text not null default 'internal'
    check (blocker_type in ('client', 'internal', 'vendor', 'permit', 'other')),
  is_resolved boolean default false,
  created_by uuid references public.users(id),
  resolved_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id),
  title text not null,
  body text,
  type text not null default 'info'
    check (type in ('info', 'warning', 'urgent', 'stall', 'deadline')),
  is_read boolean default false,
  action_url text,                     -- deep link into dashboard
  created_at timestamptz default now()
);

-- Index for fast unread count
create index idx_notifications_unread on public.notifications(user_id, is_read) where is_read = false;

-- ============================================================
-- DOCUMENT INTELLIGENCE (Phase 2 - schema ready now)
-- ============================================================

create table public.document_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  jt_document_id text,                 -- JT document ID (Tier 1)
  jt_file_id text,                     -- JT file ID (Tier 2)
  name text not null,
  tier text not null check (tier in ('approved', 'job_file')),
  document_type text,                  -- customerOrder, bidRequest, etc.
  source_url text,                     -- CDN URL
  status text,                         -- JT document status
  approved_at timestamptz,
  synced_at timestamptz default now(),
  created_at timestamptz default now()
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.document_sources(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(1536),              -- OpenAI ada-002 or similar
  tier text not null check (tier in ('approved', 'job_file')),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Vector similarity search index
create index idx_chunks_embedding on public.document_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.precon_phases enable row level security;
alter table public.blockers enable row level security;
alter table public.notifications enable row level security;
alter table public.document_sources enable row level security;
alter table public.document_chunks enable row level security;

-- All authenticated users can read projects and phases
create policy "Authenticated users can read projects"
  on public.projects for select using (true);

create policy "Authenticated users can read phases"
  on public.precon_phases for select using (true);

create policy "Authenticated users can read blockers"
  on public.blockers for select using (true);

-- Only owner/admin can modify projects and phases
create policy "Owner and admin can modify projects"
  on public.projects for all using (
    exists (select 1 from public.users where id = auth.uid() and role in ('owner', 'admin'))
  );

create policy "Owner and admin can modify phases"
  on public.precon_phases for all using (
    exists (select 1 from public.users where id = auth.uid() and role in ('owner', 'admin'))
  );

-- Users see only their own notifications
create policy "Users see own notifications"
  on public.notifications for select using (user_id = auth.uid());

create policy "Users can update own notifications"
  on public.notifications for update using (user_id = auth.uid());

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Auto-create 9 phases when a project is inserted
create or replace function public.create_precon_phases()
returns trigger as $$
declare
  phase_names text[] := array[
    'Finalize Conceptual Design',
    'Get Conceptual Design Budget Range Approved',
    'Get Selections from Client',
    'Finalize Plans',
    'Finalize Contract Signed',
    'Submit for Permits',
    'Order Long-Lead Materials',
    'Schedule Subs',
    'Hand Off to Field'
  ];
  i int;
begin
  for i in 1..9 loop
    insert into public.precon_phases (project_id, phase_number, phase_name)
    values (new.id, i, phase_names[i]);
  end loop;
  return new;
end;
$$ language plpgsql;

create trigger trg_create_precon_phases
  after insert on public.projects
  for each row execute function public.create_precon_phases();

-- Updated_at trigger
create or replace function public.update_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_projects_updated
  before update on public.projects
  for each row execute function public.update_timestamp();

create trigger trg_phases_updated
  before update on public.precon_phases
  for each row execute function public.update_timestamp();

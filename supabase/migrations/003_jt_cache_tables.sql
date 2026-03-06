-- ============================================================
-- BKB Operations Platform - JobTread Cache Tables
-- Persistent cache for JT data so agents can access ALL records
-- without hitting API pagination limits or timeout constraints.
-- ============================================================

-- ============================================================
-- JT JOBS (core job cache)
-- ============================================================

create table if not exists public.jt_jobs (
  id text primary key,                      -- JT job ID (e.g. '22PAN3gjeRgh')
  org_id text not null default '22P5SRwhLaYe',
  number text,
  name text not null,
  status text,
  description text,
  location_id text,
  account_id text,                          -- Customer account ID
  account_name text,                        -- Denormalized customer name
  ghl_contact_id text,
  ghl_opportunity_id text,
  created_at timestamptz,
  closed_on timestamptz,
  synced_at timestamptz default now(),
  raw_data jsonb default '{}',
  updated_at_ts timestamptz default now()
);

create index if not exists idx_jt_jobs_synced on public.jt_jobs(synced_at);
create index if not exists idx_jt_jobs_status on public.jt_jobs(status);
create index if not exists idx_jt_jobs_account on public.jt_jobs(account_id);

-- ============================================================
-- JT TASKS (complete task cache — no 500-item cap)
-- ============================================================

create table if not exists public.jt_tasks (
  id text primary key,
  job_id text not null,
  parent_task_id text,
  org_id text not null default '22P5SRwhLaYe',
  name text not null,
  description text,
  progress numeric,                         -- 0, 0.5, or 1
  is_group boolean default false,
  start_date date,
  end_date date,
  assigned_member_ids text[],
  assigned_member_names text[],
  synced_at timestamptz default now(),
  raw_data jsonb default '{}',
  created_at_ts timestamptz default now()
);

create index if not exists idx_jt_tasks_job on public.jt_tasks(job_id);
create index if not exists idx_jt_tasks_parent on public.jt_tasks(parent_task_id);
create index if not exists idx_jt_tasks_end_date on public.jt_tasks(end_date);
create index if not exists idx_jt_tasks_synced on public.jt_tasks(synced_at);

-- ============================================================
-- JT COMMENTS (complete comment history — no 200-item cap)
-- ============================================================

create table if not exists public.jt_comments (
  id text primary key,
  job_id text,                              -- Denormalized for fast job-level queries
  target_id text not null,
  target_type text not null,                -- 'job', 'task', 'document', etc.
  message text,
  name text,                                -- Author display name
  is_pinned boolean default false,
  parent_comment_id text,
  created_at timestamptz,
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_jt_comments_job on public.jt_comments(job_id);
create index if not exists idx_jt_comments_target on public.jt_comments(target_type, target_id);
create index if not exists idx_jt_comments_created on public.jt_comments(created_at desc);
create index if not exists idx_jt_comments_synced on public.jt_comments(synced_at);

-- ============================================================
-- JT DAILY LOGS
-- ============================================================

create table if not exists public.jt_daily_logs (
  id text primary key,
  job_id text not null,
  date date not null,
  notes text,
  created_at timestamptz,
  assigned_member_ids text[],
  assigned_member_names text[],
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_jt_daily_logs_job on public.jt_daily_logs(job_id);
create index if not exists idx_jt_daily_logs_date on public.jt_daily_logs(date desc);
create index if not exists idx_jt_daily_logs_synced on public.jt_daily_logs(synced_at);

-- ============================================================
-- JT TIME ENTRIES
-- ============================================================

create table if not exists public.jt_time_entries (
  id text primary key,
  job_id text not null,
  task_id text,
  started_at timestamptz,
  ended_at timestamptz,
  hours numeric,
  member_id text,
  member_name text,
  notes text,
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_jt_time_entries_job on public.jt_time_entries(job_id);
create index if not exists idx_jt_time_entries_synced on public.jt_time_entries(synced_at);

-- ============================================================
-- JT COST ITEMS (Estimating-only, filtered)
-- ============================================================

create table if not exists public.jt_cost_items (
  id text primary key,
  job_id text not null,
  cost_group_id text,
  cost_group_name text,
  name text not null,
  description text,
  quantity numeric,
  unit_cost numeric,
  unit_price numeric,
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_jt_cost_items_job on public.jt_cost_items(job_id);
create index if not exists idx_jt_cost_items_group on public.jt_cost_items(cost_group_id);
create index if not exists idx_jt_cost_items_synced on public.jt_cost_items(synced_at);

-- ============================================================
-- JT DOCUMENTS
-- ============================================================

create table if not exists public.jt_documents (
  id text primary key,
  job_id text not null,
  name text not null,
  document_type text,                       -- customerOrder, bidRequest, etc.
  status text,
  total_price numeric,
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_jt_documents_job on public.jt_documents(job_id);
create index if not exists idx_jt_documents_synced on public.jt_documents(synced_at);

-- ============================================================
-- JT MEMBERS (org-wide, rarely changes)
-- ============================================================

create table if not exists public.jt_members (
  id text primary key,                      -- Membership ID
  user_id text,
  user_name text,
  user_email text,
  role text,
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_jt_members_email on public.jt_members(user_email);

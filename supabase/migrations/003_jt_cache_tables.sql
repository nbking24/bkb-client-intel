-- ============================================================
-- BKB Operations Platform - JobTread Message Cache
-- Only stores data that exceeds API pagination limits:
-- comments (messages) and daily logs.
-- All other JT data (jobs, tasks, cost items, etc.) is read
-- live from the API where pagination isn't an issue.
-- ============================================================

-- ============================================================
-- JT COMMENTS (complete message history — no pagination cap)
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

-- Full-text search on comment messages
create index if not exists idx_jt_comments_fts on public.jt_comments
  using gin (to_tsvector('english', coalesce(message, '') || ' ' || coalesce(name, '')));

-- ============================================================
-- JT DAILY LOGS (complete log history)
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

-- Full-text search on daily log notes
create index if not exists idx_jt_daily_logs_fts on public.jt_daily_logs
  using gin (to_tsvector('english', coalesce(notes, '')));

-- ============================================================
-- BKB Operations Platform - Sync State Tracking
-- Tracks sync progress, errors, and resumption points.
-- ============================================================

create table if not exists public.sync_state (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,                -- 'jt_job_deep', 'jt_jobs_list', 'ghl_contact', etc.
  entity_id text,                           -- Specific job/contact ID (null for list syncs)
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'failed')),
  stage int default 1,                      -- Current sync stage (1, 2, 3)
  started_at timestamptz default now(),
  completed_at timestamptz,
  items_processed int default 0,
  error_message text,
  retry_count int default 0,
  initiated_by text default 'cron',         -- 'cron', 'agent', 'manual'
  created_at timestamptz default now()
);

create index if not exists idx_sync_state_entity on public.sync_state(entity_type, entity_id);
create index if not exists idx_sync_state_status on public.sync_state(status);
create index if not exists idx_sync_state_recent on public.sync_state(created_at desc);

-- Convenience view: latest sync per entity
create or replace view public.sync_latest as
select distinct on (entity_type, entity_id)
  id, entity_type, entity_id, status, stage,
  started_at, completed_at, items_processed, error_message, retry_count
from public.sync_state
order by entity_type, entity_id, created_at desc;

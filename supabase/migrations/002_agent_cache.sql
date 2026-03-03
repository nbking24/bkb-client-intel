-- ============================================================
-- BKB Operations Platform - Agent Cache Table
--
-- Required by the Design Manager Agent to cache analysis reports.
-- The agent writes via upsert on the 'key' column.
-- Run this in your Supabase SQL Editor.
-- ============================================================

create table if not exists public.agent_cache (
  id uuid primary key default gen_random_uuid(),
    key text unique not null,
      data jsonb not null default '{}',
        updated_at timestamptz default now(),
          created_at timestamptz default now()
          );

          -- The agent uses service_role key which bypasses RLS,
          -- but we enable RLS anyway for safety.
          alter table public.agent_cache enable row level security;

          -- Allow service role (used by agent) full access - RLS bypassed anyway.
          -- For browser clients, read-only access so dashboard can load cached reports.
          create policy "Anyone can read agent cache"
            on public.agent_cache for select using (true);

            -- Index for fast key lookups
            create index if not exists idx_agent_cache_key on public.agent_cache(key);
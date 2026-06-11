-- =====================================================================
-- Bucks Beautiful Kitchen & Garden Tour 2026 — Raffle Entries
-- Powers /raffle/enter (public), /raffle/wheel (TV display), /raffle/admin.
-- =====================================================================

create table if not exists raffle_entries (
  id              uuid primary key default gen_random_uuid(),

  -- Visitor info (collected on entry form + paper sheet)
  name            text not null,
  phone           text,
  email           text,
  contact_ok      boolean not null default false,    -- "May we contact you about a project?"
  interests       text[] not null default '{}',      -- 8-checkbox interest list

  -- Provenance
  source          text not null check (source in ('public_qr', 'admin_manual')),
  entered_by      text,                              -- staff name if source='admin_manual'
  user_agent      text,                              -- if source='public_qr'
  ip_country      text,                              -- via x-vercel-ip-country

  -- Drawing
  is_winner       boolean not null default false,
  drawn_at        timestamptz,

  -- Soft delete
  deleted_at      timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Dedupe: phone OR email (case-insensitive on email) — only across non-deleted rows
create unique index if not exists raffle_entries_phone_unique
  on raffle_entries (phone)
  where deleted_at is null and phone is not null and phone <> '';

create unique index if not exists raffle_entries_email_unique
  on raffle_entries (lower(email))
  where deleted_at is null and email is not null and email <> '';

create index if not exists raffle_entries_created_idx
  on raffle_entries (created_at desc);

create index if not exists raffle_entries_winner_idx
  on raffle_entries (is_winner) where is_winner = true;

-- Touch updated_at on row updates
create or replace function raffle_entries_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists raffle_entries_touch on raffle_entries;
create trigger raffle_entries_touch
  before update on raffle_entries
  for each row execute function raffle_entries_touch_updated_at();

-- =====================================================================
-- Row-level security
--   * service_role bypasses (used by API routes)
--   * anon may read non-PII (name + is_winner) for the wheel
-- =====================================================================
alter table raffle_entries enable row level security;

drop policy if exists "service role full"   on raffle_entries;
drop policy if exists "anon read names"     on raffle_entries;

create policy "service role full" on raffle_entries
  for all using (true) with check (true);

create policy "anon read names" on raffle_entries
  for select using (deleted_at is null);

-- =====================================================================
-- Realtime publication (skip if already added)
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'raffle_entries'
  ) then
    execute 'alter publication supabase_realtime add table raffle_entries';
  end if;
end $$;

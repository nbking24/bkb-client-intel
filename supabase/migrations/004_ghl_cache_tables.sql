-- ============================================================
-- BKB Operations Platform - GHL Message & Notes Cache
-- Only stores data that exceeds API pagination limits:
-- conversation messages and contact notes.
-- All other GHL data (contacts, opportunities, etc.) is read
-- live from the API where pagination isn't an issue.
-- ============================================================

-- ============================================================
-- GHL MESSAGES (complete conversation history — no 40-item cap)
-- ============================================================

create table if not exists public.ghl_messages (
  id text primary key,
  conversation_id text not null,
  contact_id text,                          -- Denormalized for fast lookup
  type text,                                -- email, sms, call, etc.
  direction text,                           -- inbound, outbound
  body text,
  subject text,                             -- For emails
  date_added timestamptz,
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_ghl_msgs_convo on public.ghl_messages(conversation_id);
create index if not exists idx_ghl_msgs_contact on public.ghl_messages(contact_id);
create index if not exists idx_ghl_msgs_date on public.ghl_messages(date_added desc);
create index if not exists idx_ghl_msgs_synced on public.ghl_messages(synced_at);

-- Full-text search on message body
create index if not exists idx_ghl_msgs_fts on public.ghl_messages
  using gin (to_tsvector('english', coalesce(body, '') || ' ' || coalesce(subject, '')));

-- ============================================================
-- GHL NOTES (complete contact notes history)
-- ============================================================

create table if not exists public.ghl_notes (
  id text primary key,
  contact_id text not null,
  body text,
  created_by text,
  date_added timestamptz,
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_ghl_notes_contact on public.ghl_notes(contact_id);
create index if not exists idx_ghl_notes_date on public.ghl_notes(date_added desc);
create index if not exists idx_ghl_notes_synced on public.ghl_notes(synced_at);

-- Full-text search on notes body
create index if not exists idx_ghl_notes_fts on public.ghl_notes
  using gin (to_tsvector('english', coalesce(body, '')));

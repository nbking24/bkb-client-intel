-- ============================================================
-- BKB Operations Platform - GHL Cache Tables
-- Persistent cache for GoHighLevel data.
-- ============================================================

-- ============================================================
-- GHL CONTACTS
-- ============================================================

create table if not exists public.ghl_contacts (
  id text primary key,                      -- GHL contact ID
  first_name text,
  last_name text,
  full_name text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  postal_code text,
  tags text[],
  jt_job_ids text[],                        -- Cross-reference to JT jobs
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_ghl_contacts_email on public.ghl_contacts(email);
create index if not exists idx_ghl_contacts_name on public.ghl_contacts(full_name);
create index if not exists idx_ghl_contacts_synced on public.ghl_contacts(synced_at);

-- Full-text search on contact names
create index if not exists idx_ghl_contacts_fts on public.ghl_contacts
  using gin (to_tsvector('english', coalesce(full_name, '') || ' ' || coalesce(email, '')));

-- ============================================================
-- GHL OPPORTUNITIES
-- ============================================================

create table if not exists public.ghl_opportunities (
  id text primary key,
  contact_id text,
  pipeline_id text,
  pipeline_name text,
  stage_id text,
  stage_name text,
  status text,                              -- open, won, lost, abandoned
  monetary_value numeric,
  name text,
  jt_job_id text,                           -- Cross-reference custom field
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_ghl_opps_contact on public.ghl_opportunities(contact_id);
create index if not exists idx_ghl_opps_jt_job on public.ghl_opportunities(jt_job_id);
create index if not exists idx_ghl_opps_pipeline on public.ghl_opportunities(pipeline_id, stage_id);
create index if not exists idx_ghl_opps_synced on public.ghl_opportunities(synced_at);

-- ============================================================
-- GHL CONVERSATIONS
-- ============================================================

create table if not exists public.ghl_conversations (
  id text primary key,
  contact_id text not null,
  type text,                                -- email, sms, etc.
  last_message_date timestamptz,
  unread_count int default 0,
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_ghl_convos_contact on public.ghl_conversations(contact_id);
create index if not exists idx_ghl_convos_synced on public.ghl_conversations(synced_at);

-- ============================================================
-- GHL MESSAGES (complete message history — no 40-item cap)
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
-- GHL NOTES
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

-- ============================================================
-- GHL TASKS
-- ============================================================

create table if not exists public.ghl_tasks (
  id text primary key,
  contact_id text not null,
  title text,
  body text,
  status text,
  due_date timestamptz,
  assigned_to text,
  completed boolean default false,
  synced_at timestamptz default now(),
  raw_data jsonb default '{}'
);

create index if not exists idx_ghl_tasks_contact on public.ghl_tasks(contact_id);
create index if not exists idx_ghl_tasks_synced on public.ghl_tasks(synced_at);

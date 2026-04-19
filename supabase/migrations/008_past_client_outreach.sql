-- ============================================================
-- 008_past_client_outreach.sql
-- Bulk past-client personal text campaign (iMessage → reminder →
-- email escalation). Tracks the full sequence per contact and
-- drives the /dashboard/marketing/past-client-outreach view.
-- ============================================================

create table if not exists public.past_client_outreach (
  id uuid primary key default gen_random_uuid(),

  -- Identity
  -- contact_key: stable dedup key. Prefer ghl_contact_id; fall back to phone_digits.
  contact_key text unique not null,
  ghl_contact_id text,
  jobtread_account_id text,

  -- Contact info
  first_name text,
  last_name text,
  full_name text,
  phone text,                        -- display format: (267) 784-4134
  phone_digits text,                 -- 10-digit for matching: 2677844134
  email text,

  -- Source context (what row in the flag spreadsheet this came from)
  source text check (source in ('jt_past_project', 'loop_contact')),
  project_names text,
  job_numbers text,
  city text,

  -- Pipeline state
  stage text not null default 'queued'
    check (stage in (
      'queued',           -- flagged but not sent yet
      'initial_sent',     -- first personal iMessage went out
      'reminder_sent',    -- 7-day reminder iMessage went out
      'email_sent',       -- escalation email went out
      'replied',          -- they replied via iMessage (terminal happy path)
      'completed',        -- review form submitted (terminal happy path)
      'opted_out',        -- STOP / unsubscribe / "don't text" (terminal)
      'skipped',          -- operator skipped this contact
      'failed'            -- a send step errored out
    )),

  -- Per-step timestamps
  queued_at timestamptz default now(),
  initial_sent_at timestamptz,
  reminder_sent_at timestamptz,
  email_sent_at timestamptz,
  reply_received_at timestamptz,
  form_completed_at timestamptz,
  opted_out_at timestamptz,

  -- What was sent (rendered body for each step)
  initial_text_body text,
  reminder_text_body text,
  email_subject text,
  email_body text,

  -- What came back (inbound iMessage scraped from ~/Library/Messages/chat.db)
  reply_text text,
  reply_full_thread jsonb,           -- full conversation [{direction,body,timestamp},...]

  -- Link to the review submission if they completed the form
  form_submission_id uuid,

  -- Notes
  flag_notes text,                   -- from the spreadsheet "Notes" column
  internal_notes text,               -- operator notes post-kickoff

  -- Audit
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_pco_stage on public.past_client_outreach(stage);
create index if not exists idx_pco_phone on public.past_client_outreach(phone_digits);
create index if not exists idx_pco_ghl on public.past_client_outreach(ghl_contact_id);
-- Partial indexes for the daily scheduler's "who is due?" query
create index if not exists idx_pco_initial_due
  on public.past_client_outreach(initial_sent_at)
  where stage = 'initial_sent';
create index if not exists idx_pco_reminder_due
  on public.past_client_outreach(reminder_sent_at)
  where stage = 'reminder_sent';

-- Keep updated_at fresh
create or replace function public.pco_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;
drop trigger if exists trg_pco_updated_at on public.past_client_outreach;
create trigger trg_pco_updated_at
  before update on public.past_client_outreach
  for each row execute function public.pco_set_updated_at();

-- ------------------------------------------------------------
-- pco_next_actions: what needs to happen today for each active contact
-- The daily scheduler and dashboard both read from this view.
-- ------------------------------------------------------------
create or replace view public.pco_next_actions as
select
  id,
  contact_key,
  ghl_contact_id,
  first_name,
  last_name,
  full_name,
  phone,
  phone_digits,
  email,
  stage,
  source,
  project_names,
  case
    when stage = 'queued' then 'send_initial'
    when stage = 'initial_sent'
         and initial_sent_at < now() - interval '7 days' then 'send_reminder'
    when stage = 'reminder_sent'
         and reminder_sent_at < now() - interval '7 days' then 'send_email'
    else null
  end as next_action,
  initial_sent_at,
  reminder_sent_at,
  email_sent_at,
  reply_received_at,
  form_completed_at,
  flag_notes
from public.past_client_outreach
where stage in ('queued', 'initial_sent', 'reminder_sent');

-- ------------------------------------------------------------
-- pco_funnel: at-a-glance cohort state for the dashboard header
-- ------------------------------------------------------------
create or replace view public.pco_funnel as
select
  count(*) filter (where stage = 'queued')         as queued,
  count(*) filter (where stage = 'initial_sent')   as initial_sent,
  count(*) filter (where stage = 'reminder_sent')  as reminder_sent,
  count(*) filter (where stage = 'email_sent')     as email_sent,
  count(*) filter (where stage = 'replied')        as replied,
  count(*) filter (where stage = 'completed')      as completed,
  count(*) filter (where stage = 'opted_out')      as opted_out,
  count(*) filter (where stage = 'skipped')        as skipped,
  count(*) filter (where stage = 'failed')         as failed,
  count(*)                                          as total
from public.past_client_outreach;

-- ------------------------------------------------------------
-- pco_pending_emails: the queue the dashboard uses for the
-- "select all + batch send" email action.
-- ------------------------------------------------------------
create or replace view public.pco_pending_emails as
select
  id,
  contact_key,
  first_name,
  last_name,
  full_name,
  email,
  email_subject,
  email_body,
  reminder_sent_at,
  flag_notes
from public.past_client_outreach
where stage = 'reminder_sent'
  and email is not null
  and email != ''
  and reminder_sent_at < now() - interval '7 days'
order by reminder_sent_at asc;

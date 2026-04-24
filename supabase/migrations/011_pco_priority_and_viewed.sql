-- ============================================================
-- 011_pco_priority_and_viewed.sql
--
-- (a) Adds a `priority` column to past_client_outreach so the
--     sender can send FRIEND/SUB contacts ahead of past clients.
--     Lower = higher priority. Default 100 (normal).
--
-- (b) Adds a `first_viewed_at` column to capture when a contact
--     first lands on the review gateway. Combined with the existing
--     form_completed_at, this gives us "visited but didn't finish"
--     visibility.
-- ============================================================

alter table public.past_client_outreach
  add column if not exists priority integer default 100;

alter table public.past_client_outreach
  add column if not exists first_viewed_at timestamptz;

-- Index supports the sender's ORDER BY (priority, queued_at)
create index if not exists idx_pco_priority_queued
  on public.past_client_outreach(priority asc, queued_at asc);

-- Convenience index for the dashboard "who visited but didn't finish"
create index if not exists idx_pco_viewed_not_completed
  on public.past_client_outreach(first_viewed_at)
  where first_viewed_at is not null and form_completed_at is null;

-- Rebuild the pco_next_actions view to include priority so the
-- dashboard can respect the same ordering when showing queue work.
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
  priority,
  first_viewed_at,
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

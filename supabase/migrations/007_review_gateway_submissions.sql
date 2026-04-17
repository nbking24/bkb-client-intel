-- ============================================================
-- BKB Review Gateway — client-submitted review text + star rating
--
-- Captures what clients submit from the custom /review/[contactId]
-- gateway page. 5-star clients get their text copied to clipboard
-- and are redirected to Google. 1-4 star responses stay private
-- and route to Nathan internally.
-- ============================================================

create table if not exists public.review_gateway_submissions (
  id uuid primary key default gen_random_uuid(),

  -- Identity
  client_contact_id text not null,     -- GHL/Loop contact id from URL
  client_name text,
  client_email text,
  client_phone text,
  jobtread_job_id text,                 -- resolved from review_requests if found

  -- Response
  star_rating int not null check (star_rating between 1 and 5),
  review_text text,                     -- the text the client wrote in the gateway
  submitted_at timestamptz default now(),

  -- Post-submission behavior
  routed_to text check (routed_to in ('google', 'internal_followup')),
  clipboard_copied boolean default false,
  google_clicked_at timestamptz,        -- null until they click 'Continue to Google'

  -- Confirmation (set later via webhook when we detect the review actually posted)
  confirmed_on_google boolean default false,
  confirmed_at timestamptz,
  confirmed_url text,

  -- Link back to the review request that prompted this (if any)
  source_review_request_id uuid references public.review_requests(id) on delete set null,

  -- Agent/source tracking
  user_agent text,
  ip_country text,

  created_at timestamptz default now()
);

create index if not exists idx_rgs_contact on public.review_gateway_submissions(client_contact_id);
create index if not exists idx_rgs_recent on public.review_gateway_submissions(submitted_at desc);
create index if not exists idx_rgs_followup
  on public.review_gateway_submissions(routed_to, submitted_at desc)
  where routed_to = 'internal_followup';

-- Convenience view: recent make-it-right items (sub-5-star submissions needing Nathan's attention)
create or replace view public.review_make_it_right_queue as
select
  s.id,
  s.client_contact_id,
  coalesce(s.client_name, rr.client_name) as client_name,
  coalesce(s.client_email, rr.client_email) as client_email,
  coalesce(s.client_phone, rr.client_phone) as client_phone,
  s.jobtread_job_id,
  s.star_rating,
  s.review_text,
  s.submitted_at,
  rr.trigger_type
from public.review_gateway_submissions s
left join public.review_requests rr on rr.id = s.source_review_request_id
where s.routed_to = 'internal_followup'
order by s.submitted_at desc;

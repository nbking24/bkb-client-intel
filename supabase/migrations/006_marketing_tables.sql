-- ============================================================
-- BKB Marketing Agents - Schema
-- Phase 1: Review Engine tables + unified marketing events log
-- Phase 2/3 tables scaffolded but minimally populated
-- ============================================================

-- ------------------------------------------------------------
-- 1. client_review_history — dedup source of truth
--    Any client who has EVER left a review (on any platform)
--    is marked here. Review Concierge Agent MUST check this
--    before sending any review request.
-- ------------------------------------------------------------
create table if not exists public.client_review_history (
  -- Primary identifier: GHL contact id (most stable across systems)
  client_contact_id text primary key,

  -- Optional richer identifiers for cross-referencing
  jobtread_account_id text,
  client_name text,
  client_email text,
  client_phone text,

  -- Where they've reviewed. Example:
  -- { "google":   { "stars": 5, "url": "...", "reviewed_at": "..." },
  --   "houzz":    { "stars": 5, "url": "...", "reviewed_at": "..." },
  --   "facebook": { "recommends": true, "url": "...", "reviewed_at": "..." } }
  platforms_reviewed jsonb not null default '{}'::jsonb,

  first_review_at timestamptz,
  latest_review_at timestamptz,

  synced_from text default 'manual_entry'
    check (synced_from in ('google_api', 'houzz_scrape', 'facebook_api', 'manual_entry', 'agent_detected')),

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_review_history_email on public.client_review_history(client_email);
create index if not exists idx_review_history_jt on public.client_review_history(jobtread_account_id);

-- ------------------------------------------------------------
-- 2. review_requests — every ask, its trigger, response, outcome
-- ------------------------------------------------------------
create table if not exists public.review_requests (
  id uuid primary key default gen_random_uuid(),

  -- Client linkage
  client_contact_id text not null,
  jobtread_job_id text,
  jobtread_account_id text,
  client_name text,
  client_email text,
  client_phone text,

  -- Trigger
  trigger_type text not null
    check (trigger_type in ('completion', 'nurture', 'post_design', 'annual')),
  trigger_source text,                    -- e.g. 'jobtread_status_change', 'ghl_pipeline_move'
  trigger_detail jsonb,                   -- raw event payload for debugging

  -- Send state
  sent_at timestamptz,
  channels_sent jsonb default '[]'::jsonb, -- e.g. ["email","sms"]
  ghl_workflow_id text,
  ghl_run_id text,

  -- Survey response
  survey_response jsonb,
  star_rating int check (star_rating between 1 and 5),
  survey_responded_at timestamptz,

  -- What we did next
  follow_up_action text
    check (follow_up_action in ('links_sent', 'internal_alert', 'none')),
  follow_up_at timestamptz,

  -- Did they actually leave a review
  review_left_status text default 'pending'
    check (review_left_status in ('pending', 'confirmed', 'none', 'skipped_duplicate')),
  review_platform text,                   -- google / houzz / facebook
  review_url text,
  review_stars int,
  review_confirmed_at timestamptz,

  -- Lifecycle
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'responded', 'completed', 'skipped', 'failed')),
  skipped_reason text,                    -- 'already_reviewed', 'rate_limited', 'opted_out', etc.
  outcome_notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_rr_contact on public.review_requests(client_contact_id);
create index if not exists idx_rr_job on public.review_requests(jobtread_job_id);
create index if not exists idx_rr_status on public.review_requests(status);
create index if not exists idx_rr_trigger on public.review_requests(trigger_type);
create index if not exists idx_rr_recent on public.review_requests(created_at desc);

-- ------------------------------------------------------------
-- 3. review_responses — drafted replies to reviews we've received
--    Populated by Review Response Agent; Nathan approves from UI
-- ------------------------------------------------------------
create table if not exists public.review_responses (
  id uuid primary key default gen_random_uuid(),

  platform text not null check (platform in ('google', 'houzz', 'facebook')),
  external_review_id text not null,       -- platform's review id
  reviewer_name text,
  review_stars int,
  review_text text,
  review_posted_at timestamptz,
  review_url text,

  -- Draft
  drafted_reply text,
  draft_rationale text,                   -- why the agent wrote it this way
  drafted_at timestamptz,
  drafted_by_agent text default 'review_response_agent_v1',

  -- Approval
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'edited', 'skipped', 'posted', 'failed')),
  approved_reply text,                    -- final text after Nathan's edits
  approved_by text,
  approved_at timestamptz,
  posted_at timestamptz,
  posted_url text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(platform, external_review_id)
);

create index if not exists idx_rresp_pending on public.review_responses(approval_status)
  where approval_status = 'pending';
create index if not exists idx_rresp_platform on public.review_responses(platform);

-- ------------------------------------------------------------
-- 4. reputation_mentions — web sweep results
-- ------------------------------------------------------------
create table if not exists public.reputation_mentions (
  id uuid primary key default gen_random_uuid(),
  source text not null,                   -- 'google_news', 'nextdoor', 'reddit', etc.
  url text not null unique,
  title text,
  snippet text,
  found_at timestamptz default now(),
  sentiment text check (sentiment in ('positive', 'neutral', 'negative', 'unknown')),
  action_needed boolean default false,
  dismissed boolean default false,
  dismissed_at timestamptz,
  dismissed_by text,
  notes text
);

create index if not exists idx_rep_actionable on public.reputation_mentions(action_needed, dismissed)
  where action_needed = true and dismissed = false;

-- ------------------------------------------------------------
-- 5. newsletter_issues — monthly newsletter state
-- ------------------------------------------------------------
create table if not exists public.newsletter_issues (
  id uuid primary key default gen_random_uuid(),
  issue_month date not null unique,       -- first of the month, e.g. '2026-05-01'
  status text not null default 'drafting'
    check (status in ('drafting', 'editing', 'review', 'approved', 'sent', 'skipped')),

  curator_run_at timestamptz,
  editor_run_at timestamptz,
  approved_at timestamptz,
  approved_by text,

  featured_project_jt_id text,
  theme text,
  notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 6. newsletter_sections — modular content blocks
-- ------------------------------------------------------------
create table if not exists public.newsletter_sections (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.newsletter_issues(id) on delete cascade,
  section_type text not null,             -- 'hero', 'featured_project', 'tip', 'testimonial', 'cta'
  position int default 0,

  -- Segment applicability (empty array = all segments)
  applies_to_segments text[] default array[]::text[],

  title text,
  body_markdown text,
  body_html text,
  image_url text,
  cta_label text,
  cta_url text,

  created_at timestamptz default now()
);

create index if not exists idx_ns_issue on public.newsletter_sections(issue_id);

-- ------------------------------------------------------------
-- 7. newsletter_sends — per-segment send record + metrics
-- ------------------------------------------------------------
create table if not exists public.newsletter_sends (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.newsletter_issues(id) on delete cascade,
  segment text not null check (segment in ('past_clients', 'nurture', 'referral_partners')),
  ghl_campaign_id text,

  scheduled_for timestamptz,
  sent_at timestamptz,
  recipients_count int,
  opens_count int,
  clicks_count int,
  unsubscribes_count int,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(issue_id, segment)
);

-- ------------------------------------------------------------
-- 8. fb_posts — posts the Scout Agent has seen
-- ------------------------------------------------------------
create table if not exists public.fb_posts (
  id uuid primary key default gen_random_uuid(),
  fb_post_id text not null unique,
  group_id text,
  group_name text,
  author_name text,
  author_fb_id text,
  post_url text,
  post_text text,
  post_posted_at timestamptz,
  observed_at timestamptz default now(),
  topic_match text[],                     -- which keywords hit
  never_reply_flag boolean default false,
  never_reply_reason text
);

create index if not exists idx_fb_posts_recent on public.fb_posts(observed_at desc);

-- ------------------------------------------------------------
-- 9. fb_drafts — replies the Scout Agent has drafted
-- ------------------------------------------------------------
create table if not exists public.fb_drafts (
  id uuid primary key default gen_random_uuid(),
  fb_post_id text not null references public.fb_posts(fb_post_id) on delete cascade,

  drafted_reply text not null,
  draft_rationale text,
  drafted_at timestamptz default now(),
  drafted_by_agent text default 'fb_scout_agent_v1',

  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'edited', 'skipped', 'posted', 'failed')),
  approved_reply text,
  approved_by text,
  approved_at timestamptz,
  posted_at timestamptz,
  posted_comment_id text,
  skip_reason text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_fb_drafts_pending on public.fb_drafts(approval_status)
  where approval_status = 'pending';

-- ------------------------------------------------------------
-- 10. marketing_events — unified activity log across all agents
-- ------------------------------------------------------------
create table if not exists public.marketing_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz default now(),
  agent text not null,                    -- 'review_concierge', 'review_response', 'fb_scout', etc.
  event_type text not null,               -- 'request_sent', 'reply_drafted', 'approval_queued', etc.
  entity_type text,                       -- 'review_request', 'review_response', 'fb_draft', etc.
  entity_id text,
  outcome text,                           -- 'success', 'skipped', 'failed'
  detail jsonb
);

create index if not exists idx_me_recent on public.marketing_events(occurred_at desc);
create index if not exists idx_me_agent on public.marketing_events(agent, occurred_at desc);

-- ------------------------------------------------------------
-- Convenience view: actionable items awaiting Nathan's review
-- ------------------------------------------------------------
create or replace view public.marketing_approval_queue as
select
  'review_response' as kind,
  id::text as id,
  drafted_at as queued_at,
  platform as context,
  review_stars::text as meta
from public.review_responses
where approval_status = 'pending'
union all
select
  'fb_reply' as kind,
  id::text as id,
  drafted_at as queued_at,
  'facebook' as context,
  null as meta
from public.fb_drafts
where approval_status = 'pending'
union all
select
  'newsletter_issue' as kind,
  id::text as id,
  created_at as queued_at,
  to_char(issue_month, 'YYYY-MM') as context,
  status as meta
from public.newsletter_issues
where status = 'review';

-- ------------------------------------------------------------
-- Convenience view: review funnel last 90 days
-- ------------------------------------------------------------
create or replace view public.review_funnel_90d as
select
  trigger_type,
  count(*) filter (where status != 'skipped') as requests_sent,
  count(*) filter (where star_rating = 5) as five_star_responses,
  count(*) filter (where star_rating between 1 and 4) as low_star_responses,
  count(*) filter (where review_left_status = 'confirmed') as reviews_confirmed,
  count(*) filter (where status = 'skipped') as skipped_total
from public.review_requests
where created_at > now() - interval '90 days'
group by trigger_type;

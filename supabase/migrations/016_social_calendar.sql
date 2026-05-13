-- ============================================================
-- BKB Marketing — Social Calendar (Phase 3)
-- ------------------------------------------------------------
-- Two new tables for the Content Strategist's weekly drafts:
--   social_calendar_weeks  — the weekly container
--   social_post_drafts     — individual posts within a week
-- Plus extending marketing_approval_queue to include pending posts.
-- ============================================================

create table if not exists public.social_calendar_weeks (
  id uuid primary key default gen_random_uuid(),

  -- Monday of the target week
  week_of date not null unique,

  -- The week's theme (e.g. "Modern Heritage Style")
  theme text,

  -- Free-form caveat / supply note from the Strategist
  caveat text,

  -- Structured agent notes for Nathan (open questions, photo asks, etc.)
  notes jsonb,

  -- Lifecycle
  status text not null default 'review'
    check (status in ('drafting', 'review', 'approved', 'scheduled', 'sent', 'failed')),

  drafted_by_agent text default 'cowork-content-strategist',
  drafted_at timestamptz default now(),

  approved_at timestamptz,
  approved_by text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_scw_recent on public.social_calendar_weeks(week_of desc);
create index if not exists idx_scw_status on public.social_calendar_weeks(status);

-- ------------------------------------------------------------
create table if not exists public.social_post_drafts (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.social_calendar_weeks(id) on delete cascade,

  position int not null default 0,                        -- ordering within the week

  -- When this post is meant to go out
  scheduled_day date,                                     -- e.g. 2026-05-14
  scheduled_time text,                                    -- e.g. "5pm ET" — free text
  scheduled_at timestamptz,                               -- optional combined

  -- Where + how
  platform text not null
    check (platform in ('instagram', 'facebook', 'google_business')),
  format text not null
    check (format in ('single_image', 'carousel', 'reel', 'video', 'long_form', 'text_only')),

  -- What
  topic text,                                             -- short label
  caption text not null,                                  -- the actual post body
  approved_caption text,                                  -- Nathan's edited version
  hashtags text[] default '{}',
  alt_text text,
  photos jsonb default '[]'::jsonb,                       -- [{path, jobtread_id, caption, alt}]

  -- Lifecycle
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'edited', 'skipped', 'posted', 'failed')),
  approved_by text,
  approved_at timestamptz,
  posted_at timestamptz,
  posted_url text,
  skip_reason text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_spd_week on public.social_post_drafts(week_id);
create index if not exists idx_spd_pending on public.social_post_drafts(approval_status)
  where approval_status = 'pending';
create index if not exists idx_spd_scheduled on public.social_post_drafts(scheduled_day);

-- ------------------------------------------------------------
-- Extend the approval queue to surface pending social posts
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
where status = 'review'
union all
select
  'social_post' as kind,
  id::text as id,
  created_at as queued_at,
  platform as context,
  format as meta
from public.social_post_drafts
where approval_status = 'pending';

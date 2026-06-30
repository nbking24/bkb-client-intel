-- 029_daily_briefing.sql
-- Nathan's Daily Briefing (Overview replacement). Three tables:
--   1. daily_briefings        — one pre-computed briefing row per date (3 AM cron writes it)
--   2. briefing_email_dismissals — "I replied elsewhere" dismissals, keyed by Gmail thread
--   3. briefing_monitored_jobs    — which active jobs Nathan expects daily logs on + frequency

-- 1) Pre-computed briefing payloads. Keyed by date so the morning page load is a single read.
create table if not exists public.daily_briefings (
  id            uuid primary key default gen_random_uuid(),
  briefing_date date not null,
  payload       jsonb not null,
  generated_at  timestamptz not null default now(),
  generate_ms   integer,
  unique (briefing_date)
);
comment on table public.daily_briefings is
  'One pre-computed daily briefing per date for Nath''s Overview. Written by the 3 AM cron; the page just reads the latest row.';

-- 2) Email "mark replied / dismiss". Suppresses an email from the needs-reply list
--    unless a NEWER inbound message arrives on the thread (date > dismissed_at).
create table if not exists public.briefing_email_dismissals (
  gmail_thread_id text primary key,
  subject         text,
  dismissed_at    timestamptz not null default now(),
  last_inbound_at timestamptz,           -- date of the message that was showing when dismissed
  dismissed_by    text
);
comment on table public.briefing_email_dismissals is
  'Threads Nathan handled through another channel. Briefing skips a dismissed thread unless a message newer than dismissed_at appears.';

-- 3) Per-job daily-log monitoring config. Only jobs flagged here can trip a daily-log-gap alert.
create table if not exists public.briefing_monitored_jobs (
  jt_job_id        text primary key,
  job_name         text,
  job_number       text,
  expect_logs      boolean not null default true,
  frequency_per_week integer not null default 2,   -- minimum logs expected per week (1 or 2 typically)
  updated_at       timestamptz not null default now(),
  updated_by       text
);
comment on table public.briefing_monitored_jobs is
  'Active jobs Nathan expects daily logs on. frequency_per_week = minimum logs/week; the briefing flags a gap when the latest log is older than the expected window.';

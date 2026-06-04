-- 021_review_gateway_verification.sql
-- Add Google-verification + internal-note columns to review_gateway_submissions
-- so Nathan can track which submitted reviews actually appeared on Google
-- Business Profile (and add private notes on the low-star ones).
--
-- The 5-star path on the gateway sends the client to Google, but we have no
-- automated way to confirm they actually posted (the new-review webhook is
-- scaffolded but no Google polling exists yet). These columns let the operator
-- mark verification manually, and later let an automated job set the same
-- columns when client_review_history gets populated.

alter table public.review_gateway_submissions
  add column if not exists google_verified  boolean not null default false,
  add column if not exists verified_at      timestamptz,
  add column if not exists verified_by      text,
  add column if not exists internal_note    text;

comment on column public.review_gateway_submissions.google_verified is
  'True when the operator (or future auto-poller) has confirmed this client''s review appears on Google Business Profile.';
comment on column public.review_gateway_submissions.verified_at is
  'Timestamp when google_verified flipped to true.';
comment on column public.review_gateway_submissions.verified_by is
  'app_users.id of the user who marked this verified (or "system" if auto).';
comment on column public.review_gateway_submissions.internal_note is
  'Operator notes (especially for 1-4 star submissions that need follow-up).';

create index if not exists idx_review_gateway_submissions_routed_verified
  on public.review_gateway_submissions (routed_to, google_verified, created_at desc);

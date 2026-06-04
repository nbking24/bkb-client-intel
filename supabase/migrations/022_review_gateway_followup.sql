-- 022_review_gateway_followup.sql
-- Track when Nathan has followed up with a client to ask them to repost their
-- review on Google. Driven from the Reviews dashboard's per-row "Request
-- Google review" button. Lets us avoid asking the same client twice and shows
-- a small "Asked on..." indicator on the card.
alter table public.review_gateway_submissions
  add column if not exists followup_requested_at timestamptz,
  add column if not exists followup_requested_by text;

comment on column public.review_gateway_submissions.followup_requested_at is
  'Timestamp the operator opened the Google-review request templates for this client.';
comment on column public.review_gateway_submissions.followup_requested_by is
  'app_users.id of the operator who logged the follow-up request.';

-- 023_lead_uncontacted_alerts.sql
-- Per-contact dedup ledger for the new-uncontacted-lead email alerts.
-- When a contact first appears in the New & Uncontacted bucket, the cron
-- inserts a row here and fires an email to Terri. The unique constraint on
-- contact_id means we never re-alert for the same Loop contact, even if
-- they bounce in and out of the bucket as cron runs proceed.
create table if not exists public.lead_uncontacted_alerts (
  contact_id      text primary key,
  contact_name    text,
  stage           text,
  alerted_at      timestamptz not null default now(),
  alerted_to      text,        -- email address we sent to (for audit)
  message_id      text,        -- Resend message id
  lead_age_hours  integer,
  payload         jsonb        -- snapshot of the row we alerted on
);

comment on table public.lead_uncontacted_alerts is
  'One row per Loop contact we have already emailed Terri about as a new uncontacted lead. Prevents duplicate notifications.';

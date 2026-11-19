-- Bill Review: tag a bill line as billable.
--
-- When a bill is billable to the client but is not on an approved budget
-- item, it is linked to the job's "Billable Items" budget line (2302
-- Billable Subs or 2303 Billable Materials) so it can be invoiced later.
-- These columns record that it was tagged billable and the optional note
-- about what the client is being billed for.
--
-- Applied to production 2026-11-19.
--
-- Style note: no em dashes in this file.

alter table bill_review_queue
  add column if not exists billable boolean not null default false;

alter table bill_review_queue
  add column if not exists billable_note text;

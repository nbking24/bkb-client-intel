-- 036_bill_review_flagged_status.sql
--
-- "Flag for Nathan" on the Bill Review page.
--
-- Heather works the bill queue weekly. When she can't tell which budget item
-- a line belongs on — or the picker comes back empty because the job has no
-- approved budget yet — she flags the row with a short note instead of
-- guessing or leaving it pending forever.
--
-- A flagged row:
--   * leaves the pending list and the pending count;
--   * shows under the "Flagged for Nathan" filter with its note;
--   * is NOT reset to pending or auto-dismissed by the nightly scan
--     (see the existing.status checks in app/lib/bill-categorization.ts).
--
-- Nathan then Applies or Dismisses it from that filter, which moves it to
-- 'applied' / 'dismissed' like any other row.
--
-- Applied to production 2026-10-28.

alter table public.bill_review_queue
  drop constraint if exists bill_review_queue_status_check;

alter table public.bill_review_queue
  add constraint bill_review_queue_status_check
  check (status = any (array[
    'pending'::text,
    'approved'::text,
    'applied'::text,
    'dismissed'::text,
    'failed'::text,
    'flagged'::text
  ]));

-- Who flagged it, when, and why. Kept separate from approved_by/approved_at
-- so the flag survives a later Apply and stays readable in the audit trail.
alter table public.bill_review_queue
  add column if not exists flag_note text,
  add column if not exists flagged_by text,
  add column if not exists flagged_at timestamptz;

-- The page's "Flagged for Nathan" filter reads status + flagged_at.
create index if not exists bill_review_queue_flagged_idx
  on public.bill_review_queue (status, flagged_at desc)
  where status = 'flagged';

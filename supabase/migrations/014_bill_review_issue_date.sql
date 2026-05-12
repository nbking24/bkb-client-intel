-- 014_bill_review_issue_date.sql
--
-- Bill Review dashboard wants the actual bill date from JobTread shown
-- under each row's total instead of the relative-time first_seen_at
-- ("1d ago", "3h ago"). The scanner already pulls documentIssueDate from
-- JT (getJobBillLines), so we just need a column to land it in.
--
-- Stored as text (ISO date string from JT) — JT returns dates as
-- "YYYY-MM-DD" or similar; we keep it as-is and format on the client.
-- Nullable because older queue rows (and the rare bill without an
-- issueDate on JT) won't have it; the UI falls back to first_seen_at
-- in those cases.

alter table public.bill_review_queue
  add column if not exists document_issue_date text;

comment on column public.bill_review_queue.document_issue_date is
  'Issue date of the vendor bill as recorded on the JT document (issueDate field). Used by the Bill Review dashboard to show the real bill date instead of when our scanner first saw the row.';

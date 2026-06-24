-- 028_excluded_vendor_bills.sql
--
-- Tags individual JobTread vendor bill documents as "already billed
-- to client outside the Hub" so the invoicing dashboard stops
-- counting them toward a cost-plus job's unbilled total.
--
-- Motivation: cost-plus projects that pre-date the Hub (e.g. Basarab
-- Ongoing) have vendor bills that were already invoiced to the client
-- through a previous system. The Hub's FIFO match in
-- invoicing-health.ts can't reconcile those bills because the matching
-- customer invoices don't exist in JT - they were sent before the
-- integration. Without a way to flag them, the Hub permanently shows
-- those bills as unbilled work, which inflates the cost-plus alert
-- count and obscures the actual current unbilled backlog.
--
-- The row keyed by doc_id (JT vendorBill document id). job_id is
-- denormalized for cheap per-job lookups during the invoicing-health
-- compute and so we can clean up easily if a job is purged. reason is
-- free-form context the operator can type when excluding a bill (e.g.
-- "Billed on March 2025 invoice from old system").

create table if not exists public.excluded_vendor_bills (
  doc_id       text primary key,
  job_id       text not null,
  reason       text,
  excluded_by  text,
  excluded_at  timestamptz not null default now()
);

create index if not exists excluded_vendor_bills_job_id_idx
  on public.excluded_vendor_bills (job_id);

comment on table public.excluded_vendor_bills is
  'Vendor bills marked as pre-Hub-already-billed. The invoicing-health module filters these out before computing cost-plus unbilled totals.';

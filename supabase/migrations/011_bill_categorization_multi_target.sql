-- 011_bill_categorization_multi_target.sql
--
-- Allow multiple learned targets per (vendor, division, sub_type) so vendors
-- that legitimately split across multiple buckets (e.g. Wehrung's Lumber
-- sometimes onto 04 Framing, sometimes 06 Exterior) can store BOTH preferences
-- with independent confirm counts. The matcher then surfaces all of them as
-- candidates ranked by share-of-approvals instead of flipping the single
-- stored target every time the vendor's bills cross divisions.
--
-- Migration is non-destructive: existing rows stay as-is and become "one
-- target option" for their (vendor, cc, sub) key.

-- Drop the old 3-column unique constraint. Postgres auto-names the
-- constraint as <table>_<col1>_<col2>_<col3>_key — but the name is truncated
-- to 63 chars and the exact form depends on the version, so we discover it
-- by querying pg_constraint instead of guessing the literal name.
do $$
declare
  cn text;
begin
  for cn in
    select conname
    from pg_constraint
    where conrelid = 'public.bill_categorization_patterns'::regclass
      and contype = 'u'
      -- Old constraint covers vendor_account_id + cost_code_number + sub_type_token
      and array_length(conkey, 1) = 3
  loop
    execute 'alter table public.bill_categorization_patterns drop constraint ' || quote_ident(cn);
  end loop;
end $$;

-- New 4-column unique constraint that includes the target. Each
-- (vendor, division, sub, target) combination becomes its own row, so
-- approving the same target twice increments confirm; approving a different
-- target for the same vendor+cc inserts a new row.
alter table public.bill_categorization_patterns
  add constraint bill_pattern_vendor_cc_sub_target_unique
  unique (vendor_account_id, cost_code_number, sub_type_token, target_cost_code_number);

-- Lookup index for the matcher: it loads all patterns for a (vendor, cc, sub)
-- triple and ranks them by confirm count. The old single-column vendor index
-- still helps but a composite index makes the hot read path index-only.
create index if not exists idx_bill_patterns_lookup
  on public.bill_categorization_patterns(vendor_account_id, cost_code_number, sub_type_token);

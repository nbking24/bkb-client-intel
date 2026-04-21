-- ============================================================
-- Bill Categorization Queue + Learning Patterns
--
-- Scans all active JobTread jobs daily, classifies every bill
-- line item against the job's approved budget. Four states:
--
--   uncategorized     line has no jobCostItem link (orphan bill)
--   miscategorized    line IS linked but its own costCode.number
--                     disagrees with jobCostItem.costCode.number
--                     (signals a bad match we should flag)
--   budget_gap        line's cost code has no matching budget
--                     bucket on the job (planning gap — ask
--                     Nathan whether to add a budget item)
--   good              silently categorized and aligned
--
-- Flagged rows land in bill_review_queue so the overview
-- dashboard can surface them with an inline single-click /
-- dropdown approval UX. When Nathan approves a target budget
-- item, we write the pattern into bill_categorization_patterns
-- so the next bill from the same vendor for the same cost code
-- auto-matches without his involvement.
--
-- Day-1 autonomy: agent SUGGESTS only. No writes to JobTread
-- until Nathan has approved from the review UI. This mirrors
-- the ticket system's queue-for-review pattern.
-- ============================================================

-- ---------- queue of bill lines needing review ------------
create table if not exists public.bill_review_queue (
  id uuid primary key default gen_random_uuid(),

  -- JT source handles
  job_id text not null,                      -- e.g. "22P5YZNtEP7V"
  job_name text,
  job_number text,
  document_id text not null,                 -- vendorBill id
  document_number text,                      -- "Bill #142"
  cost_item_id text not null,                -- the line item on the bill
  vendor_account_id text,                    -- vendor account id (learning key)
  vendor_name text,

  -- Bill line fields
  line_name text,
  line_description text,
  line_cost numeric(14, 2),
  line_cost_code_number text,                -- cc on the line itself
  line_cost_code_name text,

  -- Budget link state (null when orphan)
  current_job_cost_item_id text,             -- jobCostItem.id if linked
  current_budget_cost_code_number text,      -- jobCostItem.costCode.number
  current_budget_cost_code_name text,

  -- Classification
  issue_type text not null check (issue_type in (
    'uncategorized',
    'miscategorized',
    'budget_gap'
  )),

  -- Matcher output
  suggested_job_cost_item_id text,           -- best-match budget item on the job
  suggested_budget_item_name text,           -- human label for the suggestion
  suggested_cost_code_number text,
  suggested_cost_code_name text,
  match_source text check (match_source in (
    'learned_pattern',                       -- pattern store hit
    'cost_code_exact',                       -- line cc matches a budget cc
    'cost_code_family',                      -- same division + sub_type
    'vendor_history',                        -- vendor's usual bucket on this job
    'none'                                   -- no suggestion available
  )),
  match_confidence numeric(4, 3),            -- 0.000 – 1.000

  -- Candidate list the UI uses to populate the dropdown
  -- Shape: [{ jobCostItemId, name, costCodeNumber, costCodeName, costCodeId?, budgetCost?, reason }]
  candidate_budget_items jsonb,

  -- Workflow status
  status text not null default 'pending' check (status in (
    'pending',        -- waiting for Nathan
    'approved',       -- Nathan picked a budget item, write pending
    'applied',        -- JT mutation succeeded
    'dismissed',      -- Nathan dismissed (not an issue)
    'failed'          -- JT mutation errored
  )),
  approved_job_cost_item_id text,            -- Nathan's choice
  approved_by text,                          -- 'nathan', 'terri'
  approved_at timestamptz,
  applied_at timestamptz,                    -- when the JT update landed
  last_error text,                           -- if status='failed'

  -- Snapshot of scan run
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One row per (document_id, cost_item_id) so re-scans upsert
  -- instead of duplicating.
  unique (document_id, cost_item_id)
);

create index if not exists idx_bill_review_pending
  on public.bill_review_queue(status, first_seen_at desc)
  where status = 'pending';

create index if not exists idx_bill_review_job
  on public.bill_review_queue(job_id, status);

create index if not exists idx_bill_review_vendor
  on public.bill_review_queue(vendor_account_id, line_cost_code_number);

create index if not exists idx_bill_review_issue
  on public.bill_review_queue(issue_type, status);

-- ---------- learned vendor → budget patterns ------------
-- Key: (vendor_account_id, cost_code_number, sub_type_token)
-- sub_type_token is the trailing 2 digits of the line cost code
-- rolled up from the JT pricebook: 01=Labor, 02=Sub, 03=Material.
-- Example: vendor "Ferguson Home" + costCode "10" + sub "03" ->
--   "Plumbing Materials" budget bucket (1003).
create table if not exists public.bill_categorization_patterns (
  id uuid primary key default gen_random_uuid(),

  -- Learning key (unique)
  vendor_account_id text not null,
  cost_code_number text not null,            -- "10", "19", "16", etc (division)
  sub_type_token text,                       -- "01" | "02" | "03" | null

  -- What Nathan picked (the "answer")
  target_cost_code_number text not null,     -- usually matches the full 4-digit code
  target_cost_code_name text,
  target_budget_item_name_hint text,         -- e.g. "Plumbing - Materials"

  -- Metadata
  vendor_name text,
  times_confirmed int not null default 1,    -- ++ on every Nathan approval
  times_overridden int not null default 0,   -- ++ when Nathan picked something different
  last_confirmed_at timestamptz not null default now(),
  last_job_id text,                          -- most recent job where confirmed

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (vendor_account_id, cost_code_number, sub_type_token)
);

create index if not exists idx_bill_patterns_vendor
  on public.bill_categorization_patterns(vendor_account_id);

create index if not exists idx_bill_patterns_recent
  on public.bill_categorization_patterns(last_confirmed_at desc);

-- ---------- scan run log ------------
-- One row per cron/on-demand scan so we can show "last run" on
-- the overview card and debug when a scan starts misbehaving.
create table if not exists public.bill_scan_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'cron' check (trigger in ('cron', 'manual', 'webhook')),

  jobs_scanned int not null default 0,
  bills_scanned int not null default 0,
  lines_scanned int not null default 0,

  lines_uncategorized int not null default 0,
  lines_miscategorized int not null default 0,
  lines_budget_gap int not null default 0,
  lines_good int not null default 0,

  newly_flagged int not null default 0,
  auto_cleared int not null default 0,       -- previously flagged, now resolved

  error_count int not null default 0,
  errors jsonb,                              -- [{ jobId, message }, ...]

  notes text
);

create index if not exists idx_bill_scan_recent
  on public.bill_scan_runs(started_at desc);

-- ---------- triggers to keep updated_at fresh ------------
create or replace function public.touch_bill_review_queue()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_bill_review_queue on public.bill_review_queue;
create trigger trg_touch_bill_review_queue
  before update on public.bill_review_queue
  for each row execute function public.touch_bill_review_queue();

drop trigger if exists trg_touch_bill_patterns on public.bill_categorization_patterns;
create trigger trg_touch_bill_patterns
  before update on public.bill_categorization_patterns
  for each row execute function public.touch_bill_review_queue();

-- ---------- convenience view: active queue for overview card ------------
create or replace view public.bill_review_open as
select
  q.*,
  extract(epoch from (now() - q.first_seen_at)) / 3600 as hours_open
from public.bill_review_queue q
where q.status = 'pending'
order by
  case q.issue_type
    when 'uncategorized'   then 0
    when 'miscategorized'  then 1
    when 'budget_gap'      then 2
  end,
  q.first_seen_at asc;

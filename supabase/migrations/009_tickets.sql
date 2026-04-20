-- ============================================================
-- BKB Client Hub Tickets
--
-- Terri (and any admin) can submit bug reports / glitch tickets
-- directly from any dashboard page. Submission captures a
-- screenshot, the page URL, and a written description. Claude
-- works the queue from Cowork, updates status, and emails the
-- submitter when fixed. Unfixable tickets escalate to Nathan
-- with full context.
-- ============================================================

-- Main tickets table
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number serial unique,               -- human readable "#24"

  -- Submitter
  submitter_user_id text not null,           -- 'terri', 'nathan', etc.
  submitter_name text,
  submitter_email text,

  -- Ticket content
  title text not null,
  description text,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'urgent')),

  -- Where the issue was seen
  page_url text,                             -- e.g. https://bkb-client-intel.vercel.app/dashboard/invoicing
  viewport_width int,
  viewport_height int,
  user_agent text,

  -- Screenshot (stored in Supabase Storage bucket 'ticket-screenshots')
  screenshot_url text,

  -- Workflow status
  status text not null default 'new' check (status in (
    'new',           -- just submitted, waiting for Claude to pick up
    'in_review',     -- Claude is investigating
    'fixing',        -- Claude has a branch / PR open
    'deployed',      -- fix is live in production
    'escalated',     -- Claude couldn't fix, Nathan needs to handle
    'wont_fix',      -- decided not to fix (by design, out of scope, etc.)
    'closed'         -- submitter confirmed resolved / closing out
  )),

  -- Claude's working context
  claude_branch text,                        -- e.g. 'fix/ticket-24-invoicing-header'
  claude_commit_sha text,                    -- resolving commit once deployed
  claude_pr_url text,                        -- GitHub PR if one was opened
  claude_notes text,                         -- Claude's summary of what it did / attempted

  -- Final resolution
  resolution_note text,                      -- plain language explanation shown to submitter
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tickets_status on public.tickets(status);
create index if not exists idx_tickets_submitter on public.tickets(submitter_user_id);
create index if not exists idx_tickets_recent on public.tickets(created_at desc);
create index if not exists idx_tickets_open on public.tickets(status, created_at desc)
  where status in ('new', 'in_review', 'fixing', 'escalated');

-- Event timeline (audit trail of status changes, comments, etc.)
create table if not exists public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,

  -- Who did it
  actor text not null,                       -- 'terri', 'nathan', 'claude', 'system'
  actor_role text,                           -- 'admin', 'owner', 'agent', 'system'

  -- What happened
  event_type text not null check (event_type in (
    'created',
    'status_changed',
    'commented',
    'claude_investigating',
    'claude_proposed_fix',
    'claude_deployed_fix',
    'claude_escalated',
    'email_sent',
    'screenshot_added'
  )),

  -- Details
  from_status text,                          -- only set for status_changed events
  to_status text,
  note text,                                 -- free-text comment / body
  metadata jsonb,                            -- structured payload (PR url, commit sha, email recipient, etc.)

  created_at timestamptz not null default now()
);

create index if not exists idx_ticket_events_ticket on public.ticket_events(ticket_id, created_at desc);

-- Trigger to keep tickets.updated_at fresh
create or replace function public.touch_ticket_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tickets_touch_updated_at on public.tickets;
create trigger tickets_touch_updated_at
  before update on public.tickets
  for each row execute function public.touch_ticket_updated_at();

-- Convenience view: open queue (what Claude pulls from Cowork)
create or replace view public.ticket_open_queue as
select
  t.*,
  (select count(*) from public.ticket_events e where e.ticket_id = t.id) as event_count
from public.tickets t
where t.status in ('new', 'in_review', 'fixing', 'escalated')
order by
  case t.severity
    when 'urgent' then 0
    when 'high' then 1
    when 'medium' then 2
    when 'low' then 3
  end,
  t.created_at asc;

-- 015_meeting_groups.sql
--
-- Meeting group tracking. When the schedule-meeting flow fans out one
-- Loop appointment per (contact × BKB attendee) so Loop's automations
-- fire for everyone, the resulting events are unrelated as far as Loop
-- is concerned. We need our own grouping so:
--
--   - Cancel-all hits every sibling event + the JT task in one click.
--   - Edit-all updates every sibling event + the JT task in one save.
--   - The lead detail modal can show "one meeting" instead of N rows.
--
-- Each row represents the user-facing "meeting" the user created.
-- ghl_event_ids is the array of sibling appointment IDs the fan-out
-- produced. The DELETE/PUT handlers look up the group by any one of
-- those event ids and apply the action to every entry in the array.

create table if not exists public.meeting_groups (
  id uuid primary key default gen_random_uuid(),
  -- All Loop appointment ids created together as siblings.
  ghl_event_ids text[] not null default '{}',
  -- Optional JT task id (Meetings phase under the linked job). Null
  -- when the meeting was scheduled against a lead with no JT job yet.
  jt_task_id text,
  -- Job linkage (when known). Lets us look up groups by job in the UI.
  jt_job_id text,
  -- Display metadata captured at create time so the management UI
  -- doesn't have to round-trip to Loop for every render.
  title text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  notes text,
  address text,
  -- Loop calendar id the user picked in the dropdown (may differ from
  -- per-attendee fallback calendars).
  calendar_id text not null,
  -- Friendly name of the calendar type ("Discovery Call", "Initial
  -- Consultation - On Site", "Virtual Meeting (60 min)", etc.) so the
  -- UI can show it without an extra fetch.
  calendar_name text,
  -- True when the dropdown calendar matched our virtual-meeting
  -- keyword detector. Drives whether the shared BKB Meet room URL is
  -- stamped into the event.
  is_virtual boolean not null default false,
  -- Snapshot of who's on the meeting. Stored as JSONB so we can hold
  -- arbitrary contact + attendee shapes without a schema change every
  -- time the form evolves.
  contacts jsonb not null default '[]'::jsonb,
  assignees jsonb not null default '[]'::jsonb,
  -- Lifecycle: 'active' once the events exist; 'cancelled' after the
  -- group is cancelled; 'edited' is informational, kept active.
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lookup by any sibling event id (DELETE/PUT handlers receive a single
-- ghlEventId from the UI and need to find the group it belongs to).
create index if not exists idx_meeting_groups_event_ids
  on public.meeting_groups using gin (ghl_event_ids);

-- Lookup by JT job id (lead detail modal lists meetings on a job).
create index if not exists idx_meeting_groups_jt_job_id
  on public.meeting_groups(jt_job_id) where jt_job_id is not null;

-- Lookup by JT task id (job-costing dashboard may show the meeting
-- against its task row).
create index if not exists idx_meeting_groups_jt_task_id
  on public.meeting_groups(jt_task_id) where jt_task_id is not null;

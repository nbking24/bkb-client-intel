-- Add event_date column to project_events
-- This stores when the event actually occurred (e.g. a past meeting date)
-- Falls back to created_at when null (for events logged in real-time)

alter table project_events add column if not exists event_date timestamptz;

-- Index for sorting by event_date with fallback to created_at
create index if not exists idx_project_events_event_date on project_events(coalesce(event_date, created_at) desc);

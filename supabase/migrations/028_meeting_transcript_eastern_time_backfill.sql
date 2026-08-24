-- 028_meeting_transcript_eastern_time_backfill.sql
--
-- Plaud (via Zapier "Create Time") sends the recording time as Eastern
-- wall-clock digits with a bogus "Z" suffix (a 9:31 AM meeting arrives as
-- "2026-08-21T09:31:48Z"). The webhook stored that verbatim, so every
-- recorded_at is 4 hours early (all rows to date fall in EDT). The webhook
-- now re-interprets the digits as America/New_York (app/lib/eastern-time.ts);
-- this one-time backfill fixes the rows that were already ingested.
--
-- Applied 2026-08-24. Every row at that time carried a Plaud timestamp as
-- plaud_recording_id (Zapier maps Create Time to both fields), which is the
-- guard below. No daily-log calendar dates change with this shift, so the
-- JobTread daily logs are left alone.

update public.meeting_transcripts
set recorded_at = (
      (recorded_at at time zone 'UTC')  -- strip the wrong zone, keep the digits
      at time zone 'America/New_York'   -- re-read the digits as Eastern
    ),
    updated_at = now()
where plaud_recording_id ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
  and recorded_at is not null
  and created_at < '2026-08-24T18:00:00Z';

-- Keep the project-memory event dates in step with the transcript rows.
update public.project_events pe
set event_date = mt.recorded_at
from public.meeting_transcripts mt
where pe.source_ref->>'meeting_transcript_id' = mt.id::text
  and mt.recorded_at is not null
  and pe.event_date is distinct from mt.recorded_at;

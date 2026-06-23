-- 027_meeting_transcript_duration_capture.sql
--
-- Two changes to meeting_transcripts to surface recording length on the
-- confirm-transcripts UI:
--
-- 1. Add raw_webhook_payload (jsonb) so we capture the full Plaud
--    payload on every webhook insert. Currently the webhook plucks a
--    handful of named fields and discards the rest, which means when
--    Plaud sends duration in a field name we didn't anticipate, the
--    info is lost. Storing the raw body lets us SELECT into it later
--    to find the right field name without re-instrumenting the
--    integration.
--
-- 2. Backfill duration_seconds for every existing row using a
--    transcript-length estimate. Plaud has never populated duration on
--    inbound payloads (every row in the table has duration_seconds
--    null), so the UI's duration chip has been silently absent for the
--    entire history of the integration. Estimating from raw_transcript
--    length gives Nathan a usable signal today; a future Plaud payload
--    with a real duration field will overwrite the estimate.
--
-- Estimation formula: 17.5 chars/sec, floor at 60 seconds. Calibrated
-- against the few transcripts whose approximate length Nathan recalls
-- (a 1-hour meeting ~= 65K chars). This is intentionally rough — the
-- whole point is "5-min site check vs 45-min design review", not
-- second-level accuracy.

alter table public.meeting_transcripts
  add column if not exists raw_webhook_payload jsonb;

comment on column public.meeting_transcripts.raw_webhook_payload is
  'Full Plaud webhook body captured on insert. Use to discover field names not yet handled by the webhook extractor (e.g. duration variants).';

update public.meeting_transcripts
set duration_seconds = greatest(60, round(length(raw_transcript) / 17.5)::int)
where duration_seconds is null
  and raw_transcript is not null
  and length(raw_transcript) > 0;

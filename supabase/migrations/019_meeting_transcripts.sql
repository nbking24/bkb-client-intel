-- 019_meeting_transcripts.sql
--
-- Meeting Transcript Pipeline (Plaud Note -> Hub -> JobTread/PML).
--
-- A recorder (designer, PM, Terri, Nathan) records a meeting on a Plaud Note
-- device. Plaud transcribes and fires a webhook into the Hub. The transcript
-- lands here as 'unassigned' and shows up on the RECORDER'S own home page,
-- where the Hub has pre-guessed the job/lead (calendar + transcript matching).
-- The recorder confirms (or corrects) the assignment. On confirm we write the
-- full transcript into project_events (PML) so the Ask agent can query it, and
-- (Phase 2) create a JobTread daily-log summary with the transcript attached.

create table if not exists public.meeting_transcripts (
  id uuid primary key default gen_random_uuid(),

  -- Source identity (Plaud). Used for idempotency on webhook redelivery.
  plaud_recording_id text,
  plaud_event_id text,

  -- Which Hub user recorded it -> drives whose review queue it appears in.
  recorded_by_user text,                 -- app_users.id slug, e.g. 'terri'

  -- Display metadata from Plaud.
  title text,
  recorded_at timestamptz,
  duration_seconds int,
  audio_url text,

  -- Full transcript text (also copied into project_events on confirm).
  raw_transcript text,

  -- Calendar context the matcher used (Google Calendar event), if any.
  matched_calendar_event jsonb,

  -- Best-guess assignment for the reviewer to confirm. Either a JT job or a
  -- Loop/GHL lead (contact/opportunity) when no JT job exists yet.
  suggested_kind text check (suggested_kind in ('job','lead')),
  suggested_job_id text,
  suggested_job_name text,
  suggested_lead_contact_id text,
  suggested_lead_name text,
  match_confidence numeric,              -- 0..1
  match_reasoning text,

  -- The confirmed assignment (required before processing).
  assigned_kind text check (assigned_kind in ('job','lead')),
  assigned_job_id text,
  assigned_job_name text,
  assigned_lead_contact_id text,
  assigned_lead_name text,
  assigned_at timestamptz,

  -- Outputs.
  summary text,                          -- daily-log summary (Phase 2)
  jt_daily_log_id text,                  -- created daily log (Phase 2)
  jt_file_id text,                       -- attached transcript file (Phase 2)
  pml_event_id uuid,                     -- project_events row holding the transcript

  -- Lifecycle.
  status text not null default 'unassigned' check (status in (
    'unassigned',   -- waiting for the recorder to confirm the job/lead
    'confirmed',    -- assigned; transcript written to PML
    'processing',   -- building daily log / attachments
    'processed',    -- daily log created (+ file attached) where applicable
    'failed'        -- something went wrong; retryable
  )),
  error_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_meeting_transcripts_plaud
  on public.meeting_transcripts(plaud_recording_id, plaud_event_id)
  where plaud_recording_id is not null;

create index if not exists idx_meeting_transcripts_user_status
  on public.meeting_transcripts(recorded_by_user, status, created_at desc);

create index if not exists idx_meeting_transcripts_status
  on public.meeting_transcripts(status, created_at desc);

create index if not exists idx_meeting_transcripts_job
  on public.meeting_transcripts(assigned_job_id) where assigned_job_id is not null;

-- Map a Plaud workspace member / device identity to a Hub user so incoming
-- transcripts route to the right person's queue. Populated once we know the
-- Plaud member identifiers (after Developer Platform registration). Until then
-- the webhook falls back to PLAUD_DEFAULT_REVIEWER (env) so nothing is lost.
create table if not exists public.plaud_user_map (
  plaud_identity text primary key,       -- email / member id / device id from Plaud payload
  hub_user_id text not null,             -- app_users.id slug
  label text,
  created_at timestamptz not null default now()
);

-- Storage bucket for raw transcript files (private). Guarded insert so it is
-- safe to re-run; ignored if the bucket already exists.
insert into storage.buckets (id, name, public)
values ('meeting-transcripts', 'meeting-transcripts', false)
on conflict (id) do nothing;

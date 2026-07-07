# Marketing Photo Engine

The Photo Engine keeps a per-job marketing media folder for the web designer
current, and notifies the marketing advisor (Mike Roda) when a folder changes.

## Hub / Cowork split

The heavy media work runs in a Cowork/Claude scheduled task, OUTSIDE the Hub:

- Pulls project photos, videos, and approved documents from JobTread via MCP.
- Uses vision to curate photos, transcodes videos with ffmpeg, and builds the
  Word "Marketing Project Profile" document.
- Uploads a per-job folder to the web designer's FTP server.
- Composes a change-summary email and posts it to the Hub notify route.

The Hub is only the lightweight control surface:

- Shows a Job Picker and run status in the Marketing dashboard (Photo Engine tab).
- Lists eligible jobs and lets an owner/admin queue an on-demand run.
- Provides a draft-gated email delivery route.

The Hub does NOT do ffmpeg, docx, sharp, or FTP. Those dependencies live in the
Cowork task. Keep the Hub dependency-light.

## Eligible jobs and folder naming

Eligible jobs are active jobs (`closedOn = null`) whose JobTread custom field
named `Marketing` (case-insensitive) is truthy (`"true"`, `"yes"`, `"1"`, or
boolean true). See `getMarketingJobs()` in `app/api/lib/jobtread.ts`.

Folder name rule: replace the FIRST space in the job name with a hyphen.
`"Edwards Pool House"` becomes `"Edwards-Pool House"`. See `folderNameForJob()`.

## Routes and contracts

All routes are under `app/api/marketing/photo-engine/`. The three read/queue
routes require `validateAuth` with role in `owner` or `admin` (403 otherwise).
The notify route is cron-secret gated instead (server to server).

- `GET jobs` returns `{ jobs: [...], liveMode }`. Each job is merged with its
  latest run row (status, photos/videos counts, profile updated, email status,
  completed at). `liveMode` is read from the settings row.
- `POST queue` body `{ jobId }`. Confirms the job is eligible, inserts a
  `marketing_photo_runs` row with `status='queued', trigger='manual'`, returns
  `{ run }`. The Cowork task polls for queued rows.
- `GET runs` returns `{ runs: [...] }`, the ~30 most recent runs newest first.
- `POST notify` body `{ runId?, jobFolder, subject, html, text? }`. Draft-gated
  delivery (see below).

## Draft gate

Nothing is emailed externally unless BOTH are true:

1. Settings row `marketing_photo_settings.live_mode = true`
2. Env `MARKETING_PHOTO_ENGINE_LIVE === 'true'`

If either is off, the notify route marks the run `email_status='held'` (when a
`runId` is supplied) and returns `{ sent: false, held: true, reason: 'draft mode' }`
with status 200. Only when both are on does it call `sendEmail` to the settings
recipient (default `mike@lighthoused.com`) and set `email_status='sent'`.

The dashboard shows a persistent amber draft banner whenever `liveMode` is false.

## Environment variables

- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`. Already exist (shared email wrapper).
- `CRON_SECRET`. Already exists, gates the notify route (or App PIN base64).
- `MARKETING_PHOTO_ENGINE_LIVE`. NEW, must be `'true'` (with settings.live_mode)
  before any email is sent.
- FTP credentials for the designer's server live in the Cowork task, NOT the Hub.

## Run lifecycle

`marketing_photo_runs.status`: `queued` -> `processing` -> `complete` (or
`error`). The Hub inserts the `queued` row. The Cowork task advances the status
as it does the work. A runs status-update endpoint (so the Cowork task can PATCH
status, counts, change summary, and set `completed_at`) can be added later. It
is out of scope for Phase 1.

`email_status`: `draft` (initial) -> `held` (draft gate) or `sent` (live). The
notify route sets `held` or `sent`.

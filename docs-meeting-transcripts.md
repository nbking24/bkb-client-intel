# Meeting Transcript Pipeline — Phase 1 (feat/meeting-transcripts)

Plaud Note recording → Hub review queue → confirm → JobTread/PML.

## What ships in Phase 1
- `meeting_transcripts` table + `plaud_user_map` + private `meeting-transcripts` storage bucket (migration `019`).
- `POST /api/webhook/plaud` — secret-verified intake, dedupe, recorder mapping, calendar-aware auto-match.
- `app/lib/transcript-matcher.ts` — Google Calendar + transcript → best-guess job/lead (Claude).
- `GET /api/transcripts` and `POST /api/transcripts/:id/confirm`.
- `TranscriptsToConfirm` card on the Overview (widget `transcripts_confirm`) and the Field home. Self-hides when empty.
- On confirm: full transcript is written to `project_events` (PML), so the Ask agent can query it immediately, scoped to the job (or to a Loop lead when no job exists yet — `job_id` stays null with `ghl_contact_id` in `source_ref`, and `backfillProjectEventsForLead` promotes it to the job on conversion).

## Phase 2 (now in this branch)
- Generate the bounded daily-log summary (respect `MAX_DAILY_LOG_CHARS`, run the one-time empirical limit test) and create the JobTread daily log on confirm.
- Add `createDailyLogFile()` to `app/lib/jobtread.ts` (createUploadRequest → upload → createFile) and attach the raw transcript to that daily log.
- Optional: backfill a daily log into the JobTread job when a lead later converts.

## Manual steps (only Nathan can do these)
1. **Register the Plaud Developer Platform app** (account creation — must be done by you), or set up the Zapier relay. Either delivers the `transcript_ready` payload to `/api/webhook/plaud`.
2. **Set env vars in Vercel:** `PLAUD_WEBHOOK_SECRET` (shared secret on the webhook URL) and `PLAUD_DEFAULT_REVIEWER` (fallback Hub user id, e.g. `nathan`).
3. **Point Plaud/Zapier** at `https://<hub-url>/api/webhook/plaud?secret=<PLAUD_WEBHOOK_SECRET>` (or send the secret as `x-plaud-secret`).
4. **Apply migration 019** to Supabase.
5. **Seed `plaud_user_map`** once we know each recorder's Plaud member identity (email/member id) → Hub user id. Until seeded, everything routes to `PLAUD_DEFAULT_REVIEWER`.
6. **Grant the `transcripts_confirm` widget** to the relevant users in the admin dashboard (owners/admins get it via preset).

## Note on the payload
The webhook extracts fields tolerantly (it checks several likely key names) because the exact Plaud payload shape is finalized at developer-app registration. Adjust the `pick(...)` paths in `app/api/webhook/plaud/route.ts` once we see a real payload.

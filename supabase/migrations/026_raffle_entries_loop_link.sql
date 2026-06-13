-- Track Loop (GHL) contact id, and whether/when BKB has followed up.
alter table raffle_entries
  add column if not exists loop_contact_id text,
  add column if not exists loop_synced_at  timestamptz,
  add column if not exists loop_sync_error text,
  add column if not exists contacted_at    timestamptz,
  add column if not exists contacted_by    text,
  add column if not exists contact_notes   text;

create index if not exists raffle_entries_followup_idx
  on raffle_entries (contact_ok, contacted_at)
  where deleted_at is null and contact_ok = true;

create index if not exists raffle_entries_loop_contact_idx
  on raffle_entries (loop_contact_id)
  where deleted_at is null and loop_contact_id is not null;

# Past-Client Outreach — Operator Playbook

Scripts that run on Nathan's Mac during the one-time bulk past-client
text campaign. All three talk to the Client Hub API using the
`TICKET_AGENT_TOKEN` env var.

## Prerequisites

1. **Python 3 + openpyxl** — `pip3 install openpyxl`

2. **Token** — all three scripts need `TICKET_AGENT_TOKEN` (the same
   agent-auth token used by the tickets pipeline). They'll resolve it
   in this order:

       CLI flag  →  env var  →  ~/.bkb-pco.env file

   **Easiest setup** (no shell-profile editing):
   ```bash
   echo "TICKET_AGENT_TOKEN=YOUR_TOKEN_HERE" > ~/.bkb-pco.env
   chmod 600 ~/.bkb-pco.env
   ```
   Do this once. All three scripts pick it up automatically. Verify with:
   ```bash
   python3 scripts/past-client/chat-db-scanner.py --preflight
   ```

3. **Full Disk Access** for the Python binary — required for
   `chat-db-scanner.py` only. Run the preflight once to see the exact
   binary path you need to grant:
   ```bash
   python3 scripts/past-client/chat-db-scanner.py --preflight
   ```
   If FDA isn't granted, the preflight prints the exact steps including
   the `/usr/bin/python3` path (or whichever Python you're using) so
   you can paste it directly into the System Settings dialog.

4. **Messages signed into iCloud** and paired with your iPhone for SMS
   fallback on non-iMessage numbers.

## Workflow

### 1. Load the spreadsheet into the database (one-time, or after edits)

```bash
export TICKET_AGENT_TOKEN="xxx"
python3 scripts/past-client/load-send-queue.py \
    --xlsx "/path/to/BKB-Send-Queue-Review.xlsx"
```

Idempotent. Re-run any time Nathan edits column O — existing rows get
their text refreshed without resetting send state.

Dry run first if you want to inspect the parse:
```bash
python3 scripts/past-client/load-send-queue.py --dry-run
```

### 2. Kick off the paced sender

**Interactive mode** (recommended for the first batch) — preview each
message and press `y` to send:
```bash
python3 scripts/past-client/imessage-sender.py --mode interactive
```

**Batch mode** — fire-and-forget with pacing:
```bash
python3 scripts/past-client/imessage-sender.py --mode batch --max-sends 20
```

The sender respects:
- 9am-7pm local (configurable via `--start-hour` / `--end-hour`)
- 45-90 second jitter between sends (configurable via `--min-delay` / `--max-delay`)
- API-side daily cap (default 30, env `PCO_DAILY_CAP`)
- Ctrl-C stops cleanly without marking the current one sent

Expect 4-5 working days to clear ~139 contacts at 30/day.

### 3. Reply scanner — runs on a schedule

Schedule this via the `schedule` skill (or cron/launchd) every 30
minutes during the campaign:

```bash
python3 scripts/past-client/chat-db-scanner.py
```

It:
- Reads new inbound messages from `~/Library/Messages/chat.db` since
  last scan
- Matches by 10-digit phone to `past_client_outreach` rows in an
  active stage
- POSTs each match to `/record-reply`, which auto-detects STOP /
  unsubscribe language and routes to `opted_out`

State persists in `~/.bkb-chatdb-scanner-state.json` so it only
processes new messages across runs.

### 4. Watch the dashboard

`/dashboard/marketing/past-client-outreach` in the Client Hub —
funnel at top, per-row actions (skip, opt-out), drill-down to see
what was sent and what came back.

## Troubleshooting

**`authorization denied` when scanning chat.db** — grant Full Disk
Access to the Python binary you're running (not just Terminal). Easiest
way: add `/usr/bin/python3` explicitly in the Full Disk Access list.

**Send succeeded but mark-sent 500'd** — very rare. Fix the one row
manually in the pco dashboard (mark it as initial_sent for that
contact) before resuming the sender, otherwise it'll be re-sent next
run.

**Sender says "Queue empty" but rows clearly exist** — check that
`initial_text_body` is populated (column O) AND `phone_digits` is set.
Rows missing either are invisible to the sender.

**iMessage send errors out with "can't get buddy"** — the recipient's
phone isn't formatted as E.164 in Messages, or iMessage isn't
registered for them and Text Message Forwarding isn't set up on your
iPhone. The sender tries SMS as a fallback; if that also fails, leave
that row as `skipped` with a manual note.

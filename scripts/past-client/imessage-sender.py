#!/usr/bin/env python3
"""
imessage-sender.py

Paced iMessage sender for the past-client outreach campaign.

Runs on Nathan's Mac. Loops through the queued contacts in
past_client_outreach, sends the stored initial_text_body via AppleScript
to Messages, then marks each row sent through the Client Hub API.

Pacing:
    - 45-90 second jitter between sends (configurable)
    - Only sends 09:00-19:00 local time (configurable)
    - Respects DAILY_CAP returned by the API
    - Exits cleanly when the queue is empty or we're over the cap

Usage:
    python3 imessage-sender.py \\
        --api https://bkb-client-intel.vercel.app \\
        --token "$TICKET_AGENT_TOKEN" \\
        --mode interactive   # preview each before sending (default: batch)

Modes:
    batch       — fire-and-forget with pacing (default)
    interactive — show each message and wait for y/n before sending
    preview     — show queue without sending (dry run)

Flags:
    --min-delay  seconds min between sends (default 45)
    --max-delay  seconds max between sends (default 90)
    --start-hour  local hour to start sending (default 9)
    --end-hour    local hour to stop sending (default 19)
    --max-sends   cap on total sends this run (default: no cap beyond DAILY_CAP)
"""
import argparse
import json
import os
import random
import sqlite3
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _config  # noqa: E402

# Apple's date format for ~/Library/Messages/chat.db is nanoseconds
# since 2001-01-01 UTC. Unix epoch = 978307200 seconds before that.
APPLE_EPOCH_OFFSET = 978307200


class VerifyUnavailable(Exception):
    """Raised when chat.db cannot be read (FDA not granted, file missing, etc).
    Distinguished from a verified-false because we can't tell whether the send
    actually happened. Caller should trust the AppleScript success in that case."""


def _verify_recent_send(phone_e164, body, max_age_seconds=15, debug=False):
    """
    Look in ~/Library/Messages/chat.db for an outbound message containing the
    first ~60 chars of `body`, sent in the last `max_age_seconds`. We search
    by body-text only (not recipient handle) because SMS-via-forwarding can
    use a different handle.id format than iMessage, which made the previous
    handle-match query miss real sends.

    Returns True if a matching outbound message exists (verified delivered).
    Returns False if chat.db was readable but no matching row found
    (verified-false → recipient probably not on iMessage).
    Raises VerifyUnavailable if chat.db can't be read (FDA missing, etc) —
    caller should NOT treat this as a delivery failure.
    """
    chat_db = os.path.expanduser("~/Library/Messages/chat.db")
    if not os.path.exists(chat_db):
        raise VerifyUnavailable(f"chat.db not found at {chat_db}")

    # Build a whitespace-normalized snippet of the body for fuzzy matching.
    # We normalize BOTH the body and chat.db text the same way so newline
    # differences (literal \n vs actual newlines vs different runs of
    # whitespace) don't false-fail. Verified 2026-04-28: Kara's send
    # actually delivered but the previous verify said "not on iMessage"
    # because the body had real newlines and match_snippet had spaces.
    def _normalize(s):
        return " ".join((s or "").split())
    body_normalized = _normalize(body)
    if len(body_normalized) < 10:
        # Too short to uniquely identify our send; bail
        return False
    snippet = body_normalized[:60]

    try:
        conn = sqlite3.connect(f"file:{chat_db}?mode=ro", uri=True)
        cur = conn.cursor()
        cutoff_apple_ns = (time.time() - max_age_seconds - APPLE_EPOCH_OFFSET) * 1e9

        # Get recent outbound messages in the window. Match by body presence —
        # search the first ~30 chars of our body inside each message text.
        cur.execute(
            """
            SELECT m.text, h.id, m.service, m.date
            FROM message m
            LEFT JOIN handle h ON m.handle_id = h.ROWID
            WHERE m.is_from_me = 1
              AND m.date > ?
              AND m.text IS NOT NULL
            ORDER BY m.date DESC
            LIMIT 25
            """,
            (cutoff_apple_ns,),
        )
        rows = cur.fetchall()
        conn.close()

        # Use a stricter sub-snippet for matching (first 30 chars after
        # collapsing whitespace). Body texts in our campaign always begin
        # with "Hey <name>," or "Yo <name>," so this is unique-enough.
        match_snippet = snippet[:30]
        if debug:
            print(
                f"verify debug: looking for snippet={match_snippet!r} in last "
                f"{max_age_seconds}s, found {len(rows)} candidate outbound rows",
                file=sys.stderr,
            )
            for text, handle_id, service, _date in rows[:5]:
                preview = (text or "")[:60].replace("\n", "\\n")
                print(
                    f"  candidate: handle={handle_id!r} service={service!r} text={preview!r}",
                    file=sys.stderr,
                )

        for text, _handle_id, _service, _date in rows:
            if text and match_snippet in _normalize(text):
                return True
        return False
    except sqlite3.OperationalError as e:
        # Auth-denied means we can't read chat.db at all (FDA not granted to
        # whichever process spawned us). That's NOT a verified-false — it
        # means we can't tell. Raise VerifyUnavailable so the caller can
        # fall back to trusting the AppleScript success.
        if "authorization" in str(e).lower():
            raise VerifyUnavailable(
                f"chat.db not readable (Full Disk Access not granted to {sys.executable})"
            ) from e
        # Other sqlite errors are also unverifiable, not verified-false.
        raise VerifyUnavailable(f"sqlite error reading chat.db: {e}") from e
    except sqlite3.DatabaseError as e:
        raise VerifyUnavailable(f"chat.db read failed: {e}") from e


def api_get(api_base, path, token):
    url = f"{api_base.rstrip('/')}{path}"
    req = urllib.request.Request(url, headers={"x-agent-token": token})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def api_post(api_base, path, token, body):
    url = f"{api_base.rstrip('/')}{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-agent-token": token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {body}") from e


def _invoke_app(applet, command, phone_e164, body):
    """Run the BKB-Send-iMessage.app applet with the given send command.
    Returns the service tag printed by the AppleScript ('iMessage' or 'SMS')
    on success. Raises RuntimeError on AppleScript-level errors."""
    result = subprocess.run(
        [applet, command, phone_e164, body],
        capture_output=True,
        text=True,
        timeout=30,
    )
    out = (result.stdout or "").strip()
    err = (result.stderr or "").strip()
    if "BKB_SEND_ERROR" in out or "BKB_SEND_ERROR" in err:
        raise RuntimeError(f"applet '{command}' error: {out or err}")
    if out.startswith("ERROR"):
        raise RuntimeError(out)
    if result.returncode != 0:
        raise RuntimeError(f"applet '{command}' exit {result.returncode}: {err or out}")
    return out


def send_imessage(phone_digits, body):
    """
    Send and VERIFY delivery via inline osascript (NOT the .app bundle).

    Why: macOS attributes Apple Events to the "responsible binary" up the
    process tree. For .command files, that's /bin/bash, which Apple has
    locked out of Automation permissions for security. The .app bundle
    approach didn't fix this because TCC still attributed up to bash.

    Inline osascript invocation makes osascript itself the leaf-process
    sender — and osascript is system-managed with stable Automation
    permissions. First invocation triggers a one-time "Terminal wants to
    control Messages" prompt; click Allow once and it sticks.

    Process: python → osascript → Messages.
    AppleScript reports success even when Messages silently drops a send
    (recipient not on iMessage), so we ALWAYS verify via chat.db.
    """
    to = f"+1{phone_digits}"
    # Escape body for embedding in AppleScript string literal
    body_esc = body.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    script = (
        'tell application "Messages"\n'
        '    set targetService to 1st service whose service type = iMessage\n'
        f'    set targetBuddy to buddy "{to}" of targetService\n'
        f'    send "{body_esc}" to targetBuddy\n'
        'end tell\n'
    )
    try:
        result = subprocess.run(
            ["/usr/bin/osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("osascript send timed out after 30s")
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"osascript send failed: {err}")

    # Verify via chat.db that the message actually queued. AppleScript
    # silently no-ops for non-iMessage recipients — this is the ground truth.
    # If chat.db can't be read at all (FDA not granted to launchd-spawned
    # python), trust the AppleScript success and return a special channel
    # value so the caller can flag this as unverified.
    time.sleep(4)
    try:
        verified = _verify_recent_send(to, body, max_age_seconds=15)
    except VerifyUnavailable as ve:
        # Don't false-fail real sends just because we can't see chat.db.
        # Print once per run-attempt so the operator knows verification
        # was skipped. The launchd run-as-root case lands here — granting
        # FDA to /usr/bin/python3 fixes it.
        print(
            f"  ⚠ chat.db verify unavailable ({ve}). "
            f"Trusting AppleScript success — marking as iMessage_unverified.",
            file=sys.stderr,
        )
        return "iMessage_unverified"

    if verified:
        return "iMessage"

    # chat.db readable, no matching row → recipient isn't on iMessage
    # (AppleScript silently dropped the send).
    raise NotOnIMessage(
        f"{to} is not on iMessage — message was not delivered. "
        f"Contact will be flagged for manual SMS."
    )


class NotOnIMessage(Exception):
    """Raised when iMessage send completes per AppleScript but the message
    didn't actually queue (recipient not on iMessage). Caller should mark
    the contact as 'failed' rather than 'sent'."""


def in_business_hours(start_hour, end_hour):
    now = datetime.now()
    return start_hour <= now.hour < end_hour


def display_contact(c):
    name = c.get("full_name") or f"{c.get('first_name','')} {c.get('last_name','')}".strip()
    return f"{name or 'Unknown'} ({c.get('phone','?')})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api")
    ap.add_argument("--token")
    ap.add_argument("--mode", choices=["batch", "interactive", "preview"], default="batch")
    ap.add_argument("--min-delay", type=int, default=45)
    ap.add_argument("--max-delay", type=int, default=90)
    ap.add_argument("--start-hour", type=int, default=9)
    ap.add_argument("--end-hour", type=int, default=19)
    ap.add_argument("--max-sends", type=int, default=0, help="0 = no session cap")
    ap.add_argument("--only-key", default=None,
                    help="Only attempt this specific contact_key. Bypasses next-queued. "
                         "Used for targeted testing of one contact.")
    ap.add_argument("--ignore-hours", action="store_true",
                    help="Skip the business-hours gate (use with care)")
    args = ap.parse_args()

    args.api = _config.get_api_base(cli_value=args.api)
    try:
        args.token = _config.get_token(cli_value=args.token)
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    if not args.ignore_hours and not in_business_hours(args.start_hour, args.end_hour):
        print(f"Outside send window ({args.start_hour:02d}:00-{args.end_hour:02d}:00). "
              f"Current hour: {datetime.now().hour:02d}. Exiting.")
        return

    # ── DEFENSE LAYER 1: persistent seen-set ─────────────────────
    # ~/.bkb-pco-sent.log records every contact_key we've EVER sent to.
    # Even if the API is wildly stale, we never send to the same contact twice.
    # Format: one contact_key per line.
    SEEN_LOG = os.path.expanduser("~/.bkb-pco-sent.log")
    seen_keys_persistent = set()
    try:
        if os.path.exists(SEEN_LOG):
            with open(SEEN_LOG, "r") as f:
                for line in f:
                    k = line.strip()
                    if k:
                        seen_keys_persistent.add(k)
            print(f"Loaded {len(seen_keys_persistent)} previously-sent contact keys from {SEEN_LOG}")
    except Exception as e:
        print(f"Warning: could not read {SEEN_LOG}: {e}", file=sys.stderr)

    def record_sent(key):
        seen_keys_persistent.add(key)
        try:
            with open(SEEN_LOG, "a") as f:
                f.write(key + "\n")
        except Exception as e:
            print(f"Warning: could not append to {SEEN_LOG}: {e}", file=sys.stderr)

    # ── DEFENSE LAYER 2: within-run seen-set ─────────────────────
    sent_keys_this_run = set()

    sent_this_run = 0
    while True:
        if args.max_sends and sent_this_run >= args.max_sends:
            print(f"Hit session cap of {args.max_sends}. Stopping.")
            break

        # ── --only-key: targeted-test mode. Bypass next-queued entirely
        # and fetch the specified contact's row by phone_digits. After
        # processing once, exit cleanly so we don't retarget queue.
        if args.only_key:
            if args.only_key in sent_keys_this_run:
                print(f"--only-key {args.only_key} already processed this run. Done.")
                break
            try:
                # list endpoint supports `key` filter via Supabase rest
                res = api_get(
                    args.api,
                    f"/api/marketing/past-client/list?contact_key={args.only_key}",
                    args.token,
                )
            except Exception as e:
                print(f"API error fetching contact: {e}", file=sys.stderr)
                break
            rows = res.get("rows") if isinstance(res, dict) else None
            contact = rows[0] if rows else None
            if not contact:
                print(f"--only-key {args.only_key}: no matching row found. Done.")
                break
            print(f"[--only-key] Targeting {display_contact(contact)}")
        else:
            # Pass the seen-log as exclude_keys so the API explicitly skips
            # them at query time (defense against any upstream cache staleness)
            # Combine persistent + within-run sets so both layers exclude.
            exclude_set = seen_keys_persistent | sent_keys_this_run
            exclude_param = ",".join(sorted(k for k in exclude_set if k.isdigit() and len(k) == 10))
            path = "/api/marketing/past-client/next-queued"
            if exclude_param:
                path += f"?exclude_keys={exclude_param}"

            try:
                res = api_get(args.api, path, args.token)
            except Exception as e:
                print(f"API error fetching next: {e}", file=sys.stderr)
                time.sleep(30)
                continue

            if res.get("at_cap"):
                print(f"Daily cap reached ({res.get('daily_count')}/{res.get('daily_cap')}). "
                      f"Try again tomorrow.")
                break

            contact = res.get("contact")
            if not contact:
                print("Queue empty — nothing left to send. Done.")
                break

        body = contact.get("initial_text_body")
        phone_digits = contact.get("phone_digits")
        contact_key = contact.get("contact_key")
        if not body or not phone_digits:
            print(f"Skipping {display_contact(contact)} — missing body or phone. "
                  f"Will need a manual fix.")
            # Don't loop infinitely on the same row; skip it.
            api_post(args.api, "/api/marketing/past-client/skip", args.token,
                     {"contact_key": contact_key, "reason": "missing body or phone at send time"})
            continue

        # ── DEFENSE LAYER 1 CHECK: persistent seen-set ──
        # If this contact_key was sent in ANY past run, the API is returning stale data.
        # We do NOT call /skip here — that would corrupt an already-sent row's stage.
        # Just abort. The exclude_keys param above SHOULD prevent this from ever
        # triggering, but it's here as a last-resort safety net.
        # --only-key intentionally bypasses this: it's an explicit retry of one contact.
        if contact_key in seen_keys_persistent and not args.only_key:
            print(f"⚠ ABORT: next-queued returned {contact_key} ({display_contact(contact)}), "
                  f"but our seen-log says we already sent to them.", file=sys.stderr)
            print(f"  exclude_keys filter should have prevented this — possible cache issue.",
                  file=sys.stderr)
            print(f"  No DB action taken. Re-run later if needed.", file=sys.stderr)
            break

        # ── DEFENSE LAYER 2 CHECK: within-run seen-set ──
        # If this contact came up twice in the SAME run, mark-sent isn't taking effect
        # OR the cache is feeding us the same row. Hard stop.
        if contact_key in sent_keys_this_run:
            print(f"⚠ ABORT: next-queued returned the SAME contact ({contact_key}) twice "
                  f"in this run.", file=sys.stderr)
            print(f"  Stopping immediately to prevent a duplicate send.", file=sys.stderr)
            break

        print()
        print("─" * 60)
        print(f"→ {display_contact(contact)}")
        print(f"  Daily progress: {res.get('daily_count', 0)}/{res.get('daily_cap', '?')}")
        print("─" * 60)
        print(body)
        print("─" * 60)

        if args.mode == "preview":
            print("[PREVIEW] Not sending. Exit with Ctrl-C.")
            time.sleep(1)
            # In preview mode we'd need to NOT mark as sent — otherwise we'd burn through
            # the queue without sending. So bail out after the first preview.
            print("Preview mode only shows the first queued contact. Exiting.")
            break

        if args.mode == "interactive":
            try:
                answer = input("Send this? [y/N/skip/quit] ").strip().lower()
            except (KeyboardInterrupt, EOFError):
                print("\nAborted.")
                break
            if answer == "quit" or answer == "q":
                break
            if answer == "skip" or answer == "s":
                api_post(args.api, "/api/marketing/past-client/skip", args.token,
                         {"contact_key": contact_key, "reason": "operator skipped at send time"})
                print("Skipped.")
                continue
            if answer not in ("y", "yes"):
                print("Not sent. Moving on without marking — will re-surface next poll.")
                # Small wait so we don't hammer the API
                time.sleep(5)
                continue

        # Send
        try:
            service = send_imessage(phone_digits, body)
        except NotOnIMessage as e:
            # Recipient isn't on iMessage. Mark as 'failed' in DB so they
            # surface in the dashboard's "manual outreach needed" bucket,
            # AND record in seen-log so we don't retry them automatically.
            print(f"  ⚠ {display_contact(contact)}: {e}", file=sys.stderr)
            try:
                api_post(args.api, "/api/marketing/past-client/bulk-load", args.token, {
                    "rows": [{
                        "contact_key": contact_key,
                        "stage": "failed",
                        "flag_notes": "Not on iMessage — manual SMS needed (auto-flagged by sender)",
                    }],
                })
                print(f"  Marked {contact_key} as failed in DB.", file=sys.stderr)
            except Exception as me:
                print(f"  WARNING: could not mark failed: {me}", file=sys.stderr)
            sent_keys_this_run.add(contact_key)
            record_sent(contact_key)
            # Count failed-routes toward the session cap. Without this, a
            # systemic failure (e.g. FDA missing → every contact "fails"
            # verification) would blow through the entire queue in one run.
            # Burned by this 2026-04-28: 158 contacts processed in one
            # evening run before we caught it.
            sent_this_run += 1
            print(f"  Moving on to next contact. Total processed this run: {sent_this_run}",
                  file=sys.stderr)
            time.sleep(2)
            continue
        except Exception as e:
            print(f"Send failed for {display_contact(contact)}: {e}", file=sys.stderr)
            # Leave as queued — operator can investigate and retry
            print("Leaving as queued for manual retry. Stopping to avoid cascading failures.")
            break

        # ── CRITICAL: record the send in BOTH dedupe sets immediately,
        # ── BEFORE attempting mark-sent. If mark-sent fails or the API
        # ── lies about the queue, our local sets prevent re-sending.
        sent_keys_this_run.add(contact_key)
        record_sent(contact_key)

        # Mark sent
        try:
            api_post(args.api, "/api/marketing/past-client/mark-sent", args.token,
                     {"contact_key": contact_key, "sent_body": body})
        except Exception as e:
            print(f"WARNING: send succeeded via {service} but mark-sent failed: {e}",
                  file=sys.stderr)
            print(f"This contact ({contact_key}) is now in the local seen-log "
                  f"and will be skipped on future runs even if the API still shows them as queued.")
            print("Stopping this run to avoid cascading issues.")
            break

        sent_this_run += 1
        print(f"✓ Sent via {service}. Total this run: {sent_this_run}")

        # Jitter (unless this was the last one)
        delay = random.randint(args.min_delay, args.max_delay)
        print(f"Waiting {delay}s…")
        try:
            time.sleep(delay)
        except KeyboardInterrupt:
            print("\nAborted during wait. Stopped cleanly.")
            break

        # Re-check hours in case we crossed the end-hour boundary mid-run
        if not args.ignore_hours and not in_business_hours(args.start_hour, args.end_hour):
            print(f"Crossed into quiet hours. Stopping for the day.")
            break


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Reconcile DB rows currently marked 'failed' against actual chat.db history.

After the 2026-04-28 evening misfire, 158 contacts got marked stage='failed'
because the launchd-spawned sender couldn't read chat.db (FDA missing) and
treated every 'verify unavailable' as a delivery failure. The AppleScript
sends almost certainly went through — chat.db is the source of truth for
who actually received an outbound iMessage.

This script:
  1. Reads ~/Library/Messages/chat.db (requires Full Disk Access to whichever
     process you run this from — Terminal works, launchd doesn't unless FDA
     is granted to the script's interpreter).
  2. Pulls every DB row with stage='failed' from the past_client_outreach API.
  3. For each, looks for an outbound message in chat.db within the last
     `--lookback-hours` hours, matched by phone-number snippet match in
     handle.id (which lives even for SMS-via-forwarding).
  4. If found → mark stage='initial_sent' (with initial_sent_at = the
     chat.db timestamp).
     If not found → mark stage='queued' (genuine failure, not on iMessage
     OR the send genuinely didn't happen).

Usage:
  /usr/bin/python3 scripts/past-client/reconcile-failed-from-chatdb.py \
      --lookback-hours 24 --dry-run    # preview only
  /usr/bin/python3 scripts/past-client/reconcile-failed-from-chatdb.py \
      --lookback-hours 24              # actually apply
"""
import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _config

# Apple's date format: nanoseconds since 2001-01-01 UTC.
APPLE_EPOCH_OFFSET = 978307200


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
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def digits_only(phone):
    return "".join(c for c in str(phone or "") if c.isdigit())


def find_outbound_to_number(cur, phone_digits, since_apple_ns):
    """
    Return (timestamp_iso, body) for the most recent outbound iMessage to
    a phone number matching `phone_digits`, sent after `since_apple_ns`.
    Returns None if no match.

    Match is by digits-only suffix on handle.id, which works for both
    iMessage (+1XXXXXXXXXX) and SMS-via-forwarding (XXXXXXXXXX or
    +1XXX-XXX-XXXX) handle formats.
    """
    cur.execute(
        """
        SELECT m.text, m.date, h.id
        FROM message m
        JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.is_from_me = 1
          AND m.date > ?
          AND h.id IS NOT NULL
        ORDER BY m.date DESC
        LIMIT 5000
        """,
        (since_apple_ns,),
    )
    target = phone_digits[-10:]  # last 10 digits — strip country code
    for text, date_ns, handle_id in cur.fetchall():
        handle_digits = digits_only(handle_id)
        if handle_digits.endswith(target):
            ts_unix = (date_ns / 1e9) + APPLE_EPOCH_OFFSET
            ts_iso = datetime.fromtimestamp(ts_unix, tz=timezone.utc).isoformat()
            return ts_iso, text
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api")
    ap.add_argument("--token")
    ap.add_argument("--lookback-hours", type=int, default=24,
                    help="How far back to search chat.db (default 24)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Preview reclassifications without writing")
    args = ap.parse_args()

    args.api = _config.get_api_base(cli_value=args.api)
    args.token = _config.get_token(cli_value=args.token)

    chat_db = os.path.expanduser("~/Library/Messages/chat.db")
    if not os.path.exists(chat_db):
        print(f"✗ chat.db not at {chat_db}", file=sys.stderr)
        sys.exit(2)

    try:
        conn = sqlite3.connect(f"file:{chat_db}?mode=ro", uri=True)
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM message LIMIT 1")
    except sqlite3.OperationalError as e:
        if "authorization" in str(e).lower():
            print(
                "✗ Full Disk Access not granted to this Python interpreter.\n"
                f"  Interpreter: {sys.executable}\n"
                "  Fix: System Settings → Privacy & Security → Full Disk Access\n"
                "       click + and add /usr/bin/python3 (or whichever path above).",
                file=sys.stderr,
            )
        else:
            print(f"✗ chat.db sqlite error: {e}", file=sys.stderr)
        sys.exit(3)

    print(f"▸ Fetching all stage='failed' rows from API...")
    res = api_get(args.api, "/api/marketing/past-client/list?stage=failed&limit=500", args.token)
    failed_rows = res.get("rows", [])
    print(f"  Found {len(failed_rows)} contacts in stage='failed'")
    print()

    if not failed_rows:
        print("Nothing to reconcile. Done.")
        return

    cutoff_apple_ns = int((time.time() - args.lookback_hours * 3600 - APPLE_EPOCH_OFFSET) * 1e9)
    print(f"▸ Searching chat.db for outbound messages in the last {args.lookback_hours}h...")
    print()

    delivered = []
    not_delivered = []

    for row in failed_rows:
        contact_key = row.get("contact_key")
        phone_digits = row.get("phone_digits") or digits_only(row.get("phone"))
        name = row.get("full_name") or f"{row.get('first_name','')} {row.get('last_name','')}".strip()
        if not phone_digits:
            print(f"  ? {name} ({contact_key}): no phone, skipping")
            continue
        match = find_outbound_to_number(cur, phone_digits, cutoff_apple_ns)
        if match:
            ts_iso, body = match
            preview = (body or "")[:50].replace("\n", " ")
            print(f"  ✓ {name}: outbound found at {ts_iso[:19]} — '{preview}...'")
            delivered.append((contact_key, ts_iso))
        else:
            print(f"  ✗ {name}: no outbound found in chat.db")
            not_delivered.append(contact_key)

    conn.close()

    print()
    print(f"Summary:")
    print(f"  Delivered (will mark initial_sent):  {len(delivered)}")
    print(f"  Not delivered (will reset to queued): {len(not_delivered)}")
    print()

    if args.dry_run:
        print("--dry-run set. No changes written.")
        return

    # Mark delivered as initial_sent. We use bulk-load to set:
    #   stage = (intentionally NOT set — bulk-load doesn't allow 'initial_sent')
    # Instead we use mark-sent endpoint per contact since that does the right
    # thing: stage=initial_sent + initial_sent_at=now.
    print(f"▸ Marking {len(delivered)} contacts as initial_sent...")
    for ck, ts in delivered:
        try:
            api_post(args.api, "/api/marketing/past-client/mark-sent", args.token,
                     {"contact_key": ck, "sent_body": "[reconciled from chat.db]"})
        except Exception as e:
            print(f"  ✗ {ck}: mark-sent failed: {e}", file=sys.stderr)
    print(f"  Done.")
    print()

    print(f"▸ Resetting {len(not_delivered)} contacts to queued...")
    if not_delivered:
        try:
            rows_payload = [
                {"contact_key": ck, "stage": "queued", "initial_sent_at": None,
                 "flag_notes": ""}
                for ck in not_delivered
            ]
            api_post(args.api, "/api/marketing/past-client/bulk-load", args.token,
                     {"rows": rows_payload})
            print(f"  Done.")
        except Exception as e:
            print(f"  ✗ bulk-reset failed: {e}", file=sys.stderr)
    print()
    print("Reconciliation complete.")


if __name__ == "__main__":
    main()

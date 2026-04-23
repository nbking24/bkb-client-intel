#!/usr/bin/env python3
"""
chat-db-scanner.py

Reads ~/Library/Messages/chat.db on Nathan's Mac and detects inbound
replies from past-client contacts who are currently in an active stage
(initial_sent / reminder_sent / email_sent / replied). POSTs matches to
the Client Hub /record-reply endpoint which auto-routes to opted_out
when STOP/unsubscribe language is detected.

Permissions:
    Terminal / Python / Cowork must have Full Disk Access granted in
    System Settings → Privacy & Security → Full Disk Access. Without
    that, chat.db reads return sqlite "authorization denied".

Run on a schedule (every 30 minutes is a good cadence) during the
campaign. Uses a local state file to track the last-scanned message
rowid so it only processes new inbound messages.

Usage:
    python3 chat-db-scanner.py \\
        --api https://bkb-client-intel.vercel.app \\
        --token "$TICKET_AGENT_TOKEN"

State file: ~/.bkb-chatdb-scanner-state.json

Exit codes:
    0 = success (even if zero new messages)
    1 = usage or permission error
    2 = API error
"""
import argparse
import json
import os
import re
import sqlite3
import sys
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

CHAT_DB = os.path.expanduser("~/Library/Messages/chat.db")
STATE_FILE = os.path.expanduser("~/.bkb-chatdb-scanner-state.json")
DEFAULT_API = "https://bkb-client-intel.vercel.app"

# macOS Messages stores message.date as nanoseconds since 2001-01-01 UTC.
# Epoch for 2001-01-01 UTC in Unix seconds: 978307200
APPLE_EPOCH_OFFSET = 978307200


def apple_ns_to_iso(date_ns):
    """Convert Messages' nanoseconds-since-2001 timestamp to ISO-8601."""
    if not date_ns:
        return None
    # Some older schemas store seconds, not nanoseconds. Detect by magnitude.
    if date_ns > 10**15:
        seconds = date_ns / 1e9
    else:
        seconds = float(date_ns)
    unix_ts = seconds + APPLE_EPOCH_OFFSET
    return datetime.utcfromtimestamp(unix_ts).isoformat() + "Z"


def normalize_phone(raw):
    """Extract 10-digit US phone from handle.id (E.164 or other)."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 11 and digits.startswith("1"):
        return digits[1:]
    if len(digits) == 10:
        return digits
    return None


def load_state():
    try:
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"last_rowid": 0, "last_scan_at": None}


def save_state(state):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE_FILE)


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
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {err}") from e


def get_active_contacts(api_base, token):
    """Fetch past-client rows in stages where we care about inbound replies."""
    active = {}
    for stage in ["initial_sent", "reminder_sent", "email_sent", "replied"]:
        res = api_get(api_base, f"/api/marketing/past-client/list?stage={stage}", token)
        for row in res.get("rows", []):
            pd = row.get("phone_digits")
            if pd:
                active[pd] = row
    return active


def fetch_new_inbound(db_path, after_rowid):
    """
    Pull all inbound messages (is_from_me = 0) with rowid > after_rowid.
    Joins handle to get the phone/email of the sender.
    """
    if not os.path.exists(db_path):
        raise RuntimeError(f"chat.db not found at {db_path}")

    # Open read-only to avoid locking Messages out
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                m.ROWID      as rowid,
                m.text       as text,
                m.date       as date,
                m.service    as service,
                h.id         as handle_id
            FROM message m
            LEFT JOIN handle h ON m.handle_id = h.ROWID
            WHERE m.is_from_me = 0
              AND m.ROWID > ?
              AND m.text IS NOT NULL
              AND m.text <> ''
            ORDER BY m.ROWID ASC
            """,
            (after_rowid,),
        )
        return [dict(r) for r in cur.fetchall()]
    except sqlite3.OperationalError as e:
        if "authorization" in str(e).lower() or "not authorized" in str(e).lower():
            raise RuntimeError(
                "Cannot read chat.db: Terminal/Python needs Full Disk Access. "
                "Grant it in System Settings → Privacy & Security → Full Disk Access."
            ) from e
        raise
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default=os.environ.get("PCO_API_BASE", DEFAULT_API))
    ap.add_argument("--token", default=os.environ.get("TICKET_AGENT_TOKEN"))
    ap.add_argument("--db", default=CHAT_DB)
    ap.add_argument("--dry-run", action="store_true",
                    help="Show matches without posting to the API")
    ap.add_argument("--reset", action="store_true",
                    help="Reset the last_rowid so all historical messages get scanned")
    args = ap.parse_args()

    if not args.token and not args.dry_run:
        print("Error: --token (or TICKET_AGENT_TOKEN env) required.", file=sys.stderr)
        sys.exit(1)

    state = {"last_rowid": 0, "last_scan_at": None} if args.reset else load_state()
    print(f"Resuming from rowid {state['last_rowid']} (last scan: {state.get('last_scan_at')})")

    try:
        active = get_active_contacts(args.api, args.token) if args.token else {}
        print(f"Active past-client contacts to watch: {len(active)}")
    except Exception as e:
        print(f"API error loading active contacts: {e}", file=sys.stderr)
        sys.exit(2)

    try:
        messages = fetch_new_inbound(args.db, state["last_rowid"])
    except Exception as e:
        print(f"chat.db error: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(messages)} new inbound messages since last scan.")

    matched = 0
    opted_out = 0
    new_max_rowid = state["last_rowid"]

    for m in messages:
        new_max_rowid = max(new_max_rowid, m["rowid"])
        phone = normalize_phone(m["handle_id"])
        if not phone:
            continue
        contact = active.get(phone)
        if not contact:
            continue

        text = m["text"]
        received_at = apple_ns_to_iso(m["date"])
        name = contact.get("full_name") or contact.get("first_name") or "Unknown"
        print(f"  ▸ Match: {name} ({phone}) — {text[:80]}{'…' if len(text) > 80 else ''}")

        if args.dry_run:
            matched += 1
            continue

        try:
            result = api_post(
                args.api, "/api/marketing/past-client/record-reply", args.token,
                {
                    "contact_key": contact["contact_key"],
                    "reply_text": text,
                    "reply_at": received_at,
                },
            )
            matched += 1
            if result.get("opted_out"):
                opted_out += 1
                print(f"    → OPT-OUT detected. Removed from campaign.")
        except Exception as e:
            print(f"    ! Failed to record reply: {e}", file=sys.stderr)

    if not args.dry_run:
        state["last_rowid"] = new_max_rowid
        state["last_scan_at"] = datetime.now().isoformat()
        save_state(state)

    print(f"\nDone. {matched} replies recorded, {opted_out} opt-outs.")


if __name__ == "__main__":
    main()

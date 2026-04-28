#!/usr/bin/env python3
"""
list-todays-sends.py — read-only diagnostic.

Lists every campaign contact and whether chat.db shows an outbound message
to their phone in the lookback window. Does NOT modify the DB or seen-log.
Use this to compare what the campaign sender did vs what actually delivered.
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

APPLE_EPOCH_OFFSET = 978307200


def api_get(api_base, path, token):
    url = f"{api_base.rstrip('/')}{path}"
    req = urllib.request.Request(url, headers={"x-agent-token": token})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def digits_only(s):
    return "".join(c for c in str(s or "") if c.isdigit())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api")
    ap.add_argument("--token")
    ap.add_argument("--lookback-hours", type=float, default=2.0)
    args = ap.parse_args()

    args.api = _config.get_api_base(cli_value=args.api)
    args.token = _config.get_token(cli_value=args.token)

    chat_db = os.path.expanduser("~/Library/Messages/chat.db")
    try:
        conn = sqlite3.connect(f"file:{chat_db}?mode=ro", uri=True)
        cur = conn.cursor()
    except Exception as e:
        print(f"✗ chat.db open failed: {e}", file=sys.stderr)
        sys.exit(2)

    cutoff_apple_ns = int((time.time() - args.lookback_hours * 3600 - APPLE_EPOCH_OFFSET) * 1e9)
    cur.execute(
        """
        SELECT h.id, m.date
        FROM message m
        JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.is_from_me = 1
          AND m.date > ?
          AND h.id IS NOT NULL
        ORDER BY m.date DESC
        LIMIT 1000
        """,
        (cutoff_apple_ns,),
    )
    chat_outbound = cur.fetchall()
    conn.close()

    # Build a {last10digits: most_recent_timestamp_iso} map
    delivered_map = {}
    for handle_id, date_ns in chat_outbound:
        last10 = digits_only(handle_id)[-10:]
        if len(last10) == 10:
            ts_unix = (date_ns / 1e9) + APPLE_EPOCH_OFFSET
            ts_iso = datetime.fromtimestamp(ts_unix).strftime("%H:%M:%S")
            if last10 not in delivered_map:
                delivered_map[last10] = ts_iso

    print(f"chat.db: {len(chat_outbound)} outbound messages in last "
          f"{args.lookback_hours}h, to {len(delivered_map)} unique numbers")
    print()

    # Pull ALL campaign contacts (both queued and failed) so we can label each
    print("Fetching campaign contacts from API...")
    res_failed = api_get(args.api, "/api/marketing/past-client/list?stage=failed&limit=500", args.token)
    res_queued = api_get(args.api, "/api/marketing/past-client/list?stage=queued&limit=500", args.token)
    res_sent = api_get(args.api, "/api/marketing/past-client/list?stage=initial_sent&limit=500", args.token)
    all_rows = (res_failed.get("rows", []) + res_queued.get("rows", []) +
                res_sent.get("rows", []))
    print(f"  {len(all_rows)} total campaign contacts ({len(res_failed.get('rows',[]))} failed, "
          f"{len(res_queued.get('rows',[]))} queued, {len(res_sent.get('rows',[]))} sent)")
    print()

    delivered = []
    not_delivered = []

    for row in all_rows:
        ck = row.get("contact_key")
        name = row.get("full_name") or f"{row.get('first_name','')} {row.get('last_name','')}".strip() or "Unknown"
        stage = row.get("stage")
        last10 = digits_only(row.get("phone_digits") or row.get("phone"))[-10:]
        if last10 in delivered_map:
            delivered.append((delivered_map[last10], name, stage, ck))
        else:
            not_delivered.append((name, stage, ck))

    # Sort by timestamp
    delivered.sort()

    print("=" * 60)
    print(f"DELIVERED — chat.db shows outbound in last {args.lookback_hours}h:")
    print("=" * 60)
    for ts, name, stage, ck in delivered:
        marker = "✓" if stage == "initial_sent" else "⚠"
        print(f"  {marker} [{ts}] {name:<35} stage={stage:<14} ({ck})")
    print(f"  Total: {len(delivered)}")
    print()

    print("=" * 60)
    print("NOT DELIVERED — no outbound in chat.db for this number:")
    print("=" * 60)
    by_stage = {}
    for name, stage, ck in not_delivered:
        by_stage.setdefault(stage, []).append((name, ck))
    for stage, items in sorted(by_stage.items()):
        print(f"  {stage} ({len(items)}):")
        for name, ck in sorted(items):
            print(f"    {name} ({ck})")
    print()
    print(f"  Total not delivered: {len(not_delivered)}")
    print()

    print("=" * 60)
    print("SUMMARY:")
    print(f"  ✓ Delivered:        {len(delivered)}")
    print(f"  ✗ Not delivered:    {len(not_delivered)}")
    print(f"  Total contacts:    {len(all_rows)}")
    print("=" * 60)


if __name__ == "__main__":
    main()

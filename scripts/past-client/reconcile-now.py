#!/usr/bin/env python3
"""
Reconcile DB stage and seen-log against actual chat.db delivery.

For every campaign contact, check chat.db for an outbound message in the
last `lookback_hours`. If found:
  - Mark stage='initial_sent' via bulk-load
  - Add contact_key to ~/.bkb-pco-sent.log
If not found:
  - Leave alone (queued stays queued; failed stays failed if it's a
    genuine non-delivery from before the lookback window)

This is the post-2026-04-28 cleanup tool. The misfire marked 33 contacts
as failed/queued when they actually got messages — this fixes that.
"""
import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _config

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
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def digits_only(s):
    return "".join(c for c in str(s or "") if c.isdigit())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api")
    ap.add_argument("--token")
    ap.add_argument("--lookback-hours", type=float, default=4.0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # Use the shared config loader — reads ~/.bkb-pco.env if env vars
    # aren't set. This is what the other PCO scripts do.
    args.api = _config.get_api_base(cli_value=args.api)
    args.token = _config.get_token(cli_value=args.token)

    chat_db = os.path.expanduser("~/Library/Messages/chat.db")
    conn = sqlite3.connect(f"file:{chat_db}?mode=ro", uri=True)
    cur = conn.cursor()
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
        LIMIT 2000
        """,
        (cutoff_apple_ns,),
    )
    delivered_handles = set()
    for handle_id, _date in cur.fetchall():
        last10 = digits_only(handle_id)[-10:]
        if len(last10) == 10:
            delivered_handles.add(last10)
    conn.close()
    print(f"chat.db: {len(delivered_handles)} unique numbers received outbound "
          f"in last {args.lookback_hours}h")

    # Pull all campaign contacts
    res_failed = api_get(args.api, "/api/marketing/past-client/list?stage=failed&limit=500", args.token)
    res_queued = api_get(args.api, "/api/marketing/past-client/list?stage=queued&limit=500", args.token)
    all_rows = res_failed.get("rows", []) + res_queued.get("rows", [])

    to_mark_sent = []
    for row in all_rows:
        ck = row.get("contact_key")
        last10 = digits_only(row.get("phone_digits") or row.get("phone"))[-10:]
        if last10 in delivered_handles:
            to_mark_sent.append((ck, row.get("full_name") or ck, row.get("stage")))

    print()
    print(f"Will mark {len(to_mark_sent)} contacts as initial_sent:")
    for ck, name, current_stage in to_mark_sent:
        print(f"  {name} ({ck}) — was {current_stage}")
    print()

    if args.dry_run:
        print("--dry-run set. No changes written.")
        return

    # Batch bulk-load with stage=initial_sent
    rows_payload = [
        {"contact_key": ck, "stage": "initial_sent", "flag_notes": ""}
        for ck, _, _ in to_mark_sent
    ]
    if rows_payload:
        result = api_post(args.api, "/api/marketing/past-client/bulk-load", args.token,
                          {"rows": rows_payload})
        print(f"bulk-load result: updated={result.get('updated')} "
              f"errors={len(result.get('errors',[]))}")

    # Add to seen-log
    seen_log = os.path.expanduser("~/.bkb-pco-sent.log")
    existing = set()
    if os.path.exists(seen_log):
        with open(seen_log) as f:
            existing = set(line.strip() for line in f if line.strip())
    new_keys = set(ck for ck, _, _ in to_mark_sent)
    combined = sorted(existing | new_keys)
    with open(seen_log, "w") as f:
        for k in combined:
            f.write(k + "\n")
    print(f"seen-log: now contains {len(combined)} keys")
    print()
    print("Done.")


if __name__ == "__main__":
    main()

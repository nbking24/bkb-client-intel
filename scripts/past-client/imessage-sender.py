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
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import _config  # noqa: E402


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


def send_imessage(phone_digits, body):
    """
    Send via the signed BKB-Send-iMessage.app bundle. The .app is what macOS
    grants Apple Events permission to (granted once during Setup-Sender-App
    via the standard system prompt). After that, ANY process — Terminal,
    launchd, cron — can invoke the .app and the send works.

    See ~/Applications/BKB-Send-iMessage.app, built from
    ~/BKB/launchd/BKB-Send-iMessage.applescript.

    Falls back to direct osascript if the .app isn't installed yet, with a
    clear error message pointing to the setup file.
    """
    to = f"+1{phone_digits}"

    # Resolve the .app's applet binary
    home = os.path.expanduser("~")
    app_applet = os.path.join(
        home, "Applications", "BKB-Send-iMessage.app", "Contents", "MacOS", "applet"
    )

    if not os.path.exists(app_applet):
        raise RuntimeError(
            f"Sender .app not found at {app_applet}. "
            f"Run BKB/Setup-Sender-App.command (in your BKB folder) once to build and grant it."
        )

    # Invoke the app's applet binary directly with positional args.
    # AppleScript's "on run argv" handler receives them.
    result = subprocess.run(
        [app_applet, "send", to, body],
        capture_output=True,
        text=True,
        timeout=30,
    )
    out = (result.stdout or "").strip()
    err = (result.stderr or "").strip()

    if "BKB_SEND_ERROR" in out or "BKB_SEND_ERROR" in err:
        raise RuntimeError(f"send error: {out or err}")
    if out.startswith("ERROR"):
        raise RuntimeError(out)
    if result.returncode != 0:
        raise RuntimeError(f"app applet exit {result.returncode}: {err or out}")
    return out or "iMessage"


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
        if contact_key in seen_keys_persistent:
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

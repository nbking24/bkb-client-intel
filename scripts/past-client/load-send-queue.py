#!/usr/bin/env python3
"""
load-send-queue.py

Reads BKB-Send-Queue-Review.xlsx and upserts each sendable row into the
past_client_outreach table via the Client Hub bulk-load API.

Idempotent — safe to re-run after Nathan edits the spreadsheet. Existing
rows get updated with the latest text/notes but their stage and
timestamps are never reset.

Usage:
    python3 load-send-queue.py \\
        --xlsx "/path/to/BKB-Send-Queue-Review.xlsx" \\
        --api https://bkb-client-intel.vercel.app \\
        --token "$TICKET_AGENT_TOKEN"

Defaults:
    --xlsx: env PCO_XLSX_PATH, else ~/mnt/BKB/Marketing Project/BKB-Send-Queue-Review.xlsx
    --api:  env PCO_API_BASE,  else https://bkb-client-intel.vercel.app
    --token: env TICKET_AGENT_TOKEN (required if not in args)

Exit codes:
    0 = success
    1 = usage error
    2 = API error
    3 = file read error
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

# Local config loader — adds CLI/env/~/.bkb-pco.env fallback
sys.path.insert(0, str(Path(__file__).parent))
import _config  # noqa: E402

try:
    from openpyxl import load_workbook
except ImportError:
    print("openpyxl not installed. Run: pip install openpyxl", file=sys.stderr)
    sys.exit(3)

DEFAULT_XLSX = os.path.expanduser(
    "~/mnt/BKB/Marketing Project/BKB-Send-Queue-Review.xlsx"
)

COLS = {
    "row": 1, "group": 2, "source": 3, "first_name": 4, "last_name": 5,
    "family": 6, "phone": 7, "email": 8, "city": 9, "raw_project": 10,
    "descriptor": 11, "sendable": 12, "issue": 13, "char_count": 14,
    "final_text": 15, "action": 16,
}


def normalize_phone(phone):
    if not phone:
        return None
    digits = "".join(c for c in str(phone) if c.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def format_phone_display(phone_digits):
    if not phone_digits or len(phone_digits) != 10:
        return None
    return f"({phone_digits[:3]}) {phone_digits[3:6]}-{phone_digits[6:]}"


def map_source(val):
    """Map spreadsheet Source column to DB source values."""
    if not val:
        return None
    v = str(val).lower()
    if "jt" in v or "jobtread" in v or "past project" in v:
        return "jt_past_project"
    if "loop" in v or "ghl" in v:
        return "loop_contact"
    return None


def build_rows(ws):
    rows = []
    skipped = []
    for r in range(2, ws.max_row + 1):
        def get(key):
            return ws.cell(r, COLS[key]).value

        first_name = get("first_name")
        last_name = get("last_name")
        family = get("family")
        phone = get("phone")
        email = get("email")
        sendable = get("sendable")
        final_text = get("final_text")
        issue = get("issue")
        action = get("action")

        # Determine inclusion stage
        explicit_skip = False
        if action and str(action).strip().upper() == "SKIP":
            explicit_skip = True
        if issue and str(issue).strip().upper().startswith("SKIP"):
            explicit_skip = True

        phone_digits = normalize_phone(phone)
        full_name = (family if family else f"{first_name or ''} {last_name or ''}".strip()) or None

        if not phone_digits and not explicit_skip:
            skipped.append({
                "row": r, "name": full_name, "reason": "no_phone"
            })
            continue

        row_data = {
            "contact_key": phone_digits or f"row{r}-nophone",
            "first_name": first_name,
            "last_name": last_name,
            "full_name": full_name,
            "phone": format_phone_display(phone_digits) if phone_digits else None,
            "phone_digits": phone_digits,
            "email": email,
            "source": map_source(get("source")),
            "project_names": get("raw_project"),
            "city": get("city"),
            "initial_text_body": final_text if sendable == "YES" and final_text else None,
            "flag_notes": issue or None,
        }

        if explicit_skip:
            row_data["stage"] = "skipped"

        rows.append(row_data)

    return rows, skipped


def post_bulk_load(api_base, token, rows):
    url = f"{api_base.rstrip('/')}/api/marketing/past-client/bulk-load"
    body = json.dumps({"rows": rows}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-agent-token": token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {err_body}") from e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx")
    ap.add_argument("--api")
    ap.add_argument("--token")
    ap.add_argument("--dry-run", action="store_true",
                    help="Parse the spreadsheet and print the payload without posting.")
    args = ap.parse_args()

    xlsx_path = _config.get_xlsx_path(cli_value=args.xlsx, default=DEFAULT_XLSX)
    api_base = _config.get_api_base(cli_value=args.api)
    token = args.token if args.dry_run else None
    if not args.dry_run:
        try:
            token = _config.get_token(cli_value=args.token)
        except RuntimeError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
    args.xlsx = xlsx_path
    args.api = api_base
    args.token = token

    path = Path(args.xlsx)
    if not path.exists():
        print(f"Error: xlsx not found at {path}", file=sys.stderr)
        sys.exit(3)

    wb = load_workbook(path)
    if "Send Queue" not in wb.sheetnames:
        print(f"Error: 'Send Queue' sheet not found. Sheets: {wb.sheetnames}",
              file=sys.stderr)
        sys.exit(3)

    rows, skipped = build_rows(wb["Send Queue"])
    print(f"Parsed {len(rows)} sendable rows, {len(skipped)} skipped for missing phone:")
    for s in skipped:
        print(f"  row {s['row']}: {s['name']} ({s['reason']})")

    if args.dry_run:
        print("\n--- DRY RUN — sample payload (first 2 rows) ---")
        print(json.dumps(rows[:2], indent=2))
        print(f"\n{len(rows)} rows would be posted to {args.api}")
        return

    # Post in chunks of 100 to stay comfortably under the 500 limit
    chunks = [rows[i:i + 100] for i in range(0, len(rows), 100)]
    totals = {"inserted": 0, "updated": 0, "skipped": 0, "errors": []}
    for i, chunk in enumerate(chunks, 1):
        print(f"Posting chunk {i}/{len(chunks)} ({len(chunk)} rows)…", end=" ")
        try:
            result = post_bulk_load(args.api, args.token, chunk)
        except Exception as e:
            print(f"\nAPI error on chunk {i}: {e}", file=sys.stderr)
            sys.exit(2)
        print(f"inserted={result.get('inserted', 0)} "
              f"updated={result.get('updated', 0)} "
              f"skipped={result.get('skipped', 0)} "
              f"errors={len(result.get('errors', []))}")
        totals["inserted"] += result.get("inserted", 0)
        totals["updated"] += result.get("updated", 0)
        totals["skipped"] += result.get("skipped", 0)
        totals["errors"].extend(result.get("errors", []))

    print(f"\n=== Done ===")
    print(f"Inserted: {totals['inserted']}")
    print(f"Updated:  {totals['updated']}")
    print(f"Skipped:  {totals['skipped']}")
    if totals["errors"]:
        print(f"Errors ({len(totals['errors'])}):")
        for e in totals["errors"][:10]:
            print(f"  {e}")


if __name__ == "__main__":
    main()

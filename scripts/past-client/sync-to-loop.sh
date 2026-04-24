#!/bin/bash
# Sync past-client-outreach contacts into Loop/GHL.
#
# Run this AFTER load-send-queue.py has populated past_client_outreach.
# It upserts any pco row without a ghl_contact_id into Loop, tags them
# for this campaign, and stores the Loop contact ID back on the pco row
# so everything stays linked.
#
# Safe to re-run; only hits rows missing ghl_contact_id by default.
#
# Usage:
#   ./sync-to-loop.sh                 # sync everything missing a Loop ID
#   ./sync-to-loop.sh --dry-run       # preview without calling Loop
#   ./sync-to-loop.sh --only-new      # sync only the 28 FRIEND/SUB rows (priority=10)

set -euo pipefail

# Resolve token from ~/.bkb-pco.env or env var (same resolution as the Python scripts)
if [ -z "${TICKET_AGENT_TOKEN:-}" ] && [ -f "$HOME/.bkb-pco.env" ]; then
  TICKET_AGENT_TOKEN=$(awk -F= '/^TICKET_AGENT_TOKEN=/{sub(/^["\x27]|["\x27]$/,"",$2); print $2}' "$HOME/.bkb-pco.env")
fi
if [ -z "${TICKET_AGENT_TOKEN:-}" ]; then
  echo "ERROR: TICKET_AGENT_TOKEN missing. Add it to ~/.bkb-pco.env or export it." >&2
  exit 1
fi

API="${PCO_API_BASE:-https://bkb-client-intel.vercel.app}"

# Build JSON body based on flags
BODY='{}'
for arg in "$@"; do
  case "$arg" in
    --dry-run)  BODY=$(echo "$BODY" | python3 -c 'import json,sys; d=json.load(sys.stdin); d["dry_run"]=True; print(json.dumps(d))') ;;
    --only-new) BODY=$(echo "$BODY" | python3 -c 'import json,sys; d=json.load(sys.stdin); d["only_priority"]=10; print(json.dumps(d))') ;;
    --all)      BODY=$(echo "$BODY" | python3 -c 'import json,sys; d=json.load(sys.stdin); d["only_missing_ghl"]=False; print(json.dumps(d))') ;;
    *)          echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

echo "POST $API/api/marketing/past-client/sync-to-loop"
echo "Body: $BODY"
echo
curl -sS -X POST \
  -H "x-agent-token: $TICKET_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "$API/api/marketing/past-client/sync-to-loop" | python3 -m json.tool

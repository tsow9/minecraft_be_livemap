#!/bin/bash
# Right after a new copy of Blockmap is made, waits for its Cloudflare token so that signing in to Realms starts about half a
# minute to a minute after the token is added (not at the next 10-minute check). GitHub has no event for "a secret was added", and a
# running job cannot see secrets added after it started, so every 30 seconds this starts a tiny run ("Setup", probe) that
# can: it starts signing in when the token is there (tools/auto_signin.sh). Stops once a sign-in has started or
# succeeded, or after 45 minutes (the 10-minute check carries on after that).
# Needs GH_TOKEN (actions: write). Never fails the run.
set -uo pipefail
for _ in $(seq 1 90); do
  state=$(gh run list --workflow map.yml --limit 20 --json displayTitle,status,conclusion 2>/dev/null | python3 -c '
import json, sys
runs = [r for r in json.load(sys.stdin) if r.get("displayTitle") == "Sign in to Realms"]
print("started" if any(r.get("status") != "completed" or r.get("conclusion") == "success" for r in runs) else "no")' 2>/dev/null)
  [ "$state" = started ] && { echo "Signing in has started."; exit 0; }
  gh workflow run setup.yml --ref "${GITHUB_REF_NAME:-main}" >/dev/null 2>&1 || true
  sleep 30
done
exit 0

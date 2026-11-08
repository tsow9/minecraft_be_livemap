#!/bin/bash
# Right after a new copy of Blockmap is made, waits for its Cloudflare token so that signing in to Realms starts within
# about half a minute of the token being added. GitHub has no event for "a secret was added", and a running job cannot
# see secrets added after it started, so a chain of tiny runs ("Setup", probe) looks: each one starts signing in when the
# token is there (tools/auto_signin.sh), then, until signing in has succeeded, starts the next one about 20 seconds later
# (5 minutes later once the repository is two hours old).
#   setup_wait.sh         (the first commit's run) starts the first probe
#   setup_wait.sh --next  (each probe) starts the next one
# The chain stops once a sign-in has succeeded (while one waits for its code it carries on, so a code that ran out is
# followed by a new one: tools/auto_signin.sh starts it 10 minutes after the last), or a week after the repository was made (the 10-minute check
# carries on after that). Needs GH_TOKEN (actions: write). Never fails the run.
set -uo pipefail
ref=${GITHUB_REF_NAME:-main}
if [ "${1:-}" = --next ]; then
  state=$(gh run list --workflow map.yml --limit 20 --json displayTitle,status,conclusion 2>/dev/null | python3 -c '
import json, sys
runs = [r for r in json.load(sys.stdin) if r.get("displayTitle") == "Sign in to Realms"]
print("started" if any(r.get("conclusion") == "success" for r in runs) else "no")' 2>/dev/null)
  [ "$state" = started ] && { echo "Signed in."; exit 0; }
  made=$(gh api "repos/$GITHUB_REPOSITORY" --jq .created_at 2>/dev/null) || made=''
  age=0
  [ -n "$made" ] && age=$(( $(date +%s) - $(date -d "$made" +%s 2>/dev/null || date +%s) ))
  [ "$age" -gt 604800 ] && { echo "A week has passed; the 10-minute check carries on."; exit 0; }
  # Every 20 seconds in the first two hours, then every 5 minutes (a setup left for later need not keep runs going).
  if [ "$age" -gt 7200 ]; then sleep 280; else sleep 20; fi
fi
gh workflow run setup.yml --ref "$ref" >/dev/null 2>&1 || true
exit 0

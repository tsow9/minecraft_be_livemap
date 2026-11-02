#!/bin/bash
# Starts "Sign in to Realms" by itself when a new site has its Cloudflare token but has never signed in, so setting up
# needs no Run workflow press: the code then shows on the setup page. Runs from the 10-minute live check.
#
# Not again while a sign-in is running or started within the last hour, and at most 24 times in all (a setup left
# half-done does not keep starting sign-ins). After that, only "Run workflow" starts one.
# Needs GH_TOKEN (actions: write) and CLOUDFLARE_API_TOKEN. Never fails the run.
set -uo pipefail
t() { case "${BLOCKMAP_LANG:-ja}" in en*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac; }
[ -f .auth/token.enc ] && exit 0                       # signed in already
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || exit 0          # not set up yet
runs=$(gh run list --workflow map.yml --limit 100 --json displayTitle,createdAt,status 2>/dev/null) || exit 0
verdict=$(printf '%s' "$runs" | python3 -c '
import json, sys, datetime
runs = [r for r in json.load(sys.stdin) if r.get("displayTitle") == "Sign in to Realms"]
now = datetime.datetime.now(datetime.timezone.utc)
def age(r):
    return (now - datetime.datetime.fromisoformat(r["createdAt"].replace("Z", "+00:00"))).total_seconds()
if len(runs) >= 24: print("enough")
elif any(r.get("status") != "completed" or age(r) < 3600 for r in runs): print("wait")
else: print("start")') || exit 0
case "$verdict" in
  start)
    gh workflow run map.yml --ref "${GITHUB_REF_NAME:-main}" -f action='Sign in to Realms' >/dev/null 2>&1 &&
      echo "$(t 'まだ Realms にログインしていないので、ログインを始めました(セットアップページにコードが出ます)' 'Not signed in to Realms yet, so signing in has started (the code shows on the setup page)')"
    ;;
  enough)
    echo "::notice::$(t 'Realms へのログインがまだです。Actions の「Map site」→ Run workflow で始めてください' 'Not signed in to Realms yet. Start it with Run workflow on "Map site" in Actions')"
    ;;
esac
exit 0

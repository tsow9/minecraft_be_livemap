#!/bin/bash
# Small Cloudflare helpers, so that setting up needs only the API token (CLOUDFLARE_ACCOUNT_ID may be left out).
#
#   cloudflare.sh account             the account ID: CLOUDFLARE_ACCOUNT_ID, else the token's (first) account
#   cloudflare.sh subdomain [NAME]    the account's workers.dev subdomain; with NAME, one is chosen when there is
#                                     none yet (NAME, else NAME-2, NAME-3 …)
#   cloudflare.sh export              puts CLOUDFLARE_ACCOUNT_ID into $GITHUB_ENV for the later steps (masked)
# Prints nothing when it cannot find out (no token, no network, no permission).
set -uo pipefail
API=${CF_API:-https://api.cloudflare.com/client/v4}  # CF_API: only for tests
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || exit 0
call() { curl -sS --max-time 20 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' "$@"; }
field() { python3 -c 'import json,sys
try:
    d = json.load(sys.stdin); r = d.get("result")
    v = eval(sys.argv[1], {"r": r})
    print(v or "")
except Exception:
    print("")' "$1"; }

account() {
  if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then echo "$CLOUDFLARE_ACCOUNT_ID"; return; fi
  call "$API/accounts?per_page=5" | field 'r[0]["id"] if r else ""'
}

case "${1:-}" in
  account) account ;;
  subdomain)
    id=$(account); [ -n "$id" ] || exit 0
    sub=$(call "$API/accounts/$id/workers/subdomain" | field 'r["subdomain"]')
    if [ -z "$sub" ] && [ -n "${2:-}" ]; then
      base=$(echo "$2" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g; s/^-*//; s/-*$//' | cut -c1-40)
      for name in "$base" "$base-2" "$base-3" "$base-$RANDOM"; do
        sub=$(call -X PUT "$API/accounts/$id/workers/subdomain" -d "{\"subdomain\":\"$name\"}" | field 'r["subdomain"]')
        [ -n "$sub" ] && break
      done
    fi
    echo "$sub"
    ;;
  export)
    id=$(account)
    if [ -n "$id" ] && [ -n "${GITHUB_ENV:-}" ]; then
      echo "::add-mask::$id"
      echo "CLOUDFLARE_ACCOUNT_ID=$id" >> "$GITHUB_ENV"
    fi
    echo "$id" | grep -q . || exit 1
    ;;
  *) echo "usage: cloudflare.sh account | subdomain [NAME] | export" >&2; exit 2 ;;
esac

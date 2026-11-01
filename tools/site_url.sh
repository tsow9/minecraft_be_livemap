#!/bin/bash
# Prints the address of the members-only site on Cloudflare (https://blockmap.<account's subdomain>.workers.dev),
# or nothing when it cannot be found out. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
set -uo pipefail
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || exit 0
name=$(sed -n 's/^name *= *"\(.*\)"/\1/p' "$(dirname "$0")/../worker/wrangler.template.toml" | head -n1)
sub=$(curl -sS --max-time 20 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" \
  | python3 -c 'import json,sys
try: print(json.load(sys.stdin)["result"]["subdomain"] or "")
except Exception: print("")')
[ -n "$sub" ] && [ -n "$name" ] && echo "https://$name.$sub.workers.dev"

#!/bin/bash
# Prints the address of the members-only site on Cloudflare (https://blockmap.<account's subdomain>.workers.dev),
# or nothing when it cannot be found out. Needs CLOUDFLARE_API_TOKEN (CLOUDFLARE_ACCOUNT_ID is optional).
set -uo pipefail
here=$(dirname "$0")
name=$(sed -n 's/^name *= *"\(.*\)"/\1/p' "$here/../worker/wrangler.template.toml" | head -n1)
sub=$(bash "$here/cloudflare.sh" subdomain)
[ -n "$sub" ] && [ -n "$name" ] && echo "https://$name.$sub.workers.dev"

#!/bin/bash
# Prints the address of the members-only site on Cloudflare (https://<site name>.<account's subdomain>.workers.dev; the name from tools/site_name.sh),
# or nothing when it cannot be found out. Needs CLOUDFLARE_API_TOKEN (CLOUDFLARE_ACCOUNT_ID is optional).
set -uo pipefail
here=$(dirname "$0")
name=$(bash "$here/site_name.sh")
sub=$(bash "$here/cloudflare.sh" subdomain)
[ -n "$sub" ] && [ -n "$name" ] && echo "https://$name.$sub.workers.dev"

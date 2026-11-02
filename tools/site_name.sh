#!/bin/bash
# The site's name on Cloudflare, made from the repository's name, so one Cloudflare account can hold a site for each
# Realm (one repository each): "blockmap" → https://blockmap.<subdomain>.workers.dev and the database "blockmap-share";
# "blockmap-survival" → https://blockmap-survival.<subdomain>.workers.dev and "blockmap-survival-share".
#
#   site_name.sh        the Worker's name
#   site_name.sh --db   its database's name
# Uses GITHUB_REPOSITORY (as in GitHub Actions); this project's own repository keeps "blockmap".
set -uo pipefail
repo=${GITHUB_REPOSITORY:-}
if [ "$repo" = tsow9/minecraft_be_livemap ] || [ -z "$repo" ]; then
  name=blockmap
else
  # Lower case letters, digits and "-" only (as a web address needs), at most 50 characters.
  name=$(printf '%s' "${repo#*/}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+//' | cut -c1-50 | sed -E 's/-+$//')
  [ -n "$name" ] || name=blockmap
fi
if [ "${1:-}" = --db ]; then echo "$name-share"; else echo "$name"; fi

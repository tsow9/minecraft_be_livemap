#!/bin/bash
# The key that encrypts the Realms sign-in and the map data (CACHE_KEY), handed to the job's later steps.
#
# REALMS_CACHE_KEY (a repository secret) is used when it is set. Otherwise the key lives in the site's own Cloudflare
# database (D1 "<site name>-share", table kv, row "realms_key"): made once, at random, on the first run, and read back
# after that. So a new site needs only one secret, CLOUDFLARE_API_TOKEN. The key never appears in a log (masked).
#
# With neither a secret nor a token there is no key yet: nothing is set, and the steps that need it say so.
# With --required (signing in to Realms, which cannot go on without a key) that stops the run with a clear message.
set -euo pipefail
t() { case "${BLOCKMAP_LANG:-ja}" in en*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac; }
here=$(dirname "$0")
API=${CF_API:-https://api.cloudflare.com/client/v4}  # CF_API: only for tests
DB=$(bash "$here/site_name.sh" --db)

hand_over() {
  echo "::add-mask::$1"
  if [ -n "${GITHUB_ENV:-}" ]; then echo "CACHE_KEY=$1" >> "$GITHUB_ENV"; else echo "$1"; fi
}

# The secret, when set, is the key; the Realm picked and the site's address below are still read from the site.
have_key=false
if [ -n "${REALMS_CACHE_KEY:-}" ]; then hand_over "$REALMS_CACHE_KEY"; have_key=true; fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  $have_key && exit 0
  if [ "${1:-}" = --required ]; then
    echo "::error::$(t 'CLOUDFLARE_API_TOKEN が登録されていません。リポジトリの Settings → Secrets and variables → Actions の「Secrets」に、この名前で Cloudflare のトークンを登録してください(セットアップの手順 3)' 'CLOUDFLARE_API_TOKEN is not set. Add your Cloudflare token under this name in the repository: Settings → Secrets and variables → Actions → Secrets (setup step 3)')"
    exit 1
  fi
  echo "$(t 'CLOUDFLARE_API_TOKEN がまだ登録されていません' 'CLOUDFLARE_API_TOKEN is not set yet')"
  exit 0
fi

fail() { $have_key && exit 0; echo "::error::$(t "鍵を Cloudflare から用意できませんでした($1)。CLOUDFLARE_API_TOKEN の権限(D1: Edit)を確かめてください" "Could not get the key from Cloudflare ($1). Check that CLOUDFLARE_API_TOKEN has D1: Edit")"; exit 1; }
call() { curl -sS --max-time 30 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' "$@"; }
json() { python3 -c "import json,sys
d = json.load(sys.stdin)
$1" 2>/dev/null; }

# With the secret, the rest is only a bonus: a failure from here on must not stop the run.
if $have_key; then set +e; fi
account=$(bash "$here/cloudflare.sh" account)
[ -n "$account" ] || fail account

# The site's database: found by name, or made (the site's own publishing finds the same one by name).
db=$(call "$API/accounts/$account/d1/database?name=$DB" | json 'print(next((x["uuid"] for x in d.get("result") or [] if x.get("name") == "'"$DB"'"), ""))')
if [ -z "$db" ]; then
  db=$(call -X POST "$API/accounts/$account/d1/database" -d "{\"name\":\"$DB\"}" | json 'print((d.get("result") or {}).get("uuid", ""))')
fi
[ -n "$db" ] || fail database

query() {  # SQL, then its parameters as a JSON array
  call -X POST "$API/accounts/$account/d1/database/$db/query" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"sql": sys.argv[1], "params": json.loads(sys.argv[2])}))' "$1" "${2:-[]}")"
}
query 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)' >/dev/null
if ! $have_key; then
  # Made only if there is none yet; then whatever is stored is read back (two runs at once agree on one key).
  fresh=$(python3 -c 'import secrets; print(secrets.token_urlsafe(36))')
  query "INSERT OR IGNORE INTO kv (k, v, at) VALUES ('realms_key', ?1, ?2)" "[\"$fresh\", $(date +%s)000]" >/dev/null
  key=$(query "SELECT v FROM kv WHERE k = 'realms_key'" | json 'print(d["result"][0]["results"][0]["v"])') || true
  [ -n "$key" ] || fail read
  hand_over "$key"
fi
# The Realm picked on the setup page when the owner has several (tools/realms/login.js), for the Realms steps
# (REALM_NAME, a repository variable, comes first).
pick=$(query "SELECT v FROM kv WHERE k = 'realm_pick'" | json 'print(d["result"][0]["results"][0]["v"])' || true)
if [ -n "$pick" ] && [ -n "${GITHUB_ENV:-}" ]; then
  printf 'REALM_PICK<<BLOCKMAP_EOF\n%s\nBLOCKMAP_EOF\n' "$(printf '%s' "$pick" | tr -d '\r\n')" >> "$GITHUB_ENV"
fi
# For runs started by hand, also the site's address, so they can tell the setup page how they are getting on
# (tools/setup_status.sh). Empty until the site is first published.
if [ -n "${GITHUB_ENV:-}" ] && [ "${GITHUB_EVENT_NAME:-}" = workflow_dispatch ]; then
  site=$(bash "$here/site_url.sh" || true)
  if [ -n "$site" ]; then echo "SITE_URL=$site" >> "$GITHUB_ENV"; fi
fi
exit 0

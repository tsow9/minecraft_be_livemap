#!/bin/bash
# Everything the three workflows do (.github/workflows/map.yml, live.yml, setup.yml). The workflow files only fetch
# the repository and run this, handing over all of the repository's secrets and variables. So a new version of
# Blockmap changes only this and the other files under tools/, never the workflow files: GitHub does not let an
# automatic update change workflow files, and a copy updates itself from the site's admin menu (tools/ci/update.sh).
#
#   run.sh map     the "Map site" workflow: the event and ACTION (What to do) say which part
#   run.sh live    the "Live players" workflow
#   run.sh setup   the "Setup" workflow (a new copy waiting for its Cloudflare token)
#
#   run.sh refresh after an update: the map and the site on the new version
#
# Needs (from the workflow): GH_TOKEN, the secrets by name, VARS_JSON, ACTION, and GitHub's own GITHUB_* variables.
set -uo pipefail

# An update replaces this very file while it runs: carry on from a copy.
if [ -z "${BLOCKMAP_CI_COPY:-}" ]; then
  copy=$(mktemp)
  cp "$0" "$copy"
  BLOCKMAP_CI_COPY=1 exec bash "$copy" "$@"
fi

eval "$(python3 tools/ci/env.py settings)"
export ACTION=${ACTION:-}
export BLOCKMAP_ACTION=$ACTION   # runs started by hand tell the setup page how they are getting on
export RUNNER_TEMP=${RUNNER_TEMP:-$(mktemp -d)}
UPSTREAM=$(cat tools/ci/upstream 2>/dev/null || echo tsow9/minecraft_be_livemap)
export UPSTREAM

t() { case "${BLOCKMAP_LANG:-ja}" in en*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac; }
say() { echo "$(t "$1" "$2")"; }
notice() { echo "::notice::$(t "$1" "$2")"; }
error() { echo "::error::$(t "$1" "$2")"; }
group() { echo "::group::$(t "$1" "$2")"; }
endgroup() { echo "::endgroup::"; }

# Runs a step that writes GitHub-style env or output files, and takes in what it wrote.
with_env() {
  local envf outf rc
  envf=$(mktemp); outf=$(mktemp)
  GITHUB_ENV=$envf GITHUB_OUTPUT=$outf "$@"; rc=$?
  eval "$(python3 tools/ci/env.py file "$envf")"
  eval "$(python3 tools/ci/env.py file "$outf")"
  rm -f "$envf" "$outf"
  return $rc
}

# Node and Python from the runner's own tool cache (no setup actions needed), else what the runner has.
use_tool() {  # use_tool node 22 | use_tool Python 3.12
  local dir
  dir=$(ls -d /opt/hostedtoolcache/"$1"/"$2"*/x64 2>/dev/null | sort -V | tail -n1)
  [ -n "$dir" ] && export PATH="$dir/bin:$PATH"
}
need_node() {
  use_tool node 22
  [ -d tools/realms/node_modules ] || npm ci --prefix tools/realms --no-audit --no-fund --loglevel=error
}
need_python() {
  use_tool Python 3.12
  python3 -c 'import numpy, PIL' 2>/dev/null && return 0
  python3 -m pip install --quiet numpy pillow 2>/dev/null || python3 -m pip install --quiet --break-system-packages numpy pillow
}

# The key that encrypts the sign-in and the map data (CACHE_KEY), the site's address (SITE_URL) and a Realm picked on
# the setup page (REALM_PICK).
get_key() {
  with_env bash tools/realms_key.sh "$@" || return 1
  # The language and time zone, unless set in the repository's variables: the admin's (or the setup page's) browser,
  # kept in the site's database by the site.
  if [ -z "$LANGUAGE" ] || [ -z "$TIMEZONE" ]; then
    local prefs
    prefs=$(python3 tools/ci/d1.py get prefs 2>/dev/null) || prefs=""
    if [ -n "$prefs" ]; then
      eval "$(PREFS="$prefs" python3 -c 'import json, os, re, shlex
p = json.loads(os.environ["PREFS"])
lang, tz = p.get("lang"), p.get("tz")
if os.environ.get("LANGUAGE") == "" and lang in ("ja", "en"): print("export BLOCKMAP_LANG=" + lang)
if os.environ.get("TIMEZONE") == "" and isinstance(tz, str) and re.fullmatch(r"[A-Za-z0-9_/+-]{1,40}", tz) and os.path.exists("/usr/share/zoneinfo/" + tz): print("export TZ=" + shlex.quote(tz))' 2>/dev/null)"
    fi
  fi
  return 0
}

# The Realms sign-in, encrypted, kept in the site's Cloudflare database.
auth_get() {
  mkdir -p .auth
  local v
  v=$(python3 tools/ci/d1.py get realms_auth 2>/dev/null) || v=""
  if [ -n "$v" ]; then printf '%s' "$v" | base64 -d > .auth/token.enc 2>/dev/null || rm -f .auth/token.enc; fi
  [ -s .auth/token.enc ] || rm -f .auth/token.enc
  auth_was=$(sha256sum .auth/token.enc 2>/dev/null | cut -c1-64)
}
auth_put() {
  [ -s .auth/token.enc ] || return 0
  [ "$(sha256sum .auth/token.enc | cut -c1-64)" = "${auth_was:-}" ] && return 0
  base64 -w0 .auth/token.enc | python3 tools/ci/d1.py put realms_auth ||
    echo "::warning::$(t 'ログイン情報を保存できませんでした' 'Could not save the sign-in')"
  auth_was=$(sha256sum .auth/token.enc | cut -c1-64)
}

# ---------- the site on Cloudflare ----------
site_exists() {
  local account code
  account=$(bash tools/cloudflare.sh account)
  code=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$account/workers/scripts/$(bash tools/site_name.sh)/settings" || true)
  [ "$code" = 200 ]
}

publish_site() {
  if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo "::warning::$(t 'Cloudflare の Secrets がそろっていないので、サイトは作りません' 'The Cloudflare secrets are not all set, so the site is not published')"
    return 0
  fi
  group 'サイトを公開' 'Publish the site'
  if ! with_env bash tools/cloudflare.sh export >/dev/null; then
    error 'Cloudflare のアカウントが見つかりませんでした。CLOUDFLARE_API_TOKEN を確かめてください' 'Could not find the Cloudflare account. Check CLOUDFLARE_API_TOKEN'
    endgroup; return 1
  fi
  local sub
  sub=$(bash tools/cloudflare.sh subdomain "$GITHUB_REPOSITORY_OWNER")
  [ -n "$sub" ] && echo "workers.dev: $sub"
  python3 tools/site_keys.py "$RUNNER_TEMP" || { endgroup; return 1; }
  [ -d data ] || bash tools/vault.sh get map-data data || { endgroup; return 1; }
  python3 tools/build_site.py data _site --data-folder "$(cat "$RUNNER_TEMP/data_dir")" --items-folder "$(cat "$RUNNER_TEMP/items_dir")" || { endgroup; return 1; }
  use_tool node 22
  npm ci --prefix worker --no-audit --no-fund --loglevel=error || { endgroup; return 1; }
  (
    cd worker || exit 1
    name=$(bash ../tools/site_name.sh); db=$(bash ../tools/site_name.sh --db)
    find_db() { npx wrangler d1 list --json | DB="$db" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);const d=l.find(x=>x.name===process.env.DB);process.stdout.write(d?d.uuid:"")})'; }
    id=$(find_db)
    if [ -z "$id" ]; then npx wrangler d1 create "$db" >/dev/null; id=$(find_db); fi
    [ -n "$id" ] || { echo "::error::Could not create the database"; exit 1; }
    sed -e "s/__DB_ID__/$id/; s/__DB_NAME__/$db/; s/__NAME__/$name/; s#__REPO__#$GITHUB_REPOSITORY#; s/__REPO_ID__/${GITHUB_REPOSITORY_ID:-}/" wrangler.template.toml > wrangler.toml
    npx wrangler d1 execute "$db" --remote --file schema.sql --yes >/dev/null || exit 1
    [ "$ACTION" = 'Update map' ] && bash ../tools/setup_status.sh publishing
    npx wrangler deploy --secrets-file "$RUNNER_TEMP/secrets.json" | tee deploy.log
    url=$(grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' deploy.log | head -n1)
    rm -f "$RUNNER_TEMP/secrets.json"
    if [ -z "$url" ]; then
      echo "::error::$(t '公開先のアドレスがわかりませんでした。Cloudflare の画面で「Workers & Pages」を一度開いて workers.dev のサブドメインを決めてから、もう一度実行してください' 'Could not find the site'"'"'s address. Open Workers & Pages in Cloudflare once, choose a workers.dev subdomain, then run this again')"
      exit 1
    fi
    echo "$(t 'サイト' 'Site'): $url" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    bash ../tools/info_branch.sh put site-info site.json "{\"url\":\"$url\"}"
    [ "$ACTION" = 'Update map' ] && SITE_URL="$url" bash ../tools/setup_status.sh "{\"state\":\"done\",\"url\":\"$url\"}"
    # How many sign-ins were made each day. Counts only, nobody's name or id.
    npx wrangler d1 execute "$db" --remote --json --command \
      "SELECT date(created / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM sessions GROUP BY day ORDER BY day DESC LIMIT 14" 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s)[0].results;console.log("Sign-ins per day:");for(const x of r)console.log(`  ${x.day}: ${x.n}`)}catch{}})' || true
    exit 0
  )
  local rc=$?
  endgroup
  [ $rc -eq 0 ] && published=1
  return $rc
}
published=0

# ---------- the map ----------
update_map() {
  auth_get
  if [ ! -f .auth/token.enc ] || [ -z "${CACHE_KEY:-}" ]; then
    notice 'まだ「Sign in to Realms」をしていないので、地図は作りません(Actions の「Map site」から実行してください)' 'Not signed in to Realms yet, so no map is made (run "Sign in to Realms" from "Map site" in Actions)'
    return 0
  fi
  bash tools/setup_status.sh downloading
  need_node
  group 'ワールドをダウンロード' 'Download the world'
  world_hash=""
  with_env node tools/realms/download.js world.mcworld members.json
  local rc=$?
  auth_put
  endgroup
  [ $rc -eq 0 ] || return 1
  bash tools/vault.sh get map-data data || return 1
  with_env python3 tools/worlds.py target data members.json || return 1
  echo "${world_hash}-$(cat tools/*.py | sha256sum | cut -c1-64)" > fingerprint.txt
  if [ "${switched:-false}" != true ] && [ -f "$dir/world.sha256" ] && [ "$(cat "$dir/world.sha256")" = "$(cat fingerprint.txt)" ]; then
    say '前回から変わっていません' 'No change since last time'
    bash tools/setup_status.sh done
    return 0
  fi
  bash tools/setup_status.sh drawing
  group '地図を作る' 'Make the map'
  need_python
  local live=""
  bash tools/vault.sh get live-data live
  [ -f live/live.json ] && live=live/live.json
  mkdir -p "$dir"
  python3 tools/render_map.py --world world.mcworld --site "$dir" --snapshot "$(date +%F)" --live "$live" || { endgroup; return 1; }
  cp fingerprint.txt "$dir/world.sha256"
  python3 tools/worlds.py record data members.json
  endgroup
  # map-data keeps a single commit so the repository does not grow with every hourly update.
  bash tools/vault.sh put data map-data || return 1
  publish_site
}

# GitHub turns off the timers of a public repository after 60 days without changes, and a copy of Blockmap may never
# change. Once a day, switching them on again keeps the map and the live check running.
keep_timers() {
  [ "$(date -u +%H)" = 03 ] || return 0
  for wf in map.yml live.yml; do gh api -X PUT "repos/$GITHUB_REPOSITORY/actions/workflows/$wf/enable" >/dev/null 2>&1 && echo "on: $wf"; done
  return 0
}

# ---------- signing in to Realms ----------
sign_in() {
  get_key --required || return 1
  # The site first (only when there is none yet; the map comes after), so the setup page can follow along through it.
  if [ -n "$CLOUDFLARE_API_TOKEN" ] && ! site_exists; then
    say '先にサイトを用意します(地図は、ログインの後に作ります)' 'Putting the site up first (the map is made after signing in)'
    publish_site || true
    get_key --required || return 1   # the site's address, now that there is a site
  fi
  bash tools/setup_status.sh starting
  need_node
  auth_get
  node tools/realms/login.js
  local rc=$?
  auth_put   # kept even when no Realm could be chosen yet (REALM_NAME can be set later without signing in again)
  if [ $rc -eq 0 ]; then
    gh workflow run map.yml --ref "$GITHUB_REF_NAME" -f action='Update map'
    # And the first live check now: it tells the site who the members are, so they can sign in to it.
    gh workflow run live.yml --ref "$GITHUB_REF_NAME" || true
    say '地図を作り始めました。数分でサイトができます' 'Started making the map. The site is ready in a few minutes'
  else
    bash tools/setup_status.sh login-failed
  fi
  bash tools/login_code.sh clear
  return $rc
}

diagnose() {
  need_node
  auth_get
  group 'Realm のメンバー' "The Realm's members"; node tools/realms/inspect.js; endgroup
  group 'ワールドをダウンロード' 'Download the world'
  node tools/realms/download.js world.mcworld members.json || { endgroup; return 1; }
  auth_put
  endgroup
  need_python
  CHECK=$CHECK_SPOT python3 tools/inspect_world.py world.mcworld
}

# ---------- the workflows ----------
case "${1:-}" in
  map)
    get_key || exit 1
    case "$GITHUB_EVENT_NAME:$ACTION" in
      push:*) publish_site ;;                                   # new site code
      schedule:*) keep_timers; update_map ;;
      'workflow_dispatch:Update map') update_map || { bash tools/setup_status.sh map-failed; exit 1; } ;;
      'workflow_dispatch:Publish site only') publish_site ;;
      'workflow_dispatch:Sign in to Realms') sign_in ;;
      'workflow_dispatch:Update Blockmap') bash tools/ci/update.sh apply ;;
      'workflow_dispatch:Diagnose') diagnose ;;
      *) say "することがありません($GITHUB_EVENT_NAME $ACTION)" "Nothing to do ($GITHUB_EVENT_NAME $ACTION)" ;;
    esac
    ;;
  live)
    get_key || exit 1
    auth_get
    bash tools/auto_signin.sh
    if [ -f .auth/token.enc ]; then
      need_node
      bash tools/live_loop.sh
      rc=$?
      auth_put
      bash tools/ci/update.sh check || true   # a new version, and whether the owner asked for it
      exit $rc
    fi
    ;;
  refresh)
    # Right after an update (tools/ci/update.sh): the map with the new drawing code, and the site on the new version.
    get_key || exit 1
    update_map || true
    [ $published -eq 1 ] || publish_site
    ;;
  setup)
    case "$GITHUB_EVENT_NAME" in
      push) [ "$GITHUB_REPOSITORY" = "$UPSTREAM" ] || bash tools/setup_wait.sh ;;
      workflow_dispatch)
        [ -n "$CLOUDFLARE_API_TOKEN" ] && { get_key; auth_get; bash tools/auto_signin.sh; }
        [ "$GITHUB_REPOSITORY" = "$UPSTREAM" ] || bash tools/setup_wait.sh --next ;;
    esac
    exit 0
    ;;
  *) echo "usage: run.sh map|live|setup" >&2; exit 2 ;;
esac

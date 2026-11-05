#!/bin/bash
# Updating a copy of Blockmap to the newest release, from the site's admin menu: the owner presses "Update", and that
# is all (no GitHub screens).
#
#   update.sh check   (the live check, every 10 minutes) tells the site the newest release, so the admin sees that
#                     one is out; if the owner asked for it, starts "Map site → Update Blockmap"
#   update.sh apply   (Map site → Update Blockmap) takes the newest release into this repository and puts the site
#                     and the map on it
#
# Everything but the workflow files is taken (GitHub does not let an automatic run change those, and Blockmap never
# needs them changed: they only run tools/ci/run.sh). Settings live in the repository's secrets and variables and the
# data in the site and the encrypted branches, so nothing of the owner's is touched.
# Needs GH_TOKEN, CACHE_KEY and the Cloudflare token (as tools/ci/run.sh has them). Does nothing in Blockmap's own
# repository.
set -uo pipefail
t() { case "${BLOCKMAP_LANG:-ja}" in en*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac; }
UPSTREAM=${UPSTREAM:-$(cat tools/ci/upstream)}
[ "${GITHUB_REPOSITORY:-}" = "$UPSTREAM" ] && exit 0

site=${SITE_URL:-$(bash tools/site_url.sh)}
pass=$(python3 tools/site_keys.py --live-pass 2>/dev/null)
[ -n "$pass" ] && echo "::add-mask::$pass"
current=$(tr -d ' \n' < VERSION 2>/dev/null)

tell() {  # tell PATH JSON → the site's answer
  [ -n "$site" ] && [ -n "$pass" ] || return 1
  curl -sS --max-time 20 -X POST "$site/api/$1" -H "X-Passphrase: $pass" -H 'Content-Type: application/json' --data "$2"
}

newest() {  # prints "<version> <release page>" of the newest release
  gh api "repos/$UPSTREAM/releases/latest" --jq '[(.tag_name | ltrimstr("v")), .html_url] | @tsv' 2>/dev/null | tr '\t' ' '
}

case "${1:-}" in
  check)
    read -r latest url < <(newest) || true
    [ -n "${latest:-}" ] || exit 0
    answer=$(tell release "{\"current\":\"$current\",\"latest\":\"$latest\",\"url\":\"$url\"}") || exit 0
    if printf '%s' "$answer" | grep -q '"start":true'; then
      echo "$(t "管理者が更新を選んだので、$latest に更新します" "The admin asked for an update, so updating to $latest")"
      gh workflow run map.yml --ref main -f action='Update Blockmap'
    fi
    ;;
  apply)
    read -r latest url < <(newest) || true
    if [ -z "${latest:-}" ]; then echo "::error::$(t '新しいバージョンを調べられませんでした' 'Could not look up the newest version')"; exit 1; fi
    if [ "$latest" = "$current" ]; then
      echo "$(t "もう最新です($current)" "Already the newest ($current)")"
      tell update/state '{"state":"done"}' >/dev/null
      exit 0
    fi
    tell update/state '{"state":"updating"}' >/dev/null
    echo "$(t "$current から $latest に更新します" "Updating from $current to $latest")"
    work=$(mktemp -d)
    fail() { echo "::error::$1"; tell update/state '{"state":"failed"}' >/dev/null; exit 1; }
    curl -fsSL "https://codeload.github.com/$UPSTREAM/tar.gz/refs/tags/v$latest" -o "$work/release.tgz" || fail "$(t 'ダウンロードできませんでした' 'Could not download it')"
    mkdir "$work/release" && tar -xzf "$work/release.tgz" -C "$work/release" --strip-components=1 || fail 'tar'
    [ "$(tr -d ' \n' < "$work/release/VERSION")" = "$latest" ] && [ -f "$work/release/tools/ci/run.sh" ] || fail "$(t '中身が正しくありません' 'It does not look right')"
    git clone -q "https://x-access-token:$GH_TOKEN@github.com/$GITHUB_REPOSITORY.git" "$work/repo" || fail 'clone'
    rsync -a --delete --exclude '.git/' --exclude '.github/' "$work/release/" "$work/repo/" || fail 'rsync'
    (
      cd "$work/repo" &&
      git add -A &&
      git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -q -m "Blockmap $latest" &&
      git push -q origin HEAD:main
    ) || fail "$(t '取り込めませんでした' 'Could not take it in')"
    echo "$(t "Blockmap $latest を取り込みました。サイトと地図を新しいバージョンにします" "Took in Blockmap $latest. Now putting the site and the map on it")"
    # The new version puts the site and the map on itself (its own tools/ci/run.sh).
    cd "$work/repo" && BLOCKMAP_CI_COPY= exec bash tools/ci/run.sh refresh
    ;;
  *) echo "usage: update.sh check|apply" >&2; exit 2 ;;
esac

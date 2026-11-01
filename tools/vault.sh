#!/bin/bash
# Keeps a folder on its own branch (map-data: the map; live-data: who is online), encrypted.
# The repository is public, so the branch holds only data.enc.000, data.enc.001, … (a tar.gz, AES-256 with a key
# stretched from REALMS_CACHE_KEY, cut in 40 MB parts so no file grows past GitHub's limit). Without the key it is noise.
#
# Usage: vault.sh get BRANCH DIR   (an older branch that is not encrypted yet is read as it is)
#        vault.sh put DIR BRANCH   (the branch keeps a single commit, so the repository never grows)
# Needs CACHE_KEY (REALMS_CACHE_KEY) and, for put, GH_TOKEN.
set -euo pipefail

need_key() {
  [ -n "${CACHE_KEY:-}" ] || { echo "::error::REALMS_CACHE_KEY が設定されていません"; exit 1; }
}
crypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:CACHE_KEY "$@"; }

case "${1:-}" in
  get)
    branch=$2 dir=$3
    mkdir -p "$dir"
    git fetch -q --depth 1 origin "$branch" 2>/dev/null || { echo "$branch はまだありません"; exit 0; }
    tmp=$(mktemp -d)
    git archive FETCH_HEAD | tar -x -C "$tmp"
    if compgen -G "$tmp/data.enc.*" >/dev/null; then
      need_key
      cat "$tmp"/data.enc.* | crypt -d | tar -xz -C "$dir"
    else
      cp -a "$tmp"/. "$dir"/
    fi
    rm -rf "$tmp"
    ;;
  put)
    dir=$2 branch=$3
    need_key
    tmp=$(mktemp -d)
    tar -cz -C "$dir" --exclude=.git . | crypt -salt | split -b 40m -d -a 3 - "$tmp/data.enc."
    (
      cd "$tmp"
      git init -q -b "$branch"
      git add -A
      git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
        commit -q -m "$branch $(date -u '+%F %H:%M:%S')(暗号化済み)"
      git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$branch"
    )
    rm -rf "$tmp"
    ;;
  *)
    echo "使い方: vault.sh get BRANCH DIR / vault.sh put DIR BRANCH" >&2
    exit 2
    ;;
esac

#!/bin/bash
# Keeps a folder on its own branch (map-data: the map; live-data: who is online), encrypted.
# The repository is public, so the branch holds only data.enc.000, data.enc.001, … (a tar.gz, AES-256 with a key
# stretched from REALMS_CACHE_KEY, cut in 40 MB parts so no file grows past GitHub's limit). Without the key it is noise.
#
# Usage: vault.sh get BRANCH DIR   (an older branch that is not encrypted yet is read as it is)
#        vault.sh put DIR BRANCH   (the branch keeps a single commit, so the repository never grows)
# Needs CACHE_KEY (REALMS_CACHE_KEY) and, for put, GH_TOKEN.
set -euo pipefail
# Messages in the owner's language (repository variable LANGUAGE → BLOCKMAP_LANG): English for "en", else Japanese.
t() { case "${BLOCKMAP_LANG:-ja}" in en*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac; }

need_key() {
  [ -n "${CACHE_KEY:-}" ] || { echo "::error::$(t 'REALMS_CACHE_KEY が設定されていません' 'REALMS_CACHE_KEY is not set')"; exit 1; }
}
crypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:CACHE_KEY "$@"; }

case "${1:-}" in
  get)
    branch=$2 dir=$3
    mkdir -p "$dir"
    git fetch -q --depth 1 origin "$branch" 2>/dev/null || { echo "$(t "$branch はまだありません" "No $branch branch yet")"; exit 0; }
    tmp=$(mktemp -d)
    git archive FETCH_HEAD | tar -x -C "$tmp"
    if compgen -G "$tmp/data.enc.*" >/dev/null; then
      need_key
      # Made with another key (copied with someone else's branches, or REALMS_CACHE_KEY was changed). Stop rather than
      # start afresh, so a hiccup can never wipe the map's history.
      if ! cat "$tmp"/data.enc.* | crypt -d 2>/dev/null | tar -xz -C "$dir" 2>/dev/null; then
        # Copied along when the repository was made ("Include all branches" in step 1): Chizuya's own repository's
        # data, from before this repository existed or its first minutes. It was never this copy's: drop it and start.
        made=$(gh api "repos/${GITHUB_REPOSITORY:-}" --jq .created_at 2>/dev/null) || made=''
        tip=$(git log -1 --format=%ct FETCH_HEAD 2>/dev/null) || tip=''
        if [ -n "$made" ] && [ -n "$tip" ] && [ "${GITHUB_REPOSITORY:-}" != "$(cat tools/ci/upstream 2>/dev/null)" ] &&
           [ "$tip" -le $(( $(date -d "$made" +%s) + 900 )) ]; then
          git push -q origin --delete "$branch" 2>/dev/null || true
          rm -rf "$tmp" "$dir" && mkdir -p "$dir"
          echo "$(t "$branch はリポジトリを作ったときに一緒に写ったもの(このリポジトリのものではない)なので、消して新しく作ります" "$branch was copied along when the repository was made (not this repository's own), so it is removed and made afresh")"
          exit 0
        fi
        echo "::error::$(t "$branch ブランチをこの鍵(REALMS_CACHE_KEY)で開けませんでした。鍵を変えた場合は元に戻すか、$branch ブランチを削除すると新しく作り直します" "The $branch branch cannot be opened with this key (REALMS_CACHE_KEY). If you changed the key, put it back, or delete the $branch branch to start it afresh")"
        exit 1
      fi
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
        commit -q -m "$branch $(date -u '+%F %H:%M:%S') (encrypted)"
      git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$branch"
    )
    rm -rf "$tmp"
    ;;
  *)
    echo "usage: vault.sh get BRANCH DIR / vault.sh put DIR BRANCH" >&2
    exit 2
    ;;
esac

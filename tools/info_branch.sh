#!/bin/bash
# Small public notes for the setup page, each on its own one-commit branch, read through GitHub's public API:
#   login-code/code.json  the sign-in code while signing in (then "signed-in"); deleted when signing in ends
#   site-info/site.json   the site's address, once it is published
#
#   info_branch.sh put BRANCH FILE JSON     (force-pushed)
#   info_branch.sh clear BRANCH
# Needs GH_TOKEN and GITHUB_REPOSITORY (as in GitHub Actions). Never fails the run.
set -uo pipefail
[ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] || exit 0
remote="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
case "${1:-}" in
  put)
    tmp=$(mktemp -d)
    (
      cd "$tmp" && printf '%s\n' "$4" > "$3" && git init -q -b "$2" && git add "$3" &&
      git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -q -m "$3" &&
      git push -q -f "$remote" "$2"
    ) >/dev/null 2>&1 || true
    rm -rf "$tmp"
    ;;
  clear)
    git push -q "$remote" --delete "$2" >/dev/null 2>&1 || true
    ;;
esac
exit 0

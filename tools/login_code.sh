#!/bin/bash
# While signing in to Realms, the code to enter (and then "signed in") is put on the branch "login-code" as code.json,
# so the setup page can show it without opening the log. The same code is in the run's public log anyway, and it is
# good only for 15 minutes. The branch is deleted when signing in ends.
#
#   login_code.sh put JSON     (one commit, force-pushed)
#   login_code.sh clear
# Needs GH_TOKEN and GITHUB_REPOSITORY (as in GitHub Actions). Never fails the run.
set -uo pipefail
remote="https://x-access-token:${GH_TOKEN:-}@github.com/${GITHUB_REPOSITORY:-}.git"
[ -n "${GH_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] || exit 0
case "${1:-}" in
  put)
    tmp=$(mktemp -d)
    (
      cd "$tmp" && printf '%s\n' "$2" > code.json && git init -q -b login-code && git add code.json &&
      git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' commit -q -m 'Sign-in code' &&
      git push -q -f "$remote" login-code
    ) >/dev/null 2>&1 || true
    rm -rf "$tmp"
    ;;
  clear)
    git push -q "$remote" --delete login-code >/dev/null 2>&1 || true
    ;;
esac
exit 0

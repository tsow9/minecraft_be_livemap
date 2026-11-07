#!/bin/bash
# Tells the setup page how setting up is getting on, through the site itself (POST /api/setup, with the same key the
# live check uses), so the page can follow it every few seconds without GitHub's limit on questions.
#
#   setup_status.sh STATE              e.g. downloading, drawing, publishing, map-failed
#   setup_status.sh '{"state":…}'      with more: the sign-in code, the site's address
#
# Only for runs started by hand ("Sign in to Realms", "Update map"), which is when someone may be watching.
# Needs CACHE_KEY and SITE_URL (both from tools/realms_key.sh). Never fails the run; prints only the masking line.
set -uo pipefail
case "${BLOCKMAP_ACTION:-}" in 'Sign in to Realms'|'Update map') ;; *) exit 0 ;; esac
[ -n "${CACHE_KEY:-}" ] && [ -n "${SITE_URL:-}" ] || exit 0
here=$(dirname "$0")
pass=$(python3 "$here/site_keys.py" --live-pass 2>/dev/null) || exit 0
[ -n "$pass" ] || exit 0
echo "::add-mask::$pass"
body=$(python3 - "$1" <<'PY'
import hashlib, json, os, sys
arg = sys.argv[1]
d = json.loads(arg) if arg.startswith('{') else {'state': arg}
repo = os.environ.get('GITHUB_REPOSITORY', '').lower()
# Which repository this is about, without naming it; with its id, so a new repository of an old one's name (whose site
# may still be up) is told apart.
rid = os.environ.get('GITHUB_REPOSITORY_ID', '')
d['r'] = hashlib.sha256(f'{repo}#{rid}'.encode() if rid else repo.encode()).hexdigest()[:16]
d['log'] = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ.get('GITHUB_REPOSITORY', '')}/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}"
print(json.dumps(d))
PY
) || exit 0
curl -sS --max-time 15 -o /dev/null -X POST "$SITE_URL/api/setup" -H "X-Passphrase: $pass" -H 'Content-Type: application/json' \
  --data "$body" >/dev/null 2>&1 || true
exit 0

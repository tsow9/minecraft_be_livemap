"""Shell `export` lines for tools/ci/run.sh.

  env.py settings     the repository's secrets (each by name) and variables (VARS_JSON: the workflow hands them all
                      over, so a variable added in a later version needs no change to the workflow files)
  env.py file PATH    what a step wrote to a GitHub-style env or output file (KEY=value, or KEY<<EOF … EOF)
"""
import json
import os
import shlex
import sys

# Repository secrets and variables Chizuya reads, as the names its tools use.
SECRETS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'REALMS_CACHE_KEY', 'SHARE_PASSPHRASE']
VARIABLES = ['REALM_NAME', 'MC_VERSION', 'CHECK_SPOT', 'LANGUAGE', 'TIMEZONE']


def export(name, value):
    print(f'export {name}={shlex.quote(str(value))}')


def settings():
    try:
        secrets = json.loads(os.environ.get('SECRETS_JSON') or '{}') or {}
    except ValueError:
        secrets = {}
    try:
        variables = json.loads(os.environ.get('VARS_JSON') or '{}') or {}
    except ValueError:
        variables = {}
    for k in SECRETS:  # named one by one in the workflow files (GitHub holds runs that take all secrets at once)
        export(k, secrets.get(k) or os.environ.get(k) or '')
    for k in VARIABLES:
        export(k, variables.get(k) or '')
    export('BLOCKMAP_LANG', variables.get('LANGUAGE') or 'ja')
    export('TZ', variables.get('TIMEZONE') or 'Asia/Tokyo')


def env_file(path):
    try:
        lines = open(path, encoding='utf-8').read().split('\n')
    except OSError:
        return
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if '<<' in line and ('=' not in line or line.index('<<') < line.index('=')):
            name, end = line.split('<<', 1)
            value = []
            while i < len(lines) and lines[i] != end:
                value.append(lines[i])
                i += 1
            i += 1
            export(name.strip(), '\n'.join(value))
        elif '=' in line:
            name, value = line.split('=', 1)
            if name.strip().isidentifier():
                export(name.strip(), value)


if __name__ == '__main__':
    if sys.argv[1:2] == ['settings']:
        settings()
    elif sys.argv[1:2] == ['file']:
        env_file(sys.argv[2])

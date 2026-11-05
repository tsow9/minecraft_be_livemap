"""Small values kept in the site's own Cloudflare database (D1 "<site name>-share", table kv), for the runs.

  d1.py get KEY              prints the value (nothing if there is none)
  d1.py put KEY < value      stores what comes in
  d1.py del KEY

Used for the Realms sign-in (encrypted with the key; GitHub's Actions cache is not used, so the workflow files need no
outside actions). Needs CLOUDFLARE_API_TOKEN (CLOUDFLARE_ACCOUNT_ID is optional). Prints nothing and fails quietly
without them.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

API = os.environ.get('CF_API') or 'https://api.cloudflare.com/client/v4'
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ('POST' if body is not None else 'GET'))
    req.add_header('Authorization', 'Bearer ' + os.environ['CLOUDFLARE_API_TOKEN'])
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def database():
    account = os.environ.get('CLOUDFLARE_ACCOUNT_ID') or subprocess.run(
        ['bash', os.path.join(TOOLS, 'cloudflare.sh'), 'account'], capture_output=True, text=True).stdout.strip()
    name = subprocess.run(['bash', os.path.join(TOOLS, 'site_name.sh'), '--db'], capture_output=True, text=True).stdout.strip()
    if not account or not name:
        raise SystemExit(1)
    found = [d for d in call(f'/accounts/{account}/d1/database?name={name}').get('result') or [] if d.get('name') == name]
    if not found:
        raise SystemExit(1)
    return f'/accounts/{account}/d1/database/{found[0]["uuid"]}/query'


def query(db, sql, params=()):
    return call(db, {'sql': sql, 'params': list(params)})['result'][0]['results']


def main():
    if not os.environ.get('CLOUDFLARE_API_TOKEN'):
        raise SystemExit(1)
    what, key = sys.argv[1], sys.argv[2]
    db = database()
    query(db, 'CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)')
    if what == 'get':
        rows = query(db, 'SELECT v FROM kv WHERE k = ?', [key])
        if rows:
            sys.stdout.write(rows[0]['v'])
    elif what == 'put':
        query(db, 'INSERT INTO kv (k, v, at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, at = ?3',
              [key, sys.stdin.read(), int(time.time() * 1000)])
    elif what == 'del':
        query(db, 'DELETE FROM kv WHERE k = ?', [key])


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        raise SystemExit(1)

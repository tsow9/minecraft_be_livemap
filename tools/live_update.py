"""Update live.json (who is online, where players are) for the frequent check.

Usage:
  python live_update.py need-world STATE MEMBERS        -> prints "true"/"false"
  python live_update.py update STATE MEMBERS [WORLD]    -> rewrites STATE
"""
import glob
import json
import os
import shutil
import sys
import tempfile
import time
import zipfile

import players


def load(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def main():
    cmd, state_path, members_path = sys.argv[1:4]
    state = load(state_path, {})
    members = load(members_path, {}).get('members', [])
    if cmd == 'need-world':
        print('true' if players.anyone_online(state, members) or not state.get('players') else 'false')
        return
    secret = os.environ.get('CACHE_KEY') or ''
    if len(secret) < 20:
        sys.exit('合言葉(CACHE_KEY)が必要です。')
    records = None
    if len(sys.argv) > 4:
        tmp = tempfile.mkdtemp()
        try:
            with zipfile.ZipFile(sys.argv[4]) as z:
                z.extractall(tmp, [n for n in z.namelist() if '/db/' in '/' + n])
            db = next(p for p in glob.glob(os.path.join(tmp, '**', 'db'), recursive=True) if os.path.isdir(p))
            records = players.read_records(db, secret)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    now = int(time.time() * 1000)
    state = players.update_live(state, members, records, now)
    with open(state_path, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, separators=(',', ':'))
    online = sum(1 for m in members if m.get('online'))
    named = sum(1 for p in state['players'] if p.get('member'))
    pos = f'、位置を更新(プレイヤー {len(state["players"])}人・名前が分かった人 {named}人)' if records is not None else ''
    print(f'参加中 {online}人{pos}')


if __name__ == '__main__':
    main()

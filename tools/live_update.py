"""Update live.json (who is online, where players are) for the frequent check.

Usage:
  python live_update.py need-world STATE MEMBERS        -> prints "true"/"false"
  python live_update.py update STATE MEMBERS [WORLD]    -> rewrites STATE
"""
import glob
import json
import os
import shutil
import struct
import sys
import tempfile
import time
import zipfile

import nbt
import players

MAP_EVERY_MS = 55 * 60 * 1000
MAP_WHILE_PLAYING_MS = 60 * 1000


def load(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def read_clock(path):
    """Time of day and weather from level.dat (8-byte header, then little-endian NBT)."""
    try:
        with open(path, 'rb') as f:
            root, _ = nbt.root_compound(f.read(), 8)
    except (OSError, ValueError, IndexError, KeyError, struct.error):
        return None
    if not isinstance(root.get('Time'), int):
        return None
    rain = float(root.get('rainLevel') or 0) > 0
    saved = root.get('LastPlayed')
    return {
        'saved': int(saved) * 1000 if isinstance(saved, int) and saved > 0 else None,
        'time': root['Time'] % 24000,
        'rain': rain,
        'thunder': rain and float(root.get('lightningLevel') or 0) > 0,
        'cycle': bool(root.get('dodaylightcycle', 1)),
    }


def main():
    cmd, state_path, members_path = sys.argv[1:4]
    state = load(state_path, {})
    fetched = load(members_path, {})
    members = fetched.get('members', [])
    if cmd == 'need-world':
        # Also read the world once when the time of day has never been taken, so the clock shows up right away.
        need = players.anyone_online(state, members) or not state.get('players') or 'world' not in state
        print('true' if need else 'false')
        return
    secret = os.environ.get('CACHE_KEY') or ''
    if len(secret) < 20:
        sys.exit('合言葉(CACHE_KEY)が必要です。')
    records = None
    if len(sys.argv) > 4:
        tmp = tempfile.mkdtemp()
        try:
            with zipfile.ZipFile(sys.argv[4]) as z:
                z.extractall(tmp, [n for n in z.namelist() if '/db/' in '/' + n or n.endswith('level.dat')])
            db = next(p for p in glob.glob(os.path.join(tmp, '**', 'db'), recursive=True) if os.path.isdir(p))
            records = players.read_records(db, secret)
            clock = read_clock(os.path.join(os.path.dirname(db), 'level.dat'))
            if clock:
                state['world'] = {**clock, 'at': int(time.time() * 1000)}
                # A log of when Realms actually saved the world (level.dat LastPlayed), to learn its save interval.
                saves = [t for t in state.get('saves', []) if isinstance(t, int)]
                if clock['saved'] and clock['saved'] not in saves:
                    saves.append(clock['saved'])
                state['saves'] = saves[-300:]
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    now = int(time.time() * 1000)
    realm = fetched.get('realm')
    if isinstance(realm, dict):
        # Backups are looked up only now and then; keep the last answer in between.
        if 'backups' not in realm and isinstance(state.get('realm'), dict) and 'backups' in state['realm']:
            realm['backups'] = state['realm']['backups']
        state['realm'] = {**realm, 'at': now}
    state = players.update_live(state, members, records, now)
    # The frequent check also starts the map update: every check while someone plays, hourly otherwise.
    gap = MAP_WHILE_PLAYING_MS if records is not None else MAP_EVERY_MS
    if now - (state.get('mapRequestedAt') or 0) >= gap:
        state['mapRequestedAt'] = now
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
                f.write('run_map=true\n')
    with open(state_path, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, separators=(',', ':'))
    online = sum(1 for m in members if m.get('online'))
    named = sum(1 for p in state['players'] if p.get('member'))
    pos = f'、位置を更新(プレイヤー {len(state["players"])}人・名前が分かった人 {named}人)' if records is not None else ''
    print(f'参加中 {online}人{pos}')


if __name__ == '__main__':
    main()

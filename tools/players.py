"""Player positions, death points, record-to-member matching, and explorer estimates.

World player records (player_server_*) carry positions but no Xbox ID, so we learn which
member owns which record by matching "whose position moved" with "who logged in" between runs.
"""
import datetime
import hashlib
import hmac
import json
import math
import os
import string

import bedrock_db
import render_map

DIM_NAMES = {0: 'overworld', 1: 'nether', 2: 'end'}
BEFORE = '_'
UNKNOWN = '?'


def _hash(secret, value):
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()[:16]


def _load(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))


def read_records(db_dir, secret):
    out = []
    for key, value in bedrock_db.scan(db_dir, lambda k: k.startswith(b'player_server_')):
        try:
            root, _ = render_map._root_compound(value, 0)
            pos = root['Pos']
        except (KeyError, ValueError, IndexError):
            continue
        rec = {
            'key': _hash(secret, key.decode('latin-1')),
            'dim': DIM_NAMES.get(root.get('DimensionId', 0), 'overworld'),
            'x': math.floor(pos[0]), 'y': math.floor(pos[1] - 1.62), 'z': math.floor(pos[2]),
            'death': None,
        }
        if root.get('HasDiedBefore') and 'DeathPositionX' in root:
            rec['death'] = {
                'dim': DIM_NAMES.get(root.get('DeathDimension', 0), 'overworld'),
                'x': root['DeathPositionX'], 'y': root.get('DeathPositionY', 64), 'z': root['DeathPositionZ'],
            }
        out.append(rec)
    return out


def _label(i):
    letters = string.ascii_uppercase
    return 'プレイヤー' + (letters[i] if i < 26 else str(i + 1))


def match_members(players, members, last_run):
    """Link records to members when exactly one unlinked record moved and one unlinked member logged in."""
    linked = {p['member'] for p in players if p.get('member')}
    moved = [p for p in players if not p.get('member') and p['moved']]
    active = [m for m in members if m['id'] not in linked and (
        m.get('online') or (last_run and (m.get('lastLogin') or 0) > last_run))]
    if len(moved) == 1 and len(active) == 1:
        moved[0]['member'] = active[0]['id']
        linked.add(active[0]['id'])
    unlinked = [p for p in players if not p.get('member')]
    ever_joined = [m for m in members if m.get('lastLogin') and m['id'] not in linked]
    if len(unlinked) == 1 and len(ever_joined) == 1:
        unlinked[0]['member'] = ever_joined[0]['id']


def _seg_dist(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    if dx == 0 and dz == 0:
        return math.hypot(px - ax, pz - az)
    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
    return math.hypot(px - (ax + t * dx), pz - (az + t * dz))


def attribute(new_chunks, dim, players, prev_by_key):
    """Give each newly appeared chunk to the player whose path (last position -> now) passed closest."""
    paths = []
    for p in players:
        if p['dim'] != dim:
            continue
        prev = prev_by_key.get(p['key'])
        start = (prev['x'], prev['z']) if prev and prev.get('dim') == dim else (p['x'], p['z'])
        paths.append((p['moved'], p['key'], start, (p['x'], p['z'])))
    if not paths:
        return {c: UNKNOWN for c in new_chunks}
    movers = [q for q in paths if q[0]] or paths
    out = {}
    for cx, cz in new_chunks:
        px, pz = cx * 16 + 8, cz * 16 + 8
        best = min(movers, key=lambda q: _seg_dist(px, pz, q[2][0], q[2][1], q[3][0], q[3][1]))
        out[(cx, cz)] = best[1]
    return out


def update(site, db_dir, chunk_sets, members_path, secret):
    now = int(datetime.datetime.now().timestamp() * 1000)
    players_path = os.path.join(site, 'players.json')
    explore_path = os.path.join(site, 'explore.json')
    prev_state = _load(players_path, {})
    prev_by_key = {p['key']: p for p in prev_state.get('players', [])}
    members = _load(members_path, {}).get('members', []) if members_path else []
    names = {m['id']: m['name'] for m in members if m.get('name')}

    players = []
    for rec in read_records(db_dir, secret):
        prev = prev_by_key.get(rec['key'])
        rec['moved'] = prev is None or (prev['dim'], prev['x'], prev['z']) != (rec['dim'], rec['x'], rec['z'])
        rec['member'] = prev.get('member') if prev else None
        rec['label'] = prev['label'] if prev else None
        rec['movedAt'] = now if rec['moved'] else prev.get('movedAt')
        players.append(rec)
    used = {p['label'] for p in players if p['label']}
    i = 0
    for p in players:
        if not p['label']:
            while _label(i) in used:
                i += 1
            p['label'] = _label(i)
            used.add(p['label'])
    match_members(players, members, prev_state.get('lastRun'))

    explore = _load(explore_path, None)
    first = explore is None
    explore = explore or {'dims': {}}
    added = 0
    for dim, chunks in chunk_sets.items():
        by_owner = explore['dims'].setdefault(dim, {})
        known = {(c[0], c[1]) for cs in by_owner.values() for c in cs}
        new = chunks - known
        owners = {c: BEFORE for c in new} if first else attribute(new, dim, players, prev_by_key)
        for c, owner in owners.items():
            by_owner.setdefault(owner, []).append([c[0], c[1]])
        added += 0 if first else len(new)
    explore['updatedAt'] = now

    public = []
    for p in players:
        public.append({
            'key': p['key'], 'member': p['member'], 'label': p['label'],
            'name': names.get(p['member']) or p['label'],
            'dim': p['dim'], 'x': p['x'], 'y': p['y'], 'z': p['z'],
            'movedAt': p['movedAt'], 'death': p['death'],
        })
    _save(players_path, {'lastRun': now, 'players': public})
    _save(explore_path, explore)
    linked = sum(1 for p in public if p['member'])
    print(f'プレイヤー {len(public)}人(名前が分かった人 {linked}人)、新しく開拓されたチャンク {added}')

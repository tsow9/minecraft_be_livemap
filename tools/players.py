"""Player positions, online status, record-to-member matching, and explorer estimates.

World player records (player_server_*) carry positions but no Xbox ID, so we learn which
member owns which record by matching "whose position moved" with "who was online" between checks.
The state lives in live.json, which the site reads directly.
"""
import hashlib
import hmac
import math
import string

import bedrock_db
import nbt

DIM_NAMES = {0: 'overworld', 1: 'nether', 2: 'end'}
BEFORE = '_'
UNKNOWN = '?'
TRAIL_MAX = 200


def _hash(secret, value):
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()[:16]


def read_records(db_dir, secret):
    out = []
    for key, value in bedrock_db.scan(db_dir, lambda k: k.startswith(b'player_server_')):
        try:
            root, _ = nbt.root_compound(value, 0)
            pos = root['Pos']
        except (KeyError, ValueError, IndexError):
            continue
        rec = {
            'key': _hash(secret, key.decode('latin-1')),
            'dim': DIM_NAMES.get(root.get('DimensionId', 0), 'overworld'),
            'x': math.floor(pos[0]), 'y': math.floor(pos[1] - 1.62), 'z': math.floor(pos[2]),
            'death': None,
        }
        # The bed (or respawn anchor) the player last used; NaturalSpawn = 1 means "no bed, world spawn".
        if root.get('NaturalSpawn') == 0 and 'SpawnBlockPositionX' in root and abs(root['SpawnBlockPositionX']) < 30_000_000:
            rec['bed'] = {
                'dim': DIM_NAMES.get(root.get('SpawnDimension', 0), 'overworld'),
                'x': root['SpawnBlockPositionX'], 'y': root.get('SpawnBlockPositionY', 64), 'z': root['SpawnBlockPositionZ'],
            }
        if root.get('HasDiedBefore') and 'DeathPositionX' in root:
            rec['death'] = {
                'dim': DIM_NAMES.get(root.get('DeathDimension', 0), 'overworld'),
                'x': root['DeathPositionX'], 'y': root.get('DeathPositionY', 64), 'z': root['DeathPositionZ'],
            }
        out.append(rec)
    return out


def _label(i):
    return 'プレイヤー' + (string.ascii_uppercase[i] if i < 26 else str(i + 1))


def anyone_online(state, members):
    """True if someone is online now or was at the last check (so we also catch where they logged out)."""
    return any(m.get('online') for m in members) or any(m.get('online') for m in state.get('members', []))


def _match(players, members, since):
    linked = {p['member'] for p in players if p.get('member')}
    moved = [p for p in players if not p.get('member') and p['_moved']]
    active = [m for m in members if m['id'] not in linked and (
        m.get('online') or (since and (m.get('lastLogin') or 0) > since))]
    if len(moved) == 1 and len(active) == 1:
        moved[0]['member'] = active[0]['id']
        linked.add(active[0]['id'])
    unlinked = [p for p in players if not p.get('member')]
    ever_joined = [m for m in members if m.get('lastLogin') and m['id'] not in linked]
    if len(unlinked) == 1 and len(ever_joined) == 1:
        unlinked[0]['member'] = ever_joined[0]['id']


def update_live(state, members, records, now):
    """Merge a fresh member list (and, if given, fresh world player records) into the live state."""
    prev_members = {m['id']: m for m in state.get('members', []) if m.get('id')}
    merged = []
    for m in members:
        prev = prev_members.get(m['id'], {})
        merged.append({**m, 'lastSeenOnline': now if m.get('online') else prev.get('lastSeenOnline')})
    by_member = {m['id']: m for m in merged}

    players = [p for p in state.get('players', []) if p.get('key')]
    if records is not None:
        prev_by_key = {p['key']: p for p in players}
        players = []
        for rec in records:
            prev = prev_by_key.get(rec['key'], {})
            moved = not prev or (prev['dim'], prev['x'], prev['z']) != (rec['dim'], rec['x'], rec['z'])
            trail = list(prev.get('trail', []))
            if moved:
                trail = (trail + [[now, rec['dim'], rec['x'], rec['z']]])[-TRAIL_MAX:]
            players.append({
                **rec, '_moved': moved, 'member': prev.get('member'), 'label': prev.get('label'),
                'movedAt': now if moved else prev.get('movedAt'), 'trail': trail,
            })
        used = {p['label'] for p in players if p['label']}
        i = 0
        for p in players:
            if not p['label']:
                while _label(i) in used:
                    i += 1
                p['label'] = _label(i)
                used.add(p['label'])
        _match(players, merged, state.get('worldAt'))
        for p in players:
            p.pop('_moved', None)
        state['worldAt'] = now

    for p in players:
        m = by_member.get(p.get('member'))
        p['name'] = (m or {}).get('name') or p['label']
        p['online'] = m.get('online') if m else None
        p['lastSeenOnline'] = m.get('lastSeenOnline') if m else None
    state['members'] = merged
    state['players'] = players
    state['updatedAt'] = now
    return state


def _seg_dist(px, pz, a, b):
    (ax, az), (bx, bz) = a, b
    dx, dz = bx - ax, bz - az
    if dx == 0 and dz == 0:
        return math.hypot(px - ax, pz - az)
    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
    return math.hypot(px - (ax + t * dx), pz - (az + t * dz))


def _paths(players, dim, since):
    """Per player: the path walked in this dimension since `since` (plus the point just before it)."""
    out = []
    for p in players:
        trail = p.get('trail', [])
        recent = [t for t in trail if t[0] > since]
        if not recent:
            continue
        earlier = [t for t in trail if t[0] <= since]
        pts = ([earlier[-1]] if earlier else []) + recent
        pts = [(t[2], t[3]) for t in pts if t[1] == dim]
        if pts:
            out.append((p['key'], pts))
    return out


def attribute(new_chunks, dim, players, since):
    """Give each newly appeared chunk to the player whose recent path passed closest to it."""
    paths = _paths(players, dim, since)
    if not paths:
        paths = [(p['key'], [(p['x'], p['z'])]) for p in players if p.get('dim') == dim]
    if not paths:
        return {c: UNKNOWN for c in new_chunks}
    out = {}
    for cx, cz in new_chunks:
        px, pz = cx * 16 + 8, cz * 16 + 8
        best, best_d = None, float('inf')
        for key, pts in paths:
            segs = list(zip(pts, pts[1:])) or [(pts[0], pts[0])]
            d = min(_seg_dist(px, pz, a, b) for a, b in segs)
            if d < best_d:
                best, best_d = key, d
        out[(cx, cz)] = best
    return out


def update_explore(explore, chunk_sets, live_state, now):
    """Add chunks that appeared since the last run; the very first run marks everything as BEFORE."""
    first = explore is None
    explore = explore or {'dims': {}}
    since = explore.get('updatedAt') or 0
    players = (live_state or {}).get('players', [])
    added = 0
    for dim, chunks in chunk_sets.items():
        by_owner = explore['dims'].setdefault(dim, {})
        known = {(c[0], c[1]) for cs in by_owner.values() for c in cs}
        new = chunks - known
        owners = {c: BEFORE for c in new} if first else attribute(new, dim, players, since)
        for c, owner in owners.items():
            by_owner.setdefault(owner, []).append([c[0], c[1]])
        added += 0 if first else len(new)
    explore['updatedAt'] = now
    return explore, added

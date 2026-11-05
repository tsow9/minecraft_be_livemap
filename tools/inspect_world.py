"""Diagnostics: show which kinds of player records a world holds, without printing names or IDs.

Usage: python inspect_world.py WORLD.mcworld
"""
import collections
import glob
import os
import re
import struct
import sys
import tempfile
import zipfile

import bedrock_db
import nbt
import render_map


def shape(key):
    text = key.decode('latin-1')
    return re.sub(r'[0-9a-fA-F-]{8,}', '<id>', text)


def main():
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(sys.argv[1]) as z:
        z.extractall(tmp)
    db = next(os.path.dirname(p) for p in glob.glob(os.path.join(tmp, '**', 'db'), recursive=True))
    db = os.path.join(db, 'db')
    shapes = collections.Counter()
    samples = {}
    for key, value in bedrock_db.scan(db, lambda k: render_map.parse_key(k) is None and len(k) not in (9, 10, 13, 14)):
        s = shape(key)
        shapes[s] += 1
        if 'player' in s.lower() and s not in samples:
            samples[s] = value
    print('Kinds of keys other than chunks:')
    for s, n in shapes.most_common(40):
        print(f'  {n:5d}  {s}')
    for s, value in samples.items():
        try:
            root, _ = nbt.root_compound(value, 0)
        except Exception as e:  # noqa: BLE001 - diagnostics only
            print(f'{s}: not readable as NBT ({e}), length {len(value)}')
            continue
        fields = {k: type(v).__name__ for k, v in root.items()}
        print(f'{s}: fields {sorted(fields.items())[:60]}')
        if 'Pos' in root:
            print(f'  Pos: {type(root["Pos"]).__name__} of {len(root["Pos"])}, DimensionId: {"DimensionId" in root}')

    # Field names of every player record (values left out), plus the bed / respawn fields if present.
    names = collections.Counter()
    for key, value in bedrock_db.scan(db, lambda k: k.startswith(b'player_server_')):
        try:
            root, _ = nbt.root_compound(value, 0)
        except Exception:  # noqa: BLE001 - diagnostics only
            continue
        names.update(root.keys())
        spawn = {k: v for k, v in root.items() if 'spawn' in k.lower() and isinstance(v, (int, float))}
        if spawn:
            print('  spawn fields:', spawn)
    print('Player record fields (times seen):', sorted(names.items()))
    account_links(db)
    # Where nether portal blocks are, by raw bytes and by the map maker's decoder.
    raw = collections.Counter()
    found = collections.Counter()
    for key, value in bedrock_db.scan(db, lambda k: render_map.parse_key(k) is not None):
        if b'minecraft:portal' not in value:
            continue
        dim, cx, cz, sy = render_map.parse_key(key)
        raw[(dim, cx, cz, sy)] += 1
        try:
            dec = render_map.decode_subchunk(value)
        except Exception as e:  # noqa: BLE001 - diagnostics only
            print('  cannot read a sub-chunk with a portal', (dim, cx, cz, sy), e, 'version', value[0], value[1] if len(value) > 1 else None)
            continue
        if dec is None:
            print('  sub-chunk with a portal reads as empty', (dim, cx, cz, sy), 'version', value[0], value[1] if len(value) > 1 else None)
        elif dec[3] is not None and dec[3].any():
            found[(dim, cx, cz, sy)] += int(dec[3].sum())
        else:
            print('  portal name present but not found', (dim, cx, cz, sy), 'version', value[0], value[1], 'layer head', value[2:4].hex())
    print('Sub-chunks naming the portal block:', sorted(raw), ' read:', dict(found))
    # What blocks are at a given spot (CHECK=x,y,z in the environment), for checking a reported build.
    spot = os.environ.get('CHECK')
    if spot:
        x0, y0, z0 = (int(v) for v in spot.split(','))
        cx, cz, sy = x0 // 16, z0 // 16, y0 // 16
        for key, value in bedrock_db.scan(db, lambda k: render_map.parse_key(k) in ((0, cx, cz, sy), (0, cx, cz, sy + 1))):
            dim, _, _, y_sub = render_map.parse_key(key)
            pos = 3 if value[0] == 9 else 2
            names = []
            p_ = pos + 1
            bits = value[pos] >> 1
            if bits:
                p_ += 4 * -(-4096 // (32 // bits))
            try:
                count = struct.unpack_from('<I', value, p_)[0]
                q = p_ + 4
                for _ in range(count):
                    e, q = nbt.root_compound(value, q)
                    names.append(str(e.get('name')))
            except Exception as e:  # noqa: BLE001 - diagnostics only
                names.append(f'(unreadable {e})')
            print(f'  overworld sub-chunk ({cx},{cz}) from y {y_sub * 16}: version {value[0]}, layers {value[1]}, blocks {names}')
            dec = render_map.decode_subchunk(value)
            if dec:
                _, idx, _, _ = dec
                for yy in range(max(y0 - 2, y_sub * 16), min(y0 + 4, y_sub * 16 + 16)):
                    row = [names[idx[x - cx * 16, z0 - cz * 16, yy - y_sub * 16]].replace('minecraft:', '')
                           for x in range(max(x0 - 3, cx * 16), min(x0 + 4, cx * 16 + 16))]
                    print(f'    y={yy} z={z0} x={max(x0 - 3, cx * 16)}..: {row}')
    villages(db)
    level = os.path.join(os.path.dirname(db), 'level.dat')
    if os.path.exists(level):
        with open(level, 'rb') as f:
            data = f.read()
        try:
            root, _ = nbt.root_compound(data, 8)
            keep = {k: v for k, v in root.items() if re.search(r'time|tick|rain|lightning|weather|daylight|played', k, re.I)
                    and isinstance(v, (int, float))}
            print('level.dat time and weather:', keep)
        except Exception as e:  # noqa: BLE001 - diagnostics only
            print('cannot read level.dat', e)


def outline(v, depth=0):
    """The shape of an NBT value: field names, list lengths and types; no values (but short type names)."""
    if isinstance(v, dict):
        if depth > 4:
            return '{…}'
        return {k: outline(x, depth + 1) for k, x in list(v.items())[:30]}
    if isinstance(v, list):
        return [f'{len(v)} items', outline(v[0], depth + 1)] if v else ['0 items']
    if isinstance(v, str):
        return f'str:{v}' if v.startswith('minecraft:') and len(v) < 60 else 'str'
    return type(v).__name__


def villages(db):
    """Village records (VILLAGE_<id>_INFO / _DWELLERS / _POI / _PLAYERS): how many, their shape, and whether the
    villagers they name are the villagers in the world. Counts and shapes only."""
    kinds = collections.Counter()
    sample = {}
    ids_in_poi = set()
    poi_names = collections.Counter()

    def walk(v, path=''):
        if isinstance(v, dict):
            for k, x in v.items():
                if isinstance(x, int) and re.search(r'id', k, re.I) and abs(x) > 1000:
                    ids_in_poi.add(x)
                if isinstance(x, str) and re.search(r'name|type', k, re.I):
                    poi_names[f'{k}={x}' if len(x) < 50 else k] += 1
                walk(x, path + '/' + k)
        elif isinstance(v, list):
            for x in v:
                walk(x, path)

    for key, value in bedrock_db.scan(db, lambda k: k.startswith(b'VILLAGE_')):
        part = key.decode('latin-1').rsplit('_', 1)[-1]
        kinds[part] += 1
        try:
            root, _ = nbt.root_compound(value, 0)
        except Exception as e:  # noqa: BLE001 - diagnostics only
            kinds[part + ' (unreadable)'] += 1
            continue
        sample.setdefault(part, root)
        if part == 'POI':
            walk(root)
    print('Village records:', dict(kinds))
    for part, root in sample.items():
        print(f'  {part} shape: {outline(root)}')
    print('  POI names and types (times seen):', poi_names.most_common(30))
    # Do the ids in the POI records match the villagers in the world (their UniqueID)?
    villagers = set()
    for key, value in bedrock_db.scan(db, lambda k: k.startswith(b'actorprefix')):
        try:
            root, _ = nbt.root_compound(value, 0)
        except Exception:  # noqa: BLE001
            continue
        if root.get('identifier') in ('minecraft:villager_v2', 'minecraft:villager') and isinstance(root.get('UniqueID'), int):
            villagers.add(root['UniqueID'])
    print(f'  villagers in the world: {len(villagers)}, ids in POI records: {len(ids_in_poi)}, matching: {len(villagers & ids_in_poi)}')


def account_links(db):
    """Whether the world ties player records to accounts: player_<id> records (not player_server_) and what their
    text fields point at. Only counts are printed; IDs and names never are (the log of a public repo is public)."""
    import json
    import players
    secret = os.environ.get('CACHE_KEY', '')
    try:
        with open('members.json', encoding='utf-8') as f:
            listed = json.load(f).get('members', [])
        member_ids = {m['id'] for m in listed if m.get('id')}
        identities = {m['identity'] for m in listed if m.get('identity')}
    except (OSError, ValueError):
        member_ids, identities = set(), set()
    server_keys = {k.decode('latin-1') for k, _ in bedrock_db.scan(db, lambda k: k.startswith(b'player_server_'))}
    links = 0
    fields = collections.Counter()
    hits = collections.Counter()
    for key, value in bedrock_db.scan(db, lambda k: k.startswith(b'player_') and not k.startswith(b'player_server_')):
        links += 1
        try:
            root, _ = nbt.root_compound(value, 0)
        except Exception:  # noqa: BLE001 - diagnostics only
            fields['(not NBT)'] += 1
            continue
        for k, v in root.items():
            fields[f'{k}:{type(v).__name__}'] += 1
            if not isinstance(v, str) or not v:
                continue
            if v in server_keys or f'player_server_{v}' in server_keys:
                hits[f'{k} -> player record'] += 1
            if secret and players._hash(secret, v) in member_ids:
                hits[f'{k} -> Realm member'] += 1
            plain = v.lower().replace('-', '')
            if secret and players._hash(secret, plain) in identities:
                hits[f'{k} -> member in-game id'] += 1
            if v.isdigit():
                hits[f'{k} is digits only ({len(v)})'] += 1
        own = key.decode('latin-1')[len('player_'):]
        if secret and players._hash(secret, own) in member_ids:
            hits['key number -> Realm member'] += 1
    print(f'Links to accounts: {links} player_ records, {len(server_keys)} player records, {len(member_ids)} members')
    print('  player_ record fields:', sorted(fields.items()))
    print('  matches:', sorted(hits.items()) or 'none')


if __name__ == '__main__':
    main()

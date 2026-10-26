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
    print('チャンク以外のキーの種類:')
    for s, n in shapes.most_common(40):
        print(f'  {n:5d}  {s}')
    for s, value in samples.items():
        try:
            root, _ = nbt.root_compound(value, 0)
        except Exception as e:  # noqa: BLE001 - diagnostics only
            print(f'{s}: NBTとして読めない ({e}) 長さ{len(value)}')
            continue
        fields = {k: type(v).__name__ for k, v in root.items()}
        print(f'{s}: 項目 {sorted(fields.items())[:60]}')
        if 'Pos' in root:
            print(f'  Pos の形: {type(root["Pos"]).__name__} {len(root["Pos"])}要素, DimensionId: {"DimensionId" in root}')

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
            print('  リスポーン関連:', spawn)
    print('プレイヤー記録の項目(出てきた数):', sorted(names.items()))
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
            print('  ゲートを含む区画を読めない', (dim, cx, cz, sy), e, '版', value[0], value[1] if len(value) > 1 else None)
            continue
        if dec is None:
            print('  ゲートを含む区画が空扱い', (dim, cx, cz, sy), '版', value[0], value[1] if len(value) > 1 else None)
        elif dec[3] is not None and dec[3].any():
            found[(dim, cx, cz, sy)] += int(dec[3].sum())
        else:
            print('  ゲートの名前はあるのに見つからない区画', (dim, cx, cz, sy), '版', value[0], value[1], '層の頭', value[2:4].hex())
    print('ゲートのブロック名を含む区画:', sorted(raw), ' 読み取れた:', dict(found))
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
                names.append(f'(読めない {e})')
            print(f'  地上 区画 ({cx},{cz}) 高さ{y_sub * 16}〜: 版{value[0]} 層{value[1]} ブロックの種類 {names}')
            dec = render_map.decode_subchunk(value)
            if dec:
                _, idx, _, _ = dec
                for yy in range(max(y0 - 2, y_sub * 16), min(y0 + 4, y_sub * 16 + 16)):
                    row = [names[idx[x - cx * 16, z0 - cz * 16, yy - y_sub * 16]].replace('minecraft:', '')
                           for x in range(max(x0 - 3, cx * 16), min(x0 + 4, cx * 16 + 16))]
                    print(f'    y={yy} z={z0} x={max(x0 - 3, cx * 16)}..: {row}')
    level = os.path.join(os.path.dirname(db), 'level.dat')
    if os.path.exists(level):
        with open(level, 'rb') as f:
            data = f.read()
        try:
            root, _ = nbt.root_compound(data, 8)
            keep = {k: v for k, v in root.items() if re.search(r'time|tick|rain|lightning|weather|daylight|played', k, re.I)
                    and isinstance(v, (int, float))}
            print('level.dat の時刻・天気:', keep)
        except Exception as e:  # noqa: BLE001 - diagnostics only
            print('level.dat を読めない', e)


if __name__ == '__main__':
    main()

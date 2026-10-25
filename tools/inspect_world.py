"""Diagnostics: show which kinds of player records a world holds, without printing names or IDs.

Usage: python inspect_world.py WORLD.mcworld
"""
import collections
import glob
import os
import re
import sys
import tempfile
import zipfile

import bedrock_db
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
            root, _ = render_map._root_compound(value, 0)
        except Exception as e:  # noqa: BLE001 - diagnostics only
            print(f'{s}: NBTとして読めない ({e}) 長さ{len(value)}')
            continue
        fields = {k: type(v).__name__ for k, v in root.items()}
        print(f'{s}: 項目 {sorted(fields.items())[:60]}')
        if 'Pos' in root:
            print(f'  Pos の形: {type(root["Pos"]).__name__} {len(root["Pos"])}要素, DimensionId: {"DimensionId" in root}')


if __name__ == '__main__':
    main()

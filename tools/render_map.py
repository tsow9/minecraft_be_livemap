"""Render a Minecraft Bedrock world into map tiles for the mc-map site.

Usage: python render_map.py [--world PATH] [--site PATH] [--snapshot ID] [--dims overworld,nether,end]
Without --world, it lists the worlds on this PC and asks which one to use.
"""
import argparse
import datetime
import glob
import json
import os
import shutil
import struct
import sys
import tempfile
import time
import zipfile

import numpy as np
from PIL import Image

import bedrock_db
from block_colors import color_of

DIM_IDS = {'overworld': 0, 'nether': 1, 'end': 2}
MIN_ZOOM = -4
AIR, WATER, SOLID = 0, 1, 2
NETHER_TOP = 127
UNSET = -32768


# ---------- little-endian NBT (only what palettes need) ----------
def _nbt(data, pos, tag):
    if tag == 1:
        return data[pos], pos + 1
    if tag == 2:
        return struct.unpack_from('<h', data, pos)[0], pos + 2
    if tag == 3:
        return struct.unpack_from('<i', data, pos)[0], pos + 4
    if tag == 4:
        return struct.unpack_from('<q', data, pos)[0], pos + 8
    if tag == 5:
        return struct.unpack_from('<f', data, pos)[0], pos + 4
    if tag == 6:
        return struct.unpack_from('<d', data, pos)[0], pos + 8
    if tag == 7:
        n = struct.unpack_from('<i', data, pos)[0]
        return data[pos + 4:pos + 4 + n], pos + 4 + n
    if tag == 8:
        n = struct.unpack_from('<H', data, pos)[0]
        return data[pos + 2:pos + 2 + n].decode('utf-8', 'replace'), pos + 2 + n
    if tag == 9:
        sub, n = data[pos], struct.unpack_from('<i', data, pos + 1)[0]
        pos += 5
        out = []
        for _ in range(n):
            v, pos = _nbt(data, pos, sub)
            out.append(v)
        return out, pos
    if tag == 10:
        out = {}
        while True:
            t = data[pos]
            pos += 1
            if t == 0:
                return out, pos
            n = struct.unpack_from('<H', data, pos)[0]
            name = data[pos + 2:pos + 2 + n].decode('utf-8', 'replace')
            out[name], pos = _nbt(data, pos + 2 + n, t)
    if tag == 11:
        n = struct.unpack_from('<i', data, pos)[0]
        return None, pos + 4 + 4 * n
    if tag == 12:
        n = struct.unpack_from('<i', data, pos)[0]
        return None, pos + 4 + 8 * n
    raise ValueError(f'unknown NBT tag {tag}')


def _root_compound(data, pos):
    if data[pos] != 10:
        raise ValueError('palette entry is not a compound')
    n = struct.unpack_from('<H', data, pos + 1)[0]
    return _nbt(data, pos + 3 + n, 10)


# ---------- sub-chunk decoding ----------
_palette_cache = {}


def _palette_lut(data, pos):
    """Return (kinds, colors) lookup arrays for the palette starting at data[pos]."""
    key = bytes(data[pos:pos + 4096])
    hit = _palette_cache.get(key)
    if hit is not None:
        return hit
    count = struct.unpack_from('<I', data, pos)[0]
    pos += 4
    kinds = np.zeros(max(count, 1), np.uint8)
    colors = np.zeros((max(count, 1), 3), np.uint8)
    for i in range(count):
        entry, pos = _root_compound(data, pos)
        states = entry.get('states') if isinstance(entry.get('states'), dict) else {}
        rgb, kind = color_of(str(entry.get('name', 'minecraft:air')), states)
        kinds[i] = {'air': AIR, 'water': WATER, 'solid': SOLID}[kind]
        colors[i] = rgb
    if len(_palette_cache) > 20000:
        _palette_cache.clear()
    _palette_cache[key] = (kinds, colors)
    return kinds, colors


def decode_subchunk(data):
    """Return (block_kind[16,16,16], palette_index[16,16,16], colors) indexed [x][z][y], or None."""
    version = data[0]
    if version == 1:
        pos = 1
    elif version in (8, 9):
        pos = 3 if version == 9 else 2
        if data[1] == 0:
            return None
    else:
        return None
    header = data[pos]
    pos += 1
    bits = header >> 1
    if bits == 0:
        idx = np.zeros(4096, np.uint16)
        # Some writers omit the palette size when there is a single block; tolerate both.
        if not (struct.unpack_from('<I', data, pos)[0] == 1 and data[pos + 4] == 10):
            data = data[:pos] + struct.pack('<I', 1) + data[pos:]
    else:
        per_word = 32 // bits
        n_words = -(-4096 // per_word)
        words = np.frombuffer(data, '<u4', n_words, pos)
        pos += 4 * n_words
        shifts = (np.arange(per_word, dtype=np.uint32) * bits)
        idx = ((words[:, None] >> shifts) & ((1 << bits) - 1)).reshape(-1)[:4096].astype(np.uint16)
    kinds, colors = _palette_lut(data, pos)
    idx = np.minimum(idx, len(kinds) - 1).reshape(16, 16, 16)
    return kinds[idx], idx, colors


# ---------- per-chunk surface ----------
class Surface:
    __slots__ = ('top_y', 'top_c', 'water_y')

    def __init__(self):
        self.top_y = np.full((16, 16), UNSET, np.int16)
        self.top_c = np.zeros((16, 16, 3), np.uint8)
        self.water_y = np.full((16, 16), UNSET, np.int16)


def _highest(mask):
    """For a [x][z][y] mask: (any, highest y index) per column."""
    return mask.any(axis=2), 15 - np.argmax(mask[:, :, ::-1], axis=2)


def merge_open_sky(surf, sub_y, kinds, idx, colors):
    has, ys = _highest(kinds == SOLID)
    gy = sub_y * 16 + ys
    upd = has & (gy > surf.top_y)
    if upd.any():
        xs, zs = np.nonzero(upd)
        surf.top_y[upd] = gy[upd]
        surf.top_c[xs, zs] = colors[idx[xs, zs, ys[upd]]]
    has, ys = _highest(kinds == WATER)
    gy = sub_y * 16 + ys
    upd = has & (gy > surf.water_y)
    surf.water_y[upd] = gy[upd]


def nether_surface(subs):
    """subs: {sub_y: (kinds, idx, colors)} for y 0..127. First solid block below the first air under the roof."""
    surf = Surface()
    solid = np.zeros((16, 16, NETHER_TOP + 1), bool)
    for sy, (kinds, _, _) in subs.items():
        if 0 <= sy <= NETHER_TOP // 16:
            solid[:, :, sy * 16:sy * 16 + 16] = kinds == SOLID
    rev = ~solid[:, :, ::-1]
    has_air = rev.any(axis=2)
    first_air = NETHER_TOP - np.argmax(rev, axis=2)
    below = solid & (np.arange(NETHER_TOP + 1)[None, None, :] < first_air[:, :, None]) & has_air[:, :, None]
    has = below.any(axis=2)
    top = NETHER_TOP - np.argmax(below[:, :, ::-1], axis=2)
    for x, z in zip(*np.nonzero(has)):
        y = int(top[x, z])
        kinds, idx, colors = subs[y // 16]
        surf.top_y[x, z] = y
        surf.top_c[x, z] = colors[idx[x, z, y % 16]]
    return surf


# ---------- world reading ----------
def parse_key(key):
    if len(key) == 10 and key[8] == 47:
        cx, cz = struct.unpack_from('<ii', key)
        return 0, cx, cz, struct.unpack_from('b', key, 9)[0]
    if len(key) == 14 and key[12] == 47:
        cx, cz, dim = struct.unpack_from('<iii', key)
        return dim, cx, cz, struct.unpack_from('b', key, 13)[0]
    return None


def read_surfaces(db_dir, dims):
    want_ids = {DIM_IDS[d] for d in dims}
    surfaces = {d: {} for d in want_ids}
    nether_raw = {}
    seen = 0
    started = time.time()

    def want(key):
        p = parse_key(key)
        return p is not None and p[0] in want_ids

    for key, value in bedrock_db.scan(db_dir, want):
        dim, cx, cz, sy = parse_key(key)
        try:
            decoded = decode_subchunk(value)
        except (ValueError, struct.error, IndexError):
            continue
        if decoded is None:
            continue
        if dim == 1:
            if 0 <= sy <= NETHER_TOP // 16:
                nether_raw.setdefault((cx, cz), {})[sy] = decoded
        else:
            surf = surfaces[dim].get((cx, cz))
            if surf is None:
                surf = surfaces[dim][(cx, cz)] = Surface()
            merge_open_sky(surf, sy, *decoded)
        seen += 1
        if seen % 20000 == 0:
            print(f'  {seen} 区画を読み込み中... ({time.time() - started:.0f}秒)', flush=True)
    for pos, subs in nether_raw.items():
        surfaces[1][pos] = nether_surface(subs)
    return surfaces


# ---------- tiles ----------
def _shade(height, color, present):
    north = np.vstack([height[:1], height[:-1]])
    dh = height.astype(np.int32) - north.astype(np.int32)
    factor = np.where(dh > 0, 1.1, np.where(dh < 0, 0.84, 1.0))
    factor = np.where(present, factor, 1.0)
    return np.clip(color * factor[:, :, None], 0, 255)


def build_tile(chunks, tx, tz):
    height = np.zeros((256, 256), np.int16)
    color = np.zeros((256, 256, 3), np.float32)
    water = np.full((256, 256), UNSET, np.int16)
    alpha = np.zeros((256, 256), np.uint8)
    for (cx, cz), surf in chunks:
        ox, oz = (cx - tx * 16) * 16, (cz - tz * 16) * 16
        sl = (slice(oz, oz + 16), slice(ox, ox + 16))
        height[sl] = surf.top_y.T
        color[sl] = surf.top_c.transpose(1, 0, 2)
        water[sl] = surf.water_y.T
        alpha[sl] = np.where((surf.top_y.T > UNSET) | (surf.water_y.T > UNSET), 255, 0)
    present = alpha > 0
    rgb = _shade(height, color, present & (height > UNSET))
    is_water = water > height
    if is_water.any():
        depth = (water - np.maximum(height, water - 64)).astype(np.float32)
        a = np.clip(0.5 + depth * 0.05, 0.5, 0.9)[:, :, None]
        wcol = np.array([48, 98, 205], np.float32) * np.clip(1.05 - depth * 0.012, 0.65, 1.0)[:, :, None]
        rgb = np.where(is_water[:, :, None], rgb * (1 - a) + wcol * a, rgb)
    out = np.dstack([rgb.astype(np.uint8), alpha])
    return Image.fromarray(out, 'RGBA')


def write_tiles(surfaces, out_dir):
    by_tile = {}
    for (cx, cz), surf in surfaces.items():
        by_tile.setdefault((cx // 16, cz // 16), []).append(((cx, cz), surf))
    level = {}
    for (tx, tz), chunks in by_tile.items():
        img = build_tile(chunks, tx, tz)
        path = os.path.join(out_dir, '0', str(tx), f'{tz}.png')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        img.save(path, compress_level=6)
        level[(tx, tz)] = img
    for z in range(-1, MIN_ZOOM - 1, -1):
        parents = {}
        for (tx, tz), img in level.items():
            parents.setdefault((tx // 2, tz // 2), []).append(((tx, tz), img))
        nxt = {}
        for (px, pz), kids in parents.items():
            canvas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
            for (tx, tz), img in kids:
                canvas.paste(img, ((tx - px * 2) * 256, (tz - pz * 2) * 256))
            small = canvas.resize((256, 256), Image.BOX)
            path = os.path.join(out_dir, str(z), str(px), f'{pz}.png')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            small.save(path, compress_level=6)
            nxt[(px, pz)] = small
        level = nxt
    return len(by_tile)


# ---------- world discovery ----------
def world_dirs():
    roots = []
    local = os.environ.get('LOCALAPPDATA')
    roaming = os.environ.get('APPDATA')
    if local:
        roots.append(os.path.join(local, 'Packages', 'Microsoft.MinecraftUWP_8wekyb3d8bbwe', 'LocalState', 'games', 'com.mojang', 'minecraftWorlds'))
    if roaming:
        roots += glob.glob(os.path.join(roaming, 'Minecraft Bedrock', 'Users', '*', 'games', 'com.mojang', 'minecraftWorlds'))
    found = []
    for root in roots:
        for d in glob.glob(os.path.join(root, '*')):
            if os.path.isdir(os.path.join(d, 'db')):
                found.append(d)
    return sorted(found, key=lambda d: os.path.getmtime(os.path.join(d, 'db')), reverse=True)


def world_name(d):
    try:
        with open(os.path.join(d, 'levelname.txt'), encoding='utf-8') as f:
            return f.read().strip()
    except OSError:
        return os.path.basename(d)


def choose_world():
    worlds = world_dirs()
    if not worlds:
        sys.exit('このPCにワールドが見つかりませんでした。--world でフォルダか .mcworld ファイルを指定してください。')
    print('このPCにあるワールド(新しい順):')
    for i, d in enumerate(worlds[:15], 1):
        t = datetime.datetime.fromtimestamp(os.path.getmtime(os.path.join(d, 'db'))).strftime('%m/%d %H:%M')
        print(f'  {i}. {world_name(d)}  ({t})')
    ans = input('番号を入れてEnter(そのままEnterなら1): ').strip() or '1'
    if not ans.isdigit() or not 1 <= int(ans) <= len(worlds[:15]):
        sys.exit('番号が正しくありません。')
    return worlds[int(ans) - 1]


# ---------- config ----------
def update_config(site, snap_id, label):
    path = os.path.join(site, 'config.json')
    with open(path, encoding='utf-8') as f:
        cfg = json.load(f)
    snaps = [s for s in cfg.get('snapshots', []) if s.get('id') != snap_id]
    snaps.append({'id': snap_id, 'label': label})
    cfg['snapshots'] = sorted(snaps, key=lambda s: s['id'])
    cfg['minNativeZoom'] = MIN_ZOOM
    cfg['maxNativeZoom'] = 0
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write('\n')


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description='統合版ワールドから地図タイルを作ります')
    ap.add_argument('--world', help='ワールドのフォルダ、または .mcworld ファイル')
    ap.add_argument('--site', default=os.path.dirname(here), help='地図サイトのフォルダ')
    ap.add_argument('--snapshot', help='保存名(省略すると今日の日付)')
    ap.add_argument('--dims', default='overworld,nether,end')
    args = ap.parse_args()

    dims = [d.strip() for d in args.dims.split(',') if d.strip()]
    if any(d not in DIM_IDS for d in dims):
        sys.exit('--dims には overworld / nether / end を指定してください。')
    world = args.world or choose_world()
    tmp = None
    if os.path.isfile(world) and world.lower().endswith(('.mcworld', '.zip')):
        tmp = tempfile.mkdtemp(prefix='mcmap-')
        with zipfile.ZipFile(world) as z:
            z.extractall(tmp)
        world = next((os.path.dirname(p) for p in glob.glob(os.path.join(tmp, '**', 'db'), recursive=True)), tmp)
    db_dir = os.path.join(world, 'db')
    if not os.path.isdir(db_dir):
        sys.exit(f'ワールドのデータ(db フォルダ)が見つかりません: {world}')

    today = datetime.date.today()
    snap_id = args.snapshot or today.isoformat()
    label = f'{today.month}月{today.day}日' if not args.snapshot else args.snapshot
    out_root = os.path.join(args.site, 'tiles', snap_id)

    print(f'ワールド「{world_name(world)}」を読み込みます。大きいワールドだと数分かかります。')
    started = time.time()
    try:
        surfaces = read_surfaces(db_dir, dims)
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    if os.path.isdir(out_root):
        shutil.rmtree(out_root)
    total = 0
    for name in dims:
        chunks = surfaces[DIM_IDS[name]]
        if not chunks:
            print(f'  {name}: データなし')
            continue
        n = write_tiles(chunks, os.path.join(out_root, name))
        total += n
        print(f'  {name}: {len(chunks)} チャンク → {n} 枚の地図画像')
    if total == 0:
        sys.exit('地図にできるデータがありませんでした。')
    update_config(args.site, snap_id, label)
    print(f'完了しました({time.time() - started:.0f}秒)。保存名: {snap_id}')


if __name__ == '__main__':
    main()

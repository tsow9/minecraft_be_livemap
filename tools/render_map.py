"""Render a Minecraft Bedrock world into map tiles for the mc-map site.

Usage: python render_map.py --world PATH [--site PATH] [--snapshot ID] [--live LIVE_JSON] [--dims overworld,nether,end]
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
from nbt import root_compound
import block_colors
import block_ids
import history
from block_colors import color_of, is_foliage

DIM_IDS = {'overworld': 0, 'nether': 1, 'end': 2}
MIN_ZOOM = -6
AIR, WATER, SOLID = 0, 1, 2
NETHER_TOP = 127
UNSET = -32768


# ---------- sub-chunk decoding ----------
_palette_cache = {}


def _palette_lut(data, pos):
    """Return (kinds, colors, ids) lookup arrays for the palette starting at data[pos]."""
    key = bytes(data[pos:pos + 4096])
    hit = _palette_cache.get(key)
    if hit is not None:
        return hit
    count = struct.unpack_from('<I', data, pos)[0]
    pos += 4
    kinds = np.zeros(max(count, 1), np.uint8)
    colors = np.zeros((max(count, 1), 3), np.uint8)
    ids = np.zeros(max(count, 1), np.uint16)
    ground = np.zeros(max(count, 1), bool)
    for i in range(count):
        entry, pos = root_compound(data, pos)
        states = entry.get('states') if isinstance(entry.get('states'), dict) else {}
        name = str(entry.get('name', 'minecraft:air'))
        rgb, kind = color_of(name, states)
        kinds[i] = {'air': AIR, 'water': WATER, 'solid': SOLID}[kind]
        colors[i] = rgb
        ids[i] = block_ids.id_of(name, states)
        ground[i] = kind == 'solid' and not is_foliage(name)
    if len(_palette_cache) > 20000:
        _palette_cache.clear()
    _palette_cache[key] = (kinds, colors, ids, ground)
    return kinds, colors, ids, ground


def decode_subchunk(data):
    """Return (block_kind[16,16,16], palette_index[16,16,16], (colors, ids)) indexed [x][z][y], or None."""
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
    kinds, colors, ids, ground = _palette_lut(data, pos)
    idx = np.minimum(idx, len(kinds) - 1).reshape(16, 16, 16)
    return kinds[idx], idx, (colors, ids, ground)


# ---------- per-chunk surface ----------
class Surface:
    __slots__ = ('top_y', 'top_c', 'top_id', 'water_y', 'ground_y')

    def __init__(self):
        self.top_y = np.full((16, 16), UNSET, np.int16)
        self.top_c = np.zeros((16, 16, 3), np.uint8)
        self.top_id = np.zeros((16, 16), np.uint16)
        self.ground_y = np.full((16, 16), UNSET, np.int16)
        self.water_y = np.full((16, 16), UNSET, np.int16)


def _highest(mask):
    """For a [x][z][y] mask: (any, highest y index) per column."""
    return mask.any(axis=2), 15 - np.argmax(mask[:, :, ::-1], axis=2)


def merge_open_sky(surf, sub_y, kinds, idx, lut):
    colors, ids, ground = lut
    has, ys = _highest(kinds == SOLID)
    gy = sub_y * 16 + ys
    upd = has & (gy > surf.top_y)
    if upd.any():
        xs, zs = np.nonzero(upd)
        surf.top_y[upd] = gy[upd]
        pal = idx[xs, zs, ys[upd]]
        surf.top_c[xs, zs] = colors[pal]
        surf.top_id[xs, zs] = ids[pal]
    has, ys = _highest(ground[idx])
    gy = sub_y * 16 + ys
    upd = has & (gy > surf.ground_y)
    surf.ground_y[upd] = gy[upd]
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
        kinds, idx, (colors, ids, _) = subs[y // 16]
        pal = idx[x, z, y % 16]
        surf.top_y[x, z] = y
        surf.top_c[x, z] = colors[pal]
        surf.top_id[x, z] = ids[pal]
        surf.ground_y[x, z] = y
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


def build_ground_tile(chunks, tx, tz):
    """Ground height without trees and plants (for contour lines): value = Y + 65 in R/G, 0 = no data.
    B = 1 where water covers the top, so the site can skip it without loading other tiles."""
    v = np.zeros((256, 256), np.uint32)
    wet = np.zeros((256, 256), np.uint8)
    for (cx, cz), surf in chunks:
        ox, oz = (cx - tx * 16) * 16, (cz - tz * 16) * 16
        g = surf.ground_y.T.astype(np.int32)
        v[oz:oz + 16, ox:ox + 16] = np.where(g > UNSET, np.clip(g + 65, 1, 65535), 0)
        wet[oz:oz + 16, ox:ox + 16] = surf.water_y.T > surf.top_y.T
    rgb = np.dstack([(v >> 8) & 255, v & 255, wet]).astype(np.uint8)
    return Image.fromarray(rgb, 'RGB')


def build_info_tile(chunks, tx, tz):
    """Per block: which block is on top and its height, packed into RGB (12-bit block ID, 9-bit Y+64)."""
    ids = np.zeros((256, 256), np.uint32)
    ys = np.zeros((256, 256), np.int32)
    water_id = block_ids.id_of('minecraft:water', {})
    for (cx, cz), surf in chunks:
        ox, oz = (cx - tx * 16) * 16, (cz - tz * 16) * 16
        sl = (slice(oz, oz + 16), slice(ox, ox + 16))
        top, water = surf.top_y.T.astype(np.int32), surf.water_y.T.astype(np.int32)
        wet = water > top
        ids[sl] = np.where(wet, water_id, np.where(top > UNSET, surf.top_id.T, 0))
        ys[sl] = np.where(wet, water, top)
    v = (ids << 9) | np.clip(ys + 64, 0, 511).astype(np.uint32)
    v[ids == 0] = 0
    rgb = np.dstack([(v >> 16) & 255, (v >> 8) & 255, v & 255]).astype(np.uint8)
    return Image.fromarray(rgb, 'RGB')


def write_tiles(surfaces, out_dir, info_dir, ground_dir):
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
        info = os.path.join(info_dir, str(tx), f'{tz}.png')
        os.makedirs(os.path.dirname(info), exist_ok=True)
        build_info_tile(chunks, tx, tz).save(info, compress_level=9)
        ground = os.path.join(ground_dir, str(tx), f'{tz}.png')
        os.makedirs(os.path.dirname(ground), exist_ok=True)
        build_ground_tile(chunks, tx, tz).save(ground, compress_level=9)
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
def world_name(d):
    try:
        with open(os.path.join(d, 'levelname.txt'), encoding='utf-8') as f:
            return f.read().strip()
    except OSError:
        return os.path.basename(d)


def _official_japanese():
    """Lookup for the game's own Japanese block names, or None if the file can't be fetched."""
    import official_names
    try:
        lang = official_names.download()
    except OSError as e:
        print(f'公式の日本語名を取得できませんでした(前回の名前を使います): {e}')
        return None
    return lambda key: official_names.japanese(key, lang)


def _load_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# ---------- config ----------
def snapshot_label(snap_id):
    try:
        d = datetime.date.fromisoformat(snap_id)
    except ValueError:
        return snap_id
    return f'{d.month}月{d.day}日'


def update_config(site, snap_id, staging):
    """Save the rendered tiles as this day's map and thin out old days."""
    path = os.path.join(site, 'config.json')
    cfg = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            cfg = json.load(f)
    ids = sorted(s['id'] for s in cfg.get('snapshots', []) if s.get('id') and s['id'] != snap_id)
    history.migrate(site, ids)
    changed, total = history.store(site, snap_id, staging, ids)
    print(f'  保存: 地図画像 {total} 枚のうち、前回から変わった {changed} 枚')
    ids = history.prune(site, sorted(ids + [snap_id]), datetime.date.today())
    cfg['snapshots'] = [{'id': i, 'label': snapshot_label(i)} for i in ids]
    cfg['updatedAt'] = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
    cfg['minNativeZoom'] = MIN_ZOOM
    cfg['maxNativeZoom'] = 0
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write('\n')


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description='統合版ワールドから地図タイルを作ります')
    ap.add_argument('--world', required=True, help='ワールドのフォルダ、または .mcworld ファイル')
    ap.add_argument('--site', default=os.path.dirname(here), help='地図サイトのフォルダ')
    ap.add_argument('--snapshot', help='保存名(省略すると今日の日付)')
    ap.add_argument('--dims', default='overworld,nether,end')
    ap.add_argument('--live', help='live.json(開拓者の推定に使う足跡)。空文字なら足跡なしで記録だけ始める')
    args = ap.parse_args()

    dims = [d.strip() for d in args.dims.split(',') if d.strip()]
    if any(d not in DIM_IDS for d in dims):
        sys.exit('--dims には overworld / nether / end を指定してください。')
    world = args.world
    tmp = None
    if os.path.isfile(world) and world.lower().endswith(('.mcworld', '.zip')):
        tmp = tempfile.mkdtemp(prefix='mcmap-')
        with zipfile.ZipFile(world) as z:
            z.extractall(tmp)
        world = next((os.path.dirname(p) for p in glob.glob(os.path.join(tmp, '**', 'db'), recursive=True)), tmp)
    db_dir = os.path.join(world, 'db')
    if not os.path.isdir(db_dir):
        sys.exit(f'ワールドのデータ(db フォルダ)が見つかりません: {world}')

    snap_id = args.snapshot or datetime.date.today().isoformat()

    block_ids.load(args.site)
    print(f'ワールド「{world_name(world)}」を読み込みます。大きいワールドだと数分かかります。')
    started = time.time()
    try:
        surfaces = read_surfaces(db_dir, dims)
        if args.live is not None:
            import players
            explore_path = os.path.join(args.site, 'explore.json')
            explore = _load_json(explore_path)
            live_state = _load_json(args.live) if args.live else None
            chunk_sets = {name: set(surfaces[DIM_IDS[name]]) for name in dims}
            explore, added = players.update_explore(explore, chunk_sets, live_state, int(time.time() * 1000))
            with open(explore_path, 'w', encoding='utf-8') as f:
                json.dump(explore, f, separators=(',', ':'))
            print(f'新しく開拓されたチャンク: {added}')
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    if block_colors.unknown:
        names = ', '.join(sorted(block_colors.unknown))
        print(f'色が未登録で灰色になったブロック({len(block_colors.unknown)}種類): {names}')
    staging = tempfile.mkdtemp(prefix='mcmap-tiles-')
    try:
        total = 0
        for name in dims:
            chunks = surfaces[DIM_IDS[name]]
            if not chunks:
                print(f'  {name}: データなし')
                continue
            n = write_tiles(chunks, os.path.join(staging, name), os.path.join(staging, 'info', name),
                            os.path.join(staging, 'ground', name))
            total += n
            print(f'  {name}: {len(chunks)} チャンク → {n} 枚の地図画像')
        if total == 0:
            sys.exit('地図にできるデータがありませんでした。')
        block_ids.save(args.site, _official_japanese())
        update_config(args.site, snap_id, staging)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    print(f'完了しました({time.time() - started:.0f}秒)。保存名: {snap_id}')


if __name__ == '__main__':
    main()

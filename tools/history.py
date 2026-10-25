"""Map history: each saved day stores only the tiles that changed since the previous day.

manifests/<day>.json lists every tile of that day and which day's folder holds its image:
  {"tiles": {"overworld/0/3/-2": ["2026-10-20", "<hash>"], ...}}
"""
import datetime
import hashlib
import json
import os
import shutil

DAILY_DAYS = 30
WEEKLY_DAYS = 183


def _manifest_path(site, snap):
    return os.path.join(site, 'manifests', f'{snap}.json')


def load_manifest(site, snap):
    try:
        with open(_manifest_path(site, snap), encoding='utf-8') as f:
            return json.load(f)['tiles']
    except (OSError, ValueError, KeyError):
        return None


def _save_manifest(site, snap, tiles):
    os.makedirs(os.path.join(site, 'manifests'), exist_ok=True)
    with open(_manifest_path(site, snap), 'w', encoding='utf-8') as f:
        json.dump({'tiles': tiles}, f, separators=(',', ':'))


def _digest(path):
    with open(path, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:16]


def _tile_files(root):
    for dirpath, _, files in os.walk(root):
        for name in files:
            if name.endswith('.png'):
                full = os.path.join(dirpath, name)
                yield os.path.relpath(full, root)[:-4].replace(os.sep, '/'), full


def migrate(site, snaps):
    """Give older snapshots that predate manifests a manifest pointing at their own folder."""
    for snap in snaps:
        if load_manifest(site, snap) is None:
            folder = os.path.join(site, 'tiles', snap)
            _save_manifest(site, snap, {k: [snap, _digest(p)] for k, p in _tile_files(folder)})


def store(site, snap, staging, snaps):
    """Save the freshly rendered tiles in `staging` as snapshot `snap`, keeping only changed images."""
    later = [s for s in snaps if s > snap]
    if later:
        raise SystemExit(f'{snap} より新しい地図({later[-1]})があるため、この日付では保存できません。')
    earlier = [s for s in snaps if s < snap]
    prev = load_manifest(site, earlier[-1]) if earlier else {}
    folder = os.path.join(site, 'tiles', snap)
    shutil.rmtree(folder, ignore_errors=True)
    tiles, changed = {}, 0
    for key, path in _tile_files(staging):
        h = _digest(path)
        old = (prev or {}).get(key)
        if old and old[1] == h:
            tiles[key] = old
            continue
        dest = os.path.join(folder, *key.split('/')) + '.png'
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(path, dest)
        tiles[key] = [snap, h]
        changed += 1
    _save_manifest(site, snap, tiles)
    return changed, len(tiles)


def _parse(snap):
    try:
        return datetime.date.fromisoformat(snap)
    except ValueError:
        return None


def choose_keep(snaps, today):
    """Every day for 30 days, the last day of each week for half a year, then the last day of each month."""
    keep = set(snaps[-1:])
    weekly, monthly = {}, {}
    for s in snaps:
        d = _parse(s)
        if d is None:
            keep.add(s)
            continue
        age = (today - d).days
        if age <= DAILY_DAYS:
            keep.add(s)
        elif age <= WEEKLY_DAYS:
            wk = d.isocalendar()[:2]
            weekly[wk] = max(weekly.get(wk, s), s)
        else:
            mo = (d.year, d.month)
            monthly[mo] = max(monthly.get(mo, s), s)
    return keep | set(weekly.values()) | set(monthly.values())


def remove(site, snap, snaps):
    """Delete one snapshot; images that later days still use move to the next kept day."""
    rest = [s for s in snaps if s != snap]
    nxt = next((s for s in rest if s > snap), None)
    folder = os.path.join(site, 'tiles', snap)
    later = {s: load_manifest(site, s) or {} for s in rest if s > snap}
    for key, path in list(_tile_files(folder)):
        if nxt and later[nxt].get(key, [None])[0] == snap:
            dest = os.path.join(site, 'tiles', nxt, *key.split('/')) + '.png'
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.move(path, dest)
            for s, tiles in later.items():
                if tiles.get(key, [None])[0] == snap:
                    tiles[key] = [nxt, tiles[key][1]]
    for s, tiles in later.items():
        _save_manifest(site, s, tiles)
    shutil.rmtree(folder, ignore_errors=True)
    try:
        os.remove(_manifest_path(site, snap))
    except OSError:
        pass
    return rest


def prune(site, snaps, today):
    keep = choose_keep(snaps, today)
    for snap in sorted(snaps):
        if snap not in keep:
            snaps = remove(site, snap, snaps)
            print(f'古い地図 {snap} を間引きました')
    return snaps

"""Assemble the published site: site files from this repo plus tiles and snapshot list from the map data folder.

Usage: python build_site.py DATA_DIR OUT_DIR [--data-folder NAME [--items-folder NAME]]

With --data-folder (the Cloudflare site), the map data goes into OUT_DIR/d/NAME/ and the site's own config.json
keeps nothing about the map: only invited visitors are told NAME (see worker/worker.js). With --items-folder too,
items.json goes into OUT_DIR/x/NAME/ instead, which only the worker reads (it hides what the owner chose to hide).
"""
import json
import os
import re
import shutil
import sys
import time
from msg import t

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_ITEMS = ['index.html', 'login.html', 'favicon.svg', 'apple-touch-icon.png', 'manifest.webmanifest', 'icons', 'css', 'js', 'vendor']
MAP_KEYS = ['snapshots', 'updatedAt', 'minNativeZoom', 'maxNativeZoom']


def release():
    """The release number (VERSION at the top of the repository, e.g. 1.2.0)."""
    try:
        with open(os.path.join(ROOT, 'VERSION'), encoding='utf-8') as f:
            return f.read().strip()[:20]
    except OSError:
        return ''


def load_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def add_world(data, put, items_to, version):
    """One world's map: its config.json (the site's settings plus its past maps), tiles and search data."""
    with open(os.path.join(ROOT, 'config.json'), encoding='utf-8') as f:
        cfg = json.load(f)
    generated = load_json(os.path.join(data, 'config.json'))
    if generated:
        cfg.update({k: generated[k] for k in MAP_KEYS if k in generated})
        for sub in ('tiles', 'manifests'):
            if os.path.isdir(os.path.join(data, sub)):
                shutil.copytree(os.path.join(data, sub), os.path.join(put, sub))
    os.makedirs(put, exist_ok=True)
    for name in ('explore.json', 'blocks.json', 'portals.json', 'items.json', 'biomes.json'):
        if os.path.exists(os.path.join(data, name)):
            to = items_to if name == 'items.json' and items_to else put
            os.makedirs(to, exist_ok=True)
            shutil.copy2(os.path.join(data, name), to)
    cfg['version'] = version  # names the files of this build (so browsers fetch new ones)
    cfg['release'] = release()  # open pages offer to switch only when this changes (VERSION, set at each release)
    with open(os.path.join(put, 'config.json'), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    return cfg


def main():
    data, out = sys.argv[1], sys.argv[2]
    folder = sys.argv[sys.argv.index('--data-folder') + 1] if '--data-folder' in sys.argv else ''
    items_folder = sys.argv[sys.argv.index('--items-folder') + 1] if '--items-folder' in sys.argv else ''
    for name in (folder, items_folder):
        if name and not re.fullmatch(r'[0-9a-f]{16,64}', name):
            sys.exit(t('--data-folder と --items-folder は16文字以上の16進数にしてください', '--data-folder and --items-folder must be 16 or more hex digits'))
    put = os.path.join(out, 'd', folder) if folder else out
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    for item in SITE_ITEMS:
        src = os.path.join(ROOT, item)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(out, item))
        else:
            shutil.copy2(src, out)
    version = (os.environ.get('GITHUB_SHA') or str(int(time.time())))[:12]
    items_root = os.path.join(out, 'x', items_folder) if items_folder else ''
    cfg = add_world(data, put, items_root, version)
    # The Realm's other worlds (tools/worlds.py): each in worlds/<slot>/, the same way.
    worlds = load_json(os.path.join(data, 'worlds.json'))
    for e in (worlds or {}).get('list', []):
        sub = e.get('dir') if isinstance(e, dict) else None
        if sub and re.fullmatch(r'worlds/\d{1,2}/', sub) and os.path.isdir(os.path.join(data, sub)):
            add_world(os.path.join(data, sub), os.path.join(put, sub), os.path.join(items_root, sub) if items_root else '', version)
    if worlds:
        with open(os.path.join(put, 'worlds.json'), 'w', encoding='utf-8') as f:
            json.dump(worlds, f, ensure_ascii=False)
    page = os.path.join(out, 'index.html')
    with open(page, encoding='utf-8') as f:
        html = f.read()
    html = re.sub(r'((?:src|href)="(?:js|css)/[^"?]+)"', rf'\1?v={version}"', html)
    html = html.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n<meta name="blockmap-release" content="{release()}">', 1)
    with open(page, 'w', encoding='utf-8') as f:
        f.write(html)
    if folder:
        # Map pictures never change at an address (a new picture gets a new ?v=), so browsers may keep them; otherwise
        # Cloudflare has them asked for again at every zoom.
        with open(os.path.join(out, '_headers'), 'w', encoding='utf-8') as f:
            f.write('/d/:dir/tiles/*\n  Cache-Control: public, max-age=31536000, immutable\n'
                    '/d/:dir/worlds/:w/tiles/*\n  Cache-Control: public, max-age=31536000, immutable\n')
    if folder:  # the open part of the site says nothing about the map
        with open(os.path.join(out, 'config.json'), 'w', encoding='utf-8') as f:
            json.dump({k: v for k, v in cfg.items() if k not in MAP_KEYS}, f, ensure_ascii=False, indent=2)
    print(t(f'公開用のファイルをまとめました(地図 {len(cfg.get("snapshots", []))} 回分)', f'Site files ready ({len(cfg.get("snapshots", []))} maps)'))


if __name__ == '__main__':
    main()

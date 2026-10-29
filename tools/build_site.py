"""Assemble the published site: site files from this repo plus tiles and snapshot list from the map data folder.

Usage: python build_site.py DATA_DIR OUT_DIR [--data-folder NAME]

With --data-folder (the Cloudflare site), the map data goes into OUT_DIR/d/NAME/ and the site's own config.json
keeps nothing about the map: only invited visitors are told NAME (see worker/worker.js).
"""
import json
import os
import re
import shutil
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_ITEMS = ['index.html', 'login.html', 'favicon.svg', 'apple-touch-icon.png', 'manifest.webmanifest', 'icons', 'css', 'js', 'vendor']
MAP_KEYS = ['snapshots', 'updatedAt', 'minNativeZoom', 'maxNativeZoom']


def main():
    data, out = sys.argv[1], sys.argv[2]
    folder = sys.argv[sys.argv.index('--data-folder') + 1] if '--data-folder' in sys.argv else ''
    if folder and not re.fullmatch(r'[0-9a-f]{16,64}', folder):
        sys.exit('--data-folder は16文字以上の16進数にしてください')
    put = os.path.join(out, 'd', folder) if folder else out
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    for item in SITE_ITEMS:
        src = os.path.join(ROOT, item)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(out, item))
        else:
            shutil.copy2(src, out)
    with open(os.path.join(ROOT, 'config.json'), encoding='utf-8') as f:
        cfg = json.load(f)
    data_cfg = os.path.join(data, 'config.json')
    if os.path.exists(data_cfg):
        with open(data_cfg, encoding='utf-8') as f:
            generated = json.load(f)
        cfg.update({k: generated[k] for k in MAP_KEYS if k in generated})
        for sub in ('tiles', 'manifests'):
            if os.path.isdir(os.path.join(data, sub)):
                shutil.copytree(os.path.join(data, sub), os.path.join(put, sub))
    os.makedirs(put, exist_ok=True)
    for name in ('explore.json', 'blocks.json', 'portals.json', 'items.json'):
        if os.path.exists(os.path.join(data, name)):
            shutil.copy2(os.path.join(data, name), put)
    repo = os.environ.get('GITHUB_REPOSITORY')
    if folder:
        cfg.pop('shareUrl', None)  # the worker answers the api on the same site
    elif repo and not cfg.get('liveUrl'):
        cfg['liveUrl'] = f'https://raw.githubusercontent.com/{repo}/live-data/live.json'
        cfg['liveApiUrl'] = f'https://api.github.com/repos/{repo}/contents/live.json?ref=live-data'
    version = (os.environ.get('GITHUB_SHA') or str(int(time.time())))[:12]
    page = os.path.join(out, 'index.html')
    with open(page, encoding='utf-8') as f:
        html = f.read()
    html = re.sub(r'((?:src|href)="(?:js|css)/[^"?]+)"', rf'\1?v={version}"', html)
    with open(page, 'w', encoding='utf-8') as f:
        f.write(html)
    cfg['version'] = version  # open pages compare this with their own and switch to the new site
    with open(os.path.join(put, 'config.json'), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    if folder:  # the open part of the site says nothing about the map
        with open(os.path.join(out, 'config.json'), 'w', encoding='utf-8') as f:
            json.dump({k: v for k, v in cfg.items() if k not in MAP_KEYS}, f, ensure_ascii=False, indent=2)
    print(f'公開用のファイルをまとめました(地図 {len(cfg.get("snapshots", []))} 回分)')


if __name__ == '__main__':
    main()

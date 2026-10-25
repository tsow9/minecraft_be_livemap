"""Assemble the published site: site files from this repo plus tiles and snapshot list from the map data folder.

Usage: python build_site.py DATA_DIR OUT_DIR
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_ITEMS = ['index.html', 'css', 'js', 'vendor']
MAP_KEYS = ['snapshots', 'updatedAt', 'minNativeZoom', 'maxNativeZoom']


def main():
    data, out = sys.argv[1], sys.argv[2]
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
        tiles = os.path.join(data, 'tiles')
        if os.path.isdir(tiles):
            shutil.copytree(tiles, os.path.join(out, 'tiles'))
    with open(os.path.join(out, 'config.json'), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print(f'公開用のファイルをまとめました(地図 {len(cfg.get("snapshots", []))} 回分)')


if __name__ == '__main__':
    main()

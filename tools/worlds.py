"""Each world of the Realm (its slots: up to three worlds, of which one is played at a time) gets its own map.

The world first mapped (the "home" world) keeps the map data folder itself, as before; any other world gets
worlds/<slot>/ inside it, with its own tiles, past maps and search data. worlds.json lists them for the site:

  {"active": 2, "list": [{"slot": 1, "name": "…", "dir": "", "at": 1793…}, {"slot": 2, "name": "…", "dir": "worlds/2/", …}]}

Usage:
  python worlds.py target DATA MEMBERS_JSON   where to draw the world just downloaded: prints dir=… and switched=…
                                              (also to $GITHUB_OUTPUT); switched=true when another world is now played
  python worlds.py record DATA MEMBERS_JSON   notes the world just drawn (name, folder, time) and which one is played
"""
import json
import os
import sys
import time


def _load(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def played(members):
    """(slot, name) of the world being played, from the Realm's details next to the download."""
    realm = _load(members, {}).get('realm') or {}
    slot = realm.get('slot')
    if not isinstance(slot, int) or not 1 <= slot <= 99:
        return None, None
    name = realm.get('slotName')
    return slot, (name.strip()[:100] or None) if isinstance(name, str) else None


def home(data, slot):
    """The slot whose map is the folder itself. Maps made before worlds were told apart belong to the world played
    when this is first asked (worlds are seldom switched, so that is almost surely the one they show)."""
    path = os.path.join(data, 'world.json')
    saved = _load(path, {}).get('slot')
    if isinstance(saved, int):
        return saved
    os.makedirs(data, exist_ok=True)
    _save(path, {'slot': slot})
    return slot


def folder(data, slot):
    return '' if slot == home(data, slot) else f'worlds/{slot}/'


def main():
    what, data, members = sys.argv[1], sys.argv[2], sys.argv[3]
    slot, name = played(members)
    index_path = os.path.join(data, 'worlds.json')
    index = _load(index_path, {})
    if what == 'target':
        if slot is None:  # the Realm did not say: as before
            out = {'dir': data, 'switched': 'false'}
        else:
            sub = folder(data, slot)
            active = index.get('active')
            out = {'dir': os.path.join(data, sub).rstrip('/') or data,
                   'switched': 'true' if isinstance(active, int) and active != slot else 'false'}
        lines = ''.join(f'{k}={v}\n' for k, v in out.items())
        print(lines, end='')
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as f:
                f.write(lines)
    elif what == 'record':
        if slot is None:
            return
        sub = folder(data, slot)
        entries = {e['slot']: e for e in index.get('list', []) if isinstance(e, dict) and isinstance(e.get('slot'), int)}
        entry = entries.get(slot, {'slot': slot})
        entry.update({'dir': sub, 'at': int(time.time() * 1000)})
        if name:
            entry['name'] = name
        entries[slot] = entry
        _save(index_path, {'active': slot, 'list': [entries[k] for k in sorted(entries)]})
    else:
        sys.exit('usage: worlds.py target|record DATA MEMBERS_JSON')


if __name__ == '__main__':
    main()

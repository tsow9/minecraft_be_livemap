"""Stable numeric IDs for block names, saved in blocks.json so IDs mean the same thing every day."""
import json
import os

MAX_ID = (1 << 12) - 1
DETAIL_STATES = ('color', 'wood_type', 'old_log_type', 'new_log_type', 'old_leaf_type', 'new_leaf_type', 'stone_type')

_names = ['']
_ids = {'': 0}
_ja = ['']
_en = ['']


def load(site):
    global _names, _ids, _ja, _en
    try:
        with open(os.path.join(site, 'blocks.json'), encoding='utf-8') as f:
            data = json.load(f)
        names = data['names']
        ja, en = data.get('ja') or [], data.get('en') or []
    except (OSError, ValueError, KeyError):
        names, ja, en = [''], [], []
    _names = list(names)
    _ids = {n: i for i, n in enumerate(_names)}
    _ja = list(ja) + [None] * (len(_names) - len(ja))
    _en = list(en) + [None] * (len(_names) - len(en))


def save(site, japanese=None, english=None):
    """japanese(key) / english(key) -> the official name or None; when unavailable, earlier names are kept."""
    def names(lookup, before):
        return [(lookup(n) if lookup and n else None) or (before[i] if i < len(before) else None) for i, n in enumerate(_names)]
    with open(os.path.join(site, 'blocks.json'), 'w', encoding='utf-8') as f:
        json.dump({'names': _names, 'ja': names(japanese, _ja), 'en': names(english, _en)}, f, ensure_ascii=False, separators=(',', ':'))


def key_of(name, states):
    """'oak_log', or 'wool:red' for older blocks whose kind lives in a state."""
    simple = name.split(':', 1)[-1]
    for s in DETAIL_STATES:
        v = states.get(s)
        if isinstance(v, str):
            return f'{simple}:{v}'
    return simple


def id_of(name, states):
    key = key_of(name, states)
    i = _ids.get(key)
    if i is None:
        if len(_names) > MAX_ID:
            return 0
        i = len(_names)
        _names.append(key)
        _ids[key] = i
    return i

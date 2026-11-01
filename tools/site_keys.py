"""The keys of the members-only site, made from the login cache key (REALMS_CACHE_KEY), so nothing new has to be set up.

Usage: python site_keys.py OUT_DIR   (or --live-pass: print the live check's passphrase)
Writes OUT_DIR/secrets.json (for `wrangler deploy --secrets-file`), OUT_DIR/data_dir (the hidden data folder) and
OUT_DIR/items_dir (where items.json goes, for the worker only),
and tells GitHub to hide both keys in the run's log, which anyone can read in a public repository.
"""
import hashlib
import hmac
import json
import os
import sys
from msg import t


def derive(secret, label):
    return hmac.new(secret.encode(), label.encode(), hashlib.sha256).hexdigest()[:32]


def live_passphrase(secret):
    """What the live check sends its data with: SHARE_PASSPHRASE if it is set, else one made from REALMS_CACHE_KEY
    (so a new site needs one secret less)."""
    return os.environ.get('SHARE_PASSPHRASE') or derive(secret, 'blockmap live')


def main():
    if sys.argv[1:] == ['--live-pass']:  # for tools/live_loop.sh
        print(live_passphrase(os.environ.get('CACHE_KEY', '')) if os.environ.get('CACHE_KEY') else '')
        return
    out = sys.argv[1]
    secret = os.environ.get('CACHE_KEY', '')
    if not secret:
        sys.exit(t('REALMS_CACHE_KEY が必要です', 'REALMS_CACHE_KEY is needed'))
    passphrase = live_passphrase(secret)
    data = derive(secret, 'blockmap data')
    items = derive(secret, 'blockmap items')  # never told to pages: items.json goes out through the worker
    # Checks a Microsoft sign-in against the members (tools/realms/common.js makes the members' side the same way).
    member = hmac.new(secret.encode(), b'blockmap member', hashlib.sha256).hexdigest()
    for key in (data, items, member, passphrase):
        print(f'::add-mask::{key}')
    path = os.path.join(out, 'secrets.json')
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w', encoding='utf-8') as f:
        json.dump({'DATA_DIR': data, 'ITEMS_DIR': items, 'PASSPHRASE': passphrase, 'MEMBER_KEY': member}, f)
    with open(os.path.join(out, 'data_dir'), 'w', encoding='utf-8') as f:
        f.write(data)
    with open(os.path.join(out, 'items_dir'), 'w', encoding='utf-8') as f:
        f.write(items)


if __name__ == '__main__':
    main()

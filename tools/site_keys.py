"""The keys of the invite-only site, made from the login cache key (REALMS_CACHE_KEY), so nothing new has to be set up.

Usage: python site_keys.py OUT_DIR
Writes OUT_DIR/secrets.json (for `wrangler deploy --secrets-file`) and OUT_DIR/data_dir (the hidden data folder),
and tells GitHub to hide both keys in the run's log, which anyone can read in a public repository.
"""
import hashlib
import hmac
import json
import os
import sys


def derive(secret, label):
    return hmac.new(secret.encode(), label.encode(), hashlib.sha256).hexdigest()[:32]


def main():
    out = sys.argv[1]
    secret, passphrase = os.environ.get('CACHE_KEY', ''), os.environ.get('SHARE_PASSPHRASE', '')
    if not secret or not passphrase:
        sys.exit('REALMS_CACHE_KEY と SHARE_PASSPHRASE が必要です')
    view, data = derive(secret, 'blockmap view'), derive(secret, 'blockmap data')
    # Checks a Microsoft sign-in against the members (tools/realms/common.js makes the members' side the same way).
    member = hmac.new(secret.encode(), b'blockmap member', hashlib.sha256).hexdigest()
    for key in (view, data, member):
        print(f'::add-mask::{key}')
    path = os.path.join(out, 'secrets.json')
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w', encoding='utf-8') as f:
        json.dump({'VIEW_KEY': view, 'DATA_DIR': data, 'PASSPHRASE': passphrase, 'MEMBER_KEY': member}, f)
    with open(os.path.join(out, 'data_dir'), 'w', encoding='utf-8') as f:
        f.write(data)


if __name__ == '__main__':
    main()

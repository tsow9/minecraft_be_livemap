"""One-click map update: install libraries, render the world, drop old snapshots, and push to GitHub."""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
KEEP = 12


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=SITE, **kw)


def ensure_libs():
    try:
        import numpy  # noqa: F401
        import PIL  # noqa: F401
    except ImportError:
        print('必要な部品(numpy, Pillow)を入れています...')
        if run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', 'numpy', 'pillow']).returncode:
            sys.exit('部品を入れられませんでした。インターネット接続を確認してください。')


def prune(keep):
    path = os.path.join(SITE, 'config.json')
    with open(path, encoding='utf-8') as f:
        cfg = json.load(f)
    snaps = cfg.get('snapshots', [])
    if len(snaps) <= keep:
        return
    for s in snaps[:-keep]:
        shutil.rmtree(os.path.join(SITE, 'tiles', s['id']), ignore_errors=True)
        print(f'古い地図 {s["id"]} を削除しました')
    cfg['snapshots'] = snaps[-keep:]
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write('\n')


def publish():
    if shutil.which('git') is None or run(['git', 'rev-parse', '--is-inside-work-tree'], capture_output=True).returncode:
        print('Git の準備がないので、公開は行いませんでした(地図はこのPCには作られています)。')
        return
    run(['git', 'add', '-A', 'tiles', 'config.json'])
    if run(['git', 'diff', '--cached', '--quiet']).returncode == 0:
        print('変更がないので公開は不要でした。')
        return
    if run(['git', 'commit', '-q', '-m', '地図を更新']).returncode:
        sys.exit('記録に失敗しました。GitHub Desktop でこのフォルダを開き、一度ログインしてから再度お試しください。')
    print('GitHub に送っています...')
    if run(['git', 'push']).returncode:
        sys.exit('送信に失敗しました。インターネット接続か、GitHub へのログインを確認してください。')
    print('送信しました。数分後にサイトに反映されます。')


def main():
    ensure_libs()
    sys.path.insert(0, HERE)
    import render_map
    render_map.main()
    prune(KEEP)
    publish()


if __name__ == '__main__':
    main()

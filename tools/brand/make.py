"""Chizuya's logo, traced from the owner's drawing (tools/brand/source.png) into SVG.

    python3 tools/brand/make.py      (needs potrace: apt-get install potrace)

Writes logo.svg (the star and the name), tools/brand/mark.svg (the star alone) and favicon.svg (the star on a white
rounded square). Then `node tools/brand/png.js` draws the PNG icons from favicon.svg and mark.svg.
The star is moved so its centre (the cross) sits halfway up the letters (top of C .. baseline), not counting the
tail of the y. The star keeps its two lighter faces, drawn over the dark shape.
"""
import os
import re
import subprocess
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
S = 3            # traced at 3x for smooth curves
SPLIT = 400      # source x: the star is left of this, the name right
CROSS_Y = 227.5  # source y of the cross's centre
INK, STAR, MID, LIT = '#211a16', '#26211d', '#382e28', '#433630'

im = Image.open(os.path.join(HERE, 'source.png')).convert('RGBA')
W, H = im.size
a = np.array(im.resize((W * S, H * S), Image.LANCZOS)).astype(float)
alpha, lum = a[..., 3] / 255, a[..., :3].mean(-1)
xs = np.arange(W * S)[None, :]
text = (alpha > .5) & (xs >= SPLIT * S)
star = (alpha > .5) & (xs < SPLIT * S)


def trace(mask):
    with tempfile.TemporaryDirectory() as tmp:
        pbm, out = os.path.join(tmp, 'm.pbm'), os.path.join(tmp, 'm.svg')
        Image.fromarray(np.where(mask, 0, 255).astype('uint8')).convert('1').save(pbm)
        subprocess.run(['potrace', '-s', '--flat', '-a', '1.0', '-O', '0.4', '-t', '4', '-o', out, pbm], check=True)
        s = open(out).read()
    return re.search(r'<g transform="([^"]+)"', s).group(1), ' '.join(re.findall(r' d="([^"]+)"', s))


def group(mask, fill):
    tr, d = trace(mask)
    return f'<g transform="scale({1 / S:.6f}) {tr}"><path fill="{fill}" d="{d}"/></g>'


def rows(mask):
    return np.where(mask.any(1))[0] / S


def cols(mask):
    return np.where(mask.any(0))[0] / S


# halfway up the letters: the top of the C to the foot of the h
top = rows(text[:, 455 * S:646 * S])[0]
foot = rows(text[:, 681 * S:817 * S])[-1]
dy = (top + foot) / 2 - CROSS_Y
star_body = (f'<g transform="translate(0 {dy:.2f})">' + group(star, STAR) + group(star & (lum > 43), MID)
             + group(star & (lum > 50), LIT) + '</g>')

pad = 6
sy, sx, ty, tx = rows(star) + dy, cols(star), rows(text), cols(text)
x0, x1, y0, y1 = min(sx[0], tx[0]), max(sx[-1], tx[-1]), min(sy[0], ty[0]), max(sy[-1], ty[-1])
svg = lambda vb, body: f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{body}</svg>\n'
write = lambda name, s: (open(os.path.join(ROOT, name), 'w').write(s), print(f'{name}: {len(s) / 1024:.1f} KB'))

write('logo.svg', svg(f'{x0 - pad:.1f} {y0 - pad:.1f} {x1 - x0 + 2 * pad:.1f} {y1 - y0 + 2 * pad:.1f}',
                      f'<title>Chizuya</title>{star_body}' + group(text, INK)))
side = max(sx[-1] - sx[0], sy[-1] - sy[0]) + 2 * pad
cx, cy = (sx[0] + sx[-1]) / 2, (sy[0] + sy[-1]) / 2
mvb = f'{cx - side / 2:.1f} {cy - side / 2:.1f} {side:.1f} {side:.1f}'
write('tools/brand/mark.svg', svg(mvb, star_body))
# the browser tab and home screen icon: the star on a white rounded square (reads on light and dark tabs)
write('favicon.svg', svg('0 0 100 100', '<rect width="100" height="100" rx="21" fill="#ffffff"/>'
                         f'<svg x="5" y="5" width="90" height="90" viewBox="{mvb}">{star_body}</svg>'))

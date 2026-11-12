"""Chizuya's logo, from the owner's finished picture (tools/brand/source.png, transparent PNG).

    python3 tools/brand/make.py      then   node tools/brand/png.js

Writes logo.png (the star and the name), tools/brand/mark.png (the star alone, square) and favicon.svg (the star on a
white rounded square, the picture inside). The star is moved up so its centre (the cross) sits halfway up the
letters (top of the C .. foot of the h), not counting the tail of the y. The star's grey grid is darkened, more toward the centre (GRID).
"""
import base64
import io
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SPLIT = 400       # source x: the star is left of this, the name right
CROSS_Y = 227.5   # source y of the cross's centre
PAD = 6
GRID = (0, .65) # the star's grey grid, kept this much of its lightness at the centre and at the tips (1 = as drawn)
CROSS_X = 198.5  # source x of the cross's centre

src = Image.open(os.path.join(HERE, 'source.png')).convert('RGBA')
W, H = src.size
a = np.array(src)
# the grid on the star a little darker: tones above the faces' own are pulled toward them
st = a[:, :SPLIT, :3].astype(float)
v = st.mean(-1, keepdims=True)
yy, xx = np.mgrid[0:H, 0:SPLIT]
r = np.hypot(xx - CROSS_X, yy - CROSS_Y)
r = r / r[a[:, :SPLIT, 3] > 128].max()                 # 0 at the cross, 1 at the farthest tip
keep = (GRID[0] + (GRID[1] - GRID[0]) * np.clip(r, 0, 1))[..., None]
dark = np.where(v > 55, 55 + (v - 55) * keep, v)
a[:, :SPLIT, :3] = np.clip(st * np.where(v > 0, dark / np.maximum(v, 1), 1), 0, 255).astype(np.uint8)
src = Image.fromarray(a)
ink = a[..., 3] > 128


def rows(x0, x1):
    return np.where(ink[:, x0:x1].any(1))[0]


dy = round((rows(455, 646)[0] + rows(681, 817)[-1]) / 2 - CROSS_Y)
star = src.crop((0, 0, SPLIT, H))
name = src.crop((SPLIT, 0, W, H))
up = max(0, -dy)
canvas = Image.new('RGBA', (W, H + up), (0, 0, 0, 0))
canvas.alpha_composite(name, (SPLIT, up))
canvas.alpha_composite(star, (0, up + dy))
box = canvas.getbbox()
logo = canvas.crop((box[0] - PAD, box[1] - PAD, box[2] + PAD, box[3] + PAD))
logo.save(os.path.join(ROOT, 'logo.png'), optimize=True)
print('logo.png', logo.size, 'star moved by', dy)

sb = star.getbbox()
side = max(sb[2] - sb[0], sb[3] - sb[1]) + 2 * PAD
mark = Image.new('RGBA', (side, side), (0, 0, 0, 0))
mark.alpha_composite(star.crop(sb), ((side - (sb[2] - sb[0])) // 2, (side - (sb[3] - sb[1])) // 2))
mark.save(os.path.join(HERE, 'mark.png'), optimize=True)
print('tools/brand/mark.png', mark.size)

# the browser tab icon: the star on a white rounded square
buf = io.BytesIO()
mark.resize((192, 192), Image.LANCZOS).save(buf, 'PNG', optimize=True)
b64 = base64.b64encode(buf.getvalue()).decode()
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="21" fill="#ffffff"/>'
       f'<image x="5" y="5" width="90" height="90" href="data:image/png;base64,{b64}"/></svg>\n')
open(os.path.join(ROOT, 'favicon.svg'), 'w').write(svg)
print('favicon.svg', len(svg) // 1024, 'KB')
